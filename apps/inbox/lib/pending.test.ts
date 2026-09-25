import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getPendingAction, loadPendingActions } from "./pending";

function writeAction(dir: string, id: string) {
  writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      id,
      slug: "GMAIL_SEND_EMAIL",
      toolkit: "gmail",
      kind: "send",
      payload: { to: "a@b.com" },
      illustrative: true,
      note: "test fixture",
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
  );
}

describe("loadPendingActions", () => {
  it("returns [] when fixtures/pending doesn't exist", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "inbox-pending-"));
    try {
      expect(loadPendingActions(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads and sorts fixtures by id", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "inbox-pending-"));
    try {
      const pendingDir = path.join(dir, "fixtures", "pending");
      mkdirSync(pendingDir, { recursive: true });
      writeAction(pendingDir, "002-b");
      writeAction(pendingDir, "001-a");

      const actions = loadPendingActions(dir);
      expect(actions.map((a) => a.id)).toEqual(["001-a", "002-b"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("getPendingAction", () => {
  it("finds an action by id, undefined otherwise", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "inbox-pending-"));
    try {
      const pendingDir = path.join(dir, "fixtures", "pending");
      mkdirSync(pendingDir, { recursive: true });
      writeAction(pendingDir, "001-a");

      expect(getPendingAction("001-a", dir)?.slug).toBe("GMAIL_SEND_EMAIL");
      expect(getPendingAction("missing", dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
