import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { composioSdkVersion, createComposioCatalogClient } from "./client.js";
import { composioApiKey, loadRepoEnv } from "./env.js";
import { runFetch } from "./fetch.js";
import { findRepoRoot } from "./paths.js";
import { readToolkitFile } from "./snapshot.js";

// Live Composio catalog GETs (free tier, no spend). Opt-in (plan §4): needs
// COMPOSIO_API_KEY and AUDIT_LIVE=1, so CI and plain `pnpm test` stay offline.
loadRepoEnv(findRepoRoot());
const apiKey = process.env.AUDIT_LIVE === "1" ? composioApiKey() : null;

describe.skipIf(!apiKey)("live Composio catalog", () => {
  it("fetches gmail with GMAIL_SEND_EMAIL tags", { timeout: 120_000 }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "audit-live-"));
    try {
      const res = await runFetch({
        client: createComposioCatalogClient(apiKey as string),
        outDir: dir,
        toolkits: ["gmail"],
        refresh: true,
        manifest: { sdkVersion: composioSdkVersion(), date: "live", command: "live test" },
      });
      expect(res.failures).toEqual([]);
      const file = readToolkitFile(dir, "gmail");
      const send = file?.tools.find((t) => t.slug === "GMAIL_SEND_EMAIL");
      expect(send?.tags).toContain("openWorldHint");
      expect(file?.tools.length).toBeGreaterThanOrEqual(file?.toolkit.toolsCount ?? 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
