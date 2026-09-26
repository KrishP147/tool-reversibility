import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This test file lives next to actions.ts, so these relative specifiers
// resolve to the exact same files actions.ts itself imports — that's what
// lets vi.doMock intercept them.
const STORE_SPECIFIER = "../../../lib/store";
const LIVE_SPECIFIER = "../../../lib/live";

const LIVE_ID = "live-test-action-does-not-exist-in-fixtures";

function liveRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: LIVE_ID,
    slug: "GMAIL_SEND_EMAIL",
    toolkitSlug: "gmail",
    kind: "send",
    payload: { to: "a@b.com" },
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock(STORE_SPECIFIER);
  vi.doUnmock(LIVE_SPECIFIER);
});

describe("decideOnAction — live branch", () => {
  it("throws for an unknown id when INBOX_MODE is not live (no fixture, no live store touched)", async () => {
    vi.stubEnv("INBOX_MODE", "");
    vi.doMock(STORE_SPECIFIER, () => {
      throw new Error("lib/store must not be imported outside live mode");
    });

    const { decideOnAction } = await import("./actions");
    await expect(decideOnAction(LIVE_ID, "approve", {})).rejects.toThrow(/unknown pending action/i);
  });

  it("approve executes via lib/live's executeApproved and returns its payloadHash", async () => {
    vi.stubEnv("INBOX_MODE", "live");
    const row = liveRow();
    const executeApprovedMock = vi.fn().mockResolvedValue({ ok: true, payloadHash: "hash-ok" });

    vi.doMock(STORE_SPECIFIER, () => ({
      getPending: vi.fn().mockReturnValue(row),
      insertAudit: vi.fn(),
      markPendingStatus: vi.fn(),
      updatePendingPayload: vi.fn(),
    }));
    vi.doMock(LIVE_SPECIFIER, () => ({ executeApproved: executeApprovedMock }));

    const { decideOnAction } = await import("./actions");
    const result = await decideOnAction(LIVE_ID, "approve", row.payload);

    expect(executeApprovedMock).toHaveBeenCalledWith(LIVE_ID);
    expect(result).toEqual({ payloadHash: "hash-ok", error: undefined });
  });

  it("approve surfaces a live execution failure instead of throwing", async () => {
    vi.stubEnv("INBOX_MODE", "live");
    const row = liveRow();

    vi.doMock(STORE_SPECIFIER, () => ({
      getPending: vi.fn().mockReturnValue(row),
      insertAudit: vi.fn(),
      markPendingStatus: vi.fn(),
      updatePendingPayload: vi.fn(),
    }));
    vi.doMock(LIVE_SPECIFIER, () => ({
      executeApproved: vi
        .fn()
        .mockResolvedValue({ ok: false, error: "composio boom", payloadHash: "hash-fail" }),
    }));

    const { decideOnAction } = await import("./actions");
    const result = await decideOnAction(LIVE_ID, "approve", row.payload);

    expect(result).toEqual({ payloadHash: "hash-fail", error: "composio boom" });
  });

  it("reject marks the row rejected and audits, without ever importing lib/live", async () => {
    vi.stubEnv("INBOX_MODE", "live");
    const row = liveRow();
    const markPendingStatusMock = vi.fn();
    const insertAuditMock = vi.fn().mockReturnValue({
      id: 1,
      actionId: LIVE_ID,
      slug: row.slug,
      decision: "reject",
      who: "live-user",
      when: "2026-01-01T00:00:01.000Z",
      payloadHash: "hash-reject",
    });

    vi.doMock(STORE_SPECIFIER, () => ({
      getPending: vi.fn().mockReturnValue(row),
      insertAudit: insertAuditMock,
      markPendingStatus: markPendingStatusMock,
      updatePendingPayload: vi.fn(),
    }));
    vi.doMock(LIVE_SPECIFIER, () => {
      throw new Error("lib/live must not be imported for a reject decision");
    });

    const { decideOnAction } = await import("./actions");
    const result = await decideOnAction(LIVE_ID, "reject", row.payload);

    expect(markPendingStatusMock).toHaveBeenCalledWith(LIVE_ID, "rejected");
    expect(insertAuditMock).toHaveBeenCalledTimes(1);
    expect(insertAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: LIVE_ID, decision: "reject", payload: row.payload }),
    );
    expect(result).toEqual({ payloadHash: "hash-reject", error: undefined });
  });

  it("edit persists the new payload and audits it, without ever importing lib/live", async () => {
    vi.stubEnv("INBOX_MODE", "live");
    const row = liveRow();
    const updatePendingPayloadMock = vi.fn();
    const insertAuditMock = vi.fn().mockReturnValue({
      id: 1,
      actionId: LIVE_ID,
      slug: row.slug,
      decision: "edit",
      who: "live-user",
      when: "2026-01-01T00:00:01.000Z",
      payloadHash: "hash-edit",
    });

    vi.doMock(STORE_SPECIFIER, () => ({
      getPending: vi.fn().mockReturnValue(row),
      insertAudit: insertAuditMock,
      markPendingStatus: vi.fn(),
      updatePendingPayload: updatePendingPayloadMock,
    }));
    vi.doMock(LIVE_SPECIFIER, () => {
      throw new Error("lib/live must not be imported for an edit decision");
    });

    const { decideOnAction } = await import("./actions");
    const edited = { to: "edited@example.com" };
    const result = await decideOnAction(LIVE_ID, "edit", edited);

    expect(updatePendingPayloadMock).toHaveBeenCalledWith(LIVE_ID, edited);
    expect(insertAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: LIVE_ID, decision: "edit", payload: edited }),
    );
    expect(result).toEqual({ payloadHash: "hash-edit", error: undefined });
  });

  it("throws for an id missing from both fixtures and the live store", async () => {
    vi.stubEnv("INBOX_MODE", "live");
    vi.doMock(STORE_SPECIFIER, () => ({
      getPending: vi.fn().mockReturnValue(undefined),
      insertAudit: vi.fn(),
      markPendingStatus: vi.fn(),
      updatePendingPayload: vi.fn(),
    }));

    const { decideOnAction } = await import("./actions");
    await expect(decideOnAction("totally-unknown-id", "approve", {})).rejects.toThrow(
      /unknown pending action/i,
    );
  });
});
