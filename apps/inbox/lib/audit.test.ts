import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPayload, readAuditLog, recordDecision } from "./audit";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "inbox-audit-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("recordDecision", () => {
  it("does not create the log directory until the first write", () => {
    const auditDir = path.join(dir, "not-yet");
    expect(existsSync(auditDir)).toBe(false);
    recordDecision(
      {
        actionId: "001-a",
        slug: "GMAIL_SEND_EMAIL",
        decision: "approve",
        payload: { to: "a@b.com" },
      },
      auditDir,
    );
    expect(existsSync(path.join(auditDir, "audit.jsonl"))).toBe(true);
  });

  it("appends rather than overwriting", () => {
    recordDecision(
      {
        actionId: "001-a",
        slug: "GMAIL_SEND_EMAIL",
        decision: "approve",
        payload: { to: "a@b.com" },
      },
      dir,
    );
    recordDecision(
      {
        actionId: "002-b",
        slug: "SLACK_SEND_MESSAGE",
        decision: "reject",
        payload: { text: "hi" },
      },
      dir,
    );

    const lines = readFileSync(path.join(dir, "audit.jsonl"), "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(readAuditLog(dir).map((e) => e.actionId)).toEqual(["001-a", "002-b"]);
  });

  it("defaults who to INBOX_USER or mock-user", () => {
    const prev = process.env.INBOX_USER;
    delete process.env.INBOX_USER;
    try {
      const entry = recordDecision(
        { actionId: "001-a", slug: "GMAIL_SEND_EMAIL", decision: "approve", payload: {} },
        dir,
      );
      expect(entry.who).toBe("mock-user");

      process.env.INBOX_USER = "krish";
      const entry2 = recordDecision(
        { actionId: "001-a", slug: "GMAIL_SEND_EMAIL", decision: "approve", payload: {} },
        dir,
      );
      expect(entry2.who).toBe("krish");
    } finally {
      if (prev === undefined) delete process.env.INBOX_USER;
      else process.env.INBOX_USER = prev;
    }
  });

  it("hashes the payload it was given, not the fixture on disk", () => {
    const entry = recordDecision(
      {
        actionId: "001-a",
        slug: "GMAIL_SEND_EMAIL",
        decision: "edit",
        payload: { to: "edited@b.com" },
      },
      dir,
    );
    expect(entry.payloadHash).toBe(hashPayload({ to: "edited@b.com" }));
    expect(entry.payloadHash).not.toBe(hashPayload({ to: "a@b.com" }));
  });
});

describe("hashPayload", () => {
  it("is stable regardless of key order", () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });

  it("is stable for nested objects/arrays regardless of key order", () => {
    const x = { outer: { z: 1, a: [{ q: 1, p: 2 }] } };
    const y = { outer: { a: [{ p: 2, q: 1 }], z: 1 } };
    expect(hashPayload(x)).toBe(hashPayload(y));
  });
});

describe("readAuditLog", () => {
  it("returns [] when the log doesn't exist", () => {
    expect(readAuditLog(path.join(dir, "nope"))).toEqual([]);
  });
});
