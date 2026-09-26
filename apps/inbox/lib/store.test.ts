import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __closeDbForTests,
  getPending,
  insertAudit,
  insertPending,
  listAudit,
  listPending,
  markPendingStatus,
  updatePendingPayload,
} from "./store";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "inbox-store-"));
  dbPath = path.join(dir, "live.db");
});

afterEach(() => {
  // Close the cached DatabaseSync handle before removing its file — on
  // Windows an open handle keeps the file locked, and rmSync would fail.
  __closeDbForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe("store", () => {
  it("creates the db file lazily on first use, not just from getDb()", () => {
    expect(existsSync(dbPath)).toBe(false);
    insertPending(
      { slug: "GMAIL_SEND_EMAIL", toolkitSlug: "gmail", payload: { to: "a@b.com" } },
      dbPath,
    );
    expect(existsSync(dbPath)).toBe(true);
  });

  it("round-trips insert/list/get/mark/updatePayload/audit on a temp db", () => {
    const id = insertPending(
      { slug: "GMAIL_SEND_EMAIL", toolkitSlug: "gmail", payload: { to: "a@b.com" } },
      dbPath,
    );
    expect(id).toMatch(/^live-/);

    expect(getPending(id, dbPath)).toMatchObject({
      id,
      slug: "GMAIL_SEND_EMAIL",
      toolkitSlug: "gmail",
      kind: "other",
      payload: { to: "a@b.com" },
      status: "pending",
    });
    expect(listPending(dbPath).map((row) => row.id)).toEqual([id]);
    expect(getPending("nope", dbPath)).toBeUndefined();

    updatePendingPayload(id, { to: "edited@b.com" }, dbPath);
    expect(getPending(id, dbPath)?.payload).toEqual({ to: "edited@b.com" });

    markPendingStatus(id, "approved", dbPath);
    expect(getPending(id, dbPath)?.status).toBe("approved");

    const auditRow = insertAudit(
      {
        actionId: id,
        slug: "GMAIL_SEND_EMAIL",
        decision: "approve",
        payload: { to: "edited@b.com" },
      },
      dbPath,
    );
    expect(auditRow.actionId).toBe(id);
    expect(auditRow.payloadHash).toMatch(/^[a-f0-9]{64}$/);

    const audits = listAudit(dbPath);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actionId: id,
      slug: "GMAIL_SEND_EMAIL",
      decision: "approve",
    });
  });

  it("keeps rows for a second db path separate from the first", () => {
    const otherDbPath = path.join(dir, "other.db");
    const idA = insertPending({ slug: "A", toolkitSlug: "a", payload: {} }, dbPath);
    const idB = insertPending({ slug: "B", toolkitSlug: "b", payload: {} }, otherDbPath);

    expect(listPending(dbPath).map((r) => r.id)).toEqual([idA]);
    expect(listPending(otherDbPath).map((r) => r.id)).toEqual([idB]);
  });
});
