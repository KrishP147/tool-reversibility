import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findRepoRoot } from "./paths.js";
import { rulesCommand } from "./rulesCommand.js";

const TRIMMED_DIR = path.join(
  findRepoRoot(path.dirname(fileURLToPath(import.meta.url))),
  "fixtures",
  "catalog",
  "trimmed",
);

describe("rulesCommand", () => {
  it("classifies every toolkit when toolkits is null", async () => {
    const res = await rulesCommand({ snapshotDir: TRIMMED_DIR, toolkits: null });
    expect(res.exitCode).toBe(0);
    const lines = res.output.split("\n");
    expect(lines[0]).toMatch(/^slug\s+tier \(derived\)\s+class\s+confidence\s+reasons$/);
    // header + 125 tool rows, no blank lines (no missing toolkits)
    expect(lines.length).toBe(126);
  });

  it("labels the tier column 'derived', never 'real' (D6/D22)", async () => {
    const res = await rulesCommand({ snapshotDir: TRIMMED_DIR, toolkits: ["gmail"] });
    expect(res.output).toContain("tier (derived)");
    expect(res.output).not.toMatch(/tier \(real\)/);
    expect(res.output).toMatch(/\(derived\)/);
  });

  it("GMAIL_SEND_EMAIL's row shows class irreversible with a reason", async () => {
    const res = await rulesCommand({ snapshotDir: TRIMMED_DIR, toolkits: ["gmail"] });
    const row = res.output.split("\n").find((l) => l.startsWith("GMAIL_SEND_EMAIL "));
    expect(row).toBeDefined();
    expect(row).toMatch(/irreversible/);
    expect(row).toMatch(/verb:SEND/);
  });

  it("restricts to the requested toolkit only", async () => {
    const res = await rulesCommand({ snapshotDir: TRIMMED_DIR, toolkits: ["gmail"] });
    expect(res.exitCode).toBe(0);
    // header + 25 gmail tools
    expect(res.output.split("\n").length).toBe(26);
    expect(res.output).not.toContain("SLACK_");
  });

  it("accepts several toolkits together", async () => {
    const res = await rulesCommand({ snapshotDir: TRIMMED_DIR, toolkits: ["gmail", "slack"] });
    expect(res.exitCode).toBe(0);
    expect(res.output).toContain("GMAIL_SEND_EMAIL");
    expect(res.output).toContain("SLACK_LIST_ALL_USERS");
  });

  it("a single missing/invalid toolkit is a nonzero exit with a message naming it", async () => {
    const res = await rulesCommand({ snapshotDir: TRIMMED_DIR, toolkits: ["not-a-real-toolkit"] });
    expect(res.exitCode).not.toBe(0);
    expect(res.output).toContain("not-a-real-toolkit");
    expect(res.output.toLowerCase()).toMatch(/missing|invalid/);
  });

  it("a mix of valid and missing toolkits still reports the valid rows, exit code nonzero", async () => {
    const res = await rulesCommand({
      snapshotDir: TRIMMED_DIR,
      toolkits: ["gmail", "not-a-real-toolkit"],
    });
    expect(res.exitCode).toBe(1);
    expect(res.output).toContain("GMAIL_SEND_EMAIL");
    expect(res.output).toContain("not-a-real-toolkit");
  });

  it("every requested toolkit missing is exit code 2 with no table", async () => {
    const res = await rulesCommand({ snapshotDir: TRIMMED_DIR, toolkits: ["nope-1", "nope-2"] });
    expect(res.exitCode).toBe(2);
    expect(res.output).toContain("nope-1");
    expect(res.output).toContain("nope-2");
  });
});

describe("rulesCommand: empty snapshot directory", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "audit-rules-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("no snapshots on disk and toolkits null -> nonzero exit with a clear message", async () => {
    const res = await rulesCommand({ snapshotDir: dir, toolkits: null });
    expect(res.exitCode).toBe(2);
    expect(res.output.toLowerCase()).toContain("no toolkit snapshots found");
  });
});
