import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("./store");
});

describe("loadLivePendingActions", () => {
  it("returns {actions: []} and never imports ./store when INBOX_MODE is unset", async () => {
    vi.stubEnv("INBOX_MODE", "");
    vi.doMock("./store", () => {
      throw new Error("./store must not be imported when INBOX_MODE is not live");
    });

    const { loadLivePendingActions } = await import("./livePending");
    await expect(loadLivePendingActions()).resolves.toEqual({ actions: [] });
  });

  it("adapts pending live rows to PendingAction and filters out non-pending rows", async () => {
    vi.stubEnv("INBOX_MODE", "live");
    const listPendingMock = vi.fn().mockReturnValue([
      {
        id: "live-1",
        slug: "GMAIL_SEND_EMAIL",
        toolkitSlug: "gmail",
        kind: "send",
        payload: { to: "a@b.com" },
        status: "pending",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "live-2",
        slug: "SLACK_SEND_MESSAGE",
        toolkitSlug: "slack",
        kind: "send",
        payload: { text: "hi" },
        status: "approved",
        createdAt: "2026-01-01T00:00:01.000Z",
      },
    ]);
    vi.doMock("./store", () => ({ listPending: listPendingMock }));

    const { loadLivePendingActions } = await import("./livePending");
    const result = await loadLivePendingActions();

    expect(result.error).toBeUndefined();
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      id: "live-1",
      slug: "GMAIL_SEND_EMAIL",
      illustrative: false,
    });
  });

  it("returns {actions: [], error} when the live store throws, never throwing itself", async () => {
    vi.stubEnv("INBOX_MODE", "live");
    vi.doMock("./store", () => ({
      listPending: () => {
        throw new Error("db locked");
      },
    }));

    const { loadLivePendingActions } = await import("./livePending");
    await expect(loadLivePendingActions()).resolves.toEqual({ actions: [], error: "db locked" });
  });
});

describe("getPendingActionAny", () => {
  it("never imports ./store when INBOX_MODE is unset and the id isn't a fixture", async () => {
    vi.stubEnv("INBOX_MODE", "");
    vi.doMock("./store", () => {
      throw new Error("./store must not be imported when INBOX_MODE is not live");
    });

    const { getPendingActionAny } = await import("./livePending");
    await expect(getPendingActionAny("live-does-not-exist")).resolves.toBeUndefined();
  });

  it("finds a live row by id when INBOX_MODE=live and it isn't a fixture", async () => {
    vi.stubEnv("INBOX_MODE", "live");
    const row = {
      id: "live-3",
      slug: "NOTION_DELETE_PAGE",
      toolkitSlug: "notion",
      kind: "delete",
      payload: { pageId: "p1" },
      status: "pending",
      createdAt: "2026-01-01T00:00:02.000Z",
    };
    const getPendingMock = vi.fn().mockReturnValue(row);
    vi.doMock("./store", () => ({ getPending: getPendingMock }));

    const { getPendingActionAny } = await import("./livePending");
    const found = await getPendingActionAny("live-3");

    expect(found?.source).toBe("live");
    expect(found?.action.slug).toBe("NOTION_DELETE_PAGE");
    expect(getPendingMock).toHaveBeenCalledWith("live-3");
  });

  it("treats a live store failure as not-found rather than throwing", async () => {
    vi.stubEnv("INBOX_MODE", "live");
    vi.doMock("./store", () => ({
      getPending: () => {
        throw new Error("db locked");
      },
    }));

    const { getPendingActionAny } = await import("./livePending");
    await expect(getPendingActionAny("live-4")).resolves.toBeUndefined();
  });
});
