import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted so these mock fns exist before vi.mock's factory (hoisted above
// imports) runs, and stay stable references across the file for assertions.
const { insertPendingMock, getPendingMock, insertAuditMock, markPendingStatusMock } = vi.hoisted(
  () => ({
    insertPendingMock: vi.fn(),
    getPendingMock: vi.fn(),
    insertAuditMock: vi.fn(),
    markPendingStatusMock: vi.fn(),
  }),
);

const { executeMock, createMock, ComposioMock } = vi.hoisted(() => {
  const executeMock = vi.fn();
  const createMock = vi.fn().mockResolvedValue({ execute: executeMock });
  const ComposioMock = vi.fn().mockImplementation(() => ({ create: createMock }));
  return { executeMock, createMock, ComposioMock };
});

// Never a real network call: @composio/core is fully mocked for this file
// (issue #7's "no live Composio calls" rule).
vi.mock("./store", () => ({
  insertPending: insertPendingMock,
  getPending: getPendingMock,
  insertAudit: insertAuditMock,
  markPendingStatus: markPendingStatusMock,
}));

vi.mock("@composio/core", () => ({ Composio: ComposioMock }));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("approvalGuard", () => {
  it("enqueues a pending row and throws ApprovalRequiredError", async () => {
    insertPendingMock.mockReturnValue("live-123");
    const { approvalGuard, ApprovalRequiredError } = await import("./live");

    await expect(
      approvalGuard({
        toolSlug: "GMAIL_SEND_EMAIL",
        toolkitSlug: "gmail",
        sessionId: "session-1",
        params: { to: "a@b.com" },
      }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);

    expect(insertPendingMock).toHaveBeenCalledTimes(1);
    expect(insertPendingMock).toHaveBeenCalledWith({
      slug: "GMAIL_SEND_EMAIL",
      toolkitSlug: "gmail",
      payload: { to: "a@b.com" },
    });
  });
});

describe("getLiveSession", () => {
  it("throws when COMPOSIO_API_KEY is unset", async () => {
    vi.stubEnv("COMPOSIO_API_KEY", "");
    const { getLiveSession, __resetLiveSessionForTests } = await import("./live");
    __resetLiveSessionForTests();

    await expect(getLiveSession()).rejects.toThrow(/COMPOSIO_API_KEY/);
    expect(ComposioMock).not.toHaveBeenCalled();
  });
});

describe("executeApproved", () => {
  const row = {
    id: "live-1",
    slug: "GMAIL_SEND_EMAIL",
    toolkitSlug: "gmail",
    kind: "send" as const,
    payload: { to: "a@b.com" },
    status: "pending" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(async () => {
    vi.stubEnv("COMPOSIO_API_KEY", "test-key");
    const { __resetLiveSessionForTests } = await import("./live");
    __resetLiveSessionForTests();
    getPendingMock.mockReturnValue(row);
  });

  it("calls session.execute exactly once with the row's slug+payload and writes one audit row", async () => {
    executeMock.mockResolvedValue({ id: "msg-1" });
    insertAuditMock.mockReturnValue({
      id: 1,
      actionId: row.id,
      slug: row.slug,
      decision: "approve",
      who: "live-user",
      when: "2026-01-01T00:00:01.000Z",
      payloadHash: "hash-ok",
    });

    const { executeApproved } = await import("./live");
    const result = await executeApproved(row.id);

    expect(createMock).toHaveBeenCalledWith("inbox-user", {});
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock).toHaveBeenCalledWith(row.slug, row.payload);
    expect(insertAuditMock).toHaveBeenCalledTimes(1);
    expect(markPendingStatusMock).toHaveBeenCalledWith(row.id, "approved");
    expect(result).toEqual({ ok: true, payloadHash: "hash-ok" });
  });

  it("returns ok:false and still audits when execute fails", async () => {
    executeMock.mockRejectedValue(new Error("composio boom"));
    insertAuditMock.mockReturnValue({
      id: 1,
      actionId: row.id,
      slug: row.slug,
      decision: "approve",
      who: "live-user",
      when: "2026-01-01T00:00:01.000Z",
      payloadHash: "hash-fail",
    });

    const { executeApproved } = await import("./live");
    const result = await executeApproved(row.id);

    expect(insertAuditMock).toHaveBeenCalledTimes(1);
    expect(markPendingStatusMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("composio boom");
    expect(result.payloadHash).toBe("hash-fail");
  });
});
