import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { composioSdkVersion } from "./client.js";
import { fetchCommand } from "./fetchCommand.js";
import { findRepoRoot, snapshotDir } from "./paths.js";
import { parseArgs } from "./program.js";
import { fakeClient, noSleep } from "./testing/fakeClient.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "audit-root-"));
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: []\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("paths", () => {
  it("finds the repo root from a nested dir", () => {
    const nested = path.join(root, "packages", "audit", "src");
    mkdirSync(nested, { recursive: true });
    expect(findRepoRoot(nested)).toBe(path.resolve(root));
  });

  it("resolves the snapshot dir relative to the repo root", () => {
    expect(snapshotDir(root, null, "2026-09-24")).toBe(
      path.join(root, "fixtures", "catalog", "2026-09-24"),
    );
    expect(snapshotDir(root, "fixtures/catalog/trimmed")).toBe(
      path.join(root, "fixtures", "catalog", "trimmed"),
    );
  });
});

describe("composioSdkVersion", () => {
  it("reads the installed @composio/core version", () => {
    expect(composioSdkVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("fetchCommand", () => {
  it("fails fast without an API key and never builds a client", async () => {
    let built = false;
    const res = await fetchCommand(parseArgs(["fetch"]), {
      repoRoot: root,
      env: {},
      createClient: () => {
        built = true;
        throw new Error("unreachable");
      },
    });
    expect(res.exitCode).toBe(2);
    expect(res.output).toContain("COMPOSIO_API_KEY");
    expect(built).toBe(false);
  });

  it("writes under <repoRoot>/fixtures/catalog/<date> and never echoes the key", async () => {
    const secret = "sk-test-do-not-print";
    const { client } = fakeClient([{ slug: "gmail", toolsCount: 1, tools: ["GMAIL_SEND_EMAIL"] }]);
    const logs: string[] = [];
    let keySeen = "";
    const res = await fetchCommand(parseArgs(["fetch", "--toolkits", "gmail"]), {
      repoRoot: root,
      env: { COMPOSIO_API_KEY: secret },
      createClient: (k) => {
        keySeen = k;
        return client;
      },
      sdkVersion: "0.21.0",
      date: "2026-09-24",
      retry: { sleep: noSleep },
      log: (m) => logs.push(m),
    });
    expect(res.exitCode).toBe(0);
    expect(keySeen).toBe(secret);
    const manifest = JSON.parse(
      readFileSync(path.join(root, "fixtures", "catalog", "2026-09-24", "manifest.json"), "utf8"),
    ) as { command: string; counts: { tools: number } };
    expect(manifest.counts.tools).toBe(1);
    expect(manifest.command).toBe("pnpm audit:cli fetch --toolkits gmail");
    expect([...logs, res.output].join("\n")).not.toContain(secret);
  });

  it("rejects --offline", async () => {
    const res = await fetchCommand(parseArgs(["fetch", "--offline"]), { repoRoot: root, env: {} });
    expect(res.exitCode).toBe(2);
  });
});
