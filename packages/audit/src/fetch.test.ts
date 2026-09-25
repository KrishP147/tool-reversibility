import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  errorStatus,
  isRetryable,
  looksTruncated,
  runFetch,
  runPool,
  withRetry,
  type FetchOptions,
} from "./fetch.js";
import { normalizeTool, type ToolkitSummary } from "./normalize.js";
import { readToolkitFile, toolkitFilePath, type Manifest } from "./snapshot.js";
import { fakeClient, noSleep, type FakeToolkit } from "./testing/fakeClient.js";

const tools = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}_T${String(i).padStart(3, "0")}`);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "audit-fetch-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function opts(client: FetchOptions["client"], extra: Partial<FetchOptions> = {}): FetchOptions {
  return {
    client,
    outDir: dir,
    toolkits: null,
    refresh: false,
    retry: { sleep: noSleep },
    manifest: { sdkVersion: "0.21.0", date: "2026-09-24", command: "test" },
    now: () => new Date("2026-09-24T12:00:00Z"),
    ...extra,
  };
}

const readManifest = (): Manifest =>
  JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;

const httpErr = (status: number) => Object.assign(new Error(`http ${status}`), { status });

describe("withRetry / isRetryable", () => {
  it("retries 429 and 5xx with growing delays, then succeeds", async () => {
    const delays: number[] = [];
    let n = 0;
    const out = await withRetry(
      async () => {
        n += 1;
        if (n === 1) throw httpErr(429);
        if (n === 2) throw httpErr(503);
        return "ok";
      },
      { sleep: async (ms) => void delays.push(ms), random: () => 1, baseMs: 100 },
    );
    expect(out).toBe("ok");
    expect(delays).toEqual([100, 200]);
  });

  it("does not retry 4xx other than 408/429", async () => {
    let n = 0;
    const fail = async () => {
      n += 1;
      throw httpErr(401);
    };
    await expect(withRetry(fail, { sleep: noSleep })).rejects.toThrow("http 401");
    expect(n).toBe(1);
  });

  it("gives up after `retries`", async () => {
    let n = 0;
    const fail = async () => {
      n += 1;
      throw httpErr(500);
    };
    await expect(withRetry(fail, { sleep: noSleep, retries: 2 })).rejects.toThrow("http 500");
    expect(n).toBe(3);
  });

  it("caps delay at maxMs", async () => {
    const delays: number[] = [];
    let n = 0;
    await withRetry(
      async () => {
        n += 1;
        if (n < 5) throw httpErr(429);
        return 1;
      },
      { sleep: async (ms) => void delays.push(ms), random: () => 1, baseMs: 100, maxMs: 300 },
    );
    expect(Math.max(...delays)).toBe(300);
  });

  it("finds status in the cause chain and treats network codes as transient", () => {
    const wrapped = new Error("sdk", { cause: httpErr(502) });
    expect(errorStatus(wrapped)).toBe(502);
    expect(isRetryable(wrapped)).toBe(true);
    expect(isRetryable(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(true);
    expect(isRetryable(new Error("plain"))).toBe(false);
  });
});

describe("runPool", () => {
  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (i) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      seen.push(i);
      inFlight -= 1;
    });
    expect(peak).toBe(4);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("looksTruncated", () => {
  const tk = (toolsCount: number | null): ToolkitSummary => ({
    slug: "a",
    name: "a",
    toolsCount,
    categories: [],
    isLocalToolkit: false,
  });
  const t = (slug: string, dep = false) =>
    normalizeTool({ slug, toolkit: { slug: "a" }, isDeprecated: dep });

  it("flags a result that fills the limit", () => {
    expect(looksTruncated([t("A_1"), t("A_2")], tk(null), 2)).toBe(true);
  });
  it("flags fewer non-deprecated tools than meta count", () => {
    expect(looksTruncated([t("A_1"), t("A_2", true)], tk(2), 10)).toBe(true);
  });
  it("accepts deprecated extras beyond meta count", () => {
    expect(looksTruncated([t("A_1"), t("A_2", true)], tk(1), 10)).toBe(false);
  });
});

describe("runFetch", () => {
  const catalog: FakeToolkit[] = [
    {
      slug: "gmail",
      toolsCount: 2,
      tools: ["GMAIL_SEND_EMAIL", "GMAIL_LIST", "GMAIL_OLD"],
      deprecated: ["GMAIL_OLD"],
    },
    { slug: "slack", toolsCount: 2, tools: ["SLACK_POST", "SLACK_LIST"] },
    { slug: "notion", toolsCount: 1, tools: ["NOTION_GET"] },
  ];

  it("writes one sorted file per toolkit plus a manifest", async () => {
    const { client, calls } = fakeClient(catalog);
    const res = await runFetch(opts(client));
    expect(res.listed).toBe(3);
    expect(res.fetched).toEqual(["gmail", "notion", "slack"]);
    expect(res.fallbacks).toEqual([]);
    expect(calls.listToolkits).toBe(1);
    const gmail = readToolkitFile(dir, "gmail");
    expect(gmail?.tools.map((t) => t.slug)).toEqual([
      "GMAIL_LIST",
      "GMAIL_OLD",
      "GMAIL_SEND_EMAIL",
    ]);
    expect(gmail?.source).toBe("sdk");
    const m = readManifest();
    expect(m.counts).toMatchObject({ toolkits: 3, tools: 6, fullTools: 6, deprecatedTools: 1 });
    expect(m.sdk.version).toBe("0.21.0");
  });

  it("follows next_cursor across toolkit list pages", async () => {
    const many: FakeToolkit[] = Array.from({ length: 25 }, (_, i) => ({
      slug: `tk${String(i).padStart(4, "0")}`,
      toolsCount: 1,
      tools: [`TK${i}_A`],
    }));
    const { client, calls } = fakeClient(many);
    const res = await runFetch(opts(client, { toolkitPageSize: 10 }));
    expect(calls.listToolkits).toBe(3);
    expect(res.listed).toBe(25);
    expect(res.manifest.counts.toolkits).toBe(25);
  });

  it("falls back to cursor-paged REST when the SDK result is truncated", async () => {
    const big: FakeToolkit = { slug: "github", toolsCount: 250, tools: tools("GITHUB", 250) };
    const { client, calls } = fakeClient([big], { sdkCap: 100 });
    const res = await runFetch(opts(client, { restPageSize: 60 }));
    expect(res.fallbacks).toEqual(["github"]);
    expect(calls.listToolsPage).toBe(5);
    const file = readToolkitFile(dir, "github");
    expect(file?.tools).toHaveLength(250);
    expect(file?.source).toBe("rest-cursor");
    expect(readManifest().counts.restFallbacks).toBe(1);
  });

  it("resumes: skips valid toolkit files on disk unless refresh", async () => {
    const first = fakeClient(catalog);
    await runFetch(opts(first.client));
    expect(first.calls.getRawTools).toBe(3);

    // A corrupt file is not a valid snapshot, so resume must re-fetch it.
    writeFileSync(toolkitFilePath(dir, "slack"), "{not json", "utf8");
    const second = fakeClient(catalog);
    const res = await runFetch(opts(second.client));
    expect(res.skipped).toEqual(["gmail", "notion"]);
    expect(res.fetched).toEqual(["slack"]);
    expect(second.calls.getRawTools).toBe(1);
    expect(readManifest().counts.toolkits).toBe(3);

    const third = fakeClient(catalog);
    const refreshed = await runFetch(opts(third.client, { refresh: true }));
    expect(refreshed.skipped).toEqual([]);
    expect(third.calls.getRawTools).toBe(3);
  });

  it("backs off on 429 and records hard failures in the manifest", async () => {
    const { client, calls } = fakeClient(catalog, {
      failures: { listToolkits: [httpErr(429)], getRawTools: [httpErr(429), httpErr(401)] },
    });
    const logs: string[] = [];
    const res = await runFetch(opts(client, { log: (m) => logs.push(m), concurrency: 1 }));
    expect(calls.listToolkits).toBe(2);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]?.error).toContain("401");
    expect(res.fetched).toHaveLength(2);
    expect(readManifest().failures).toEqual(res.failures);
    expect(logs.some((l) => l.includes("retry 1"))).toBe(true);
  });

  it("toolkits filter fetches only those and reports unknown slugs", async () => {
    const { client, calls } = fakeClient(catalog);
    const res = await runFetch(opts(client, { toolkits: ["slack", "nope"] }));
    expect(calls.listToolkits).toBe(0);
    expect(res.fetched).toEqual(["slack"]);
    expect(res.failures.map((f) => f.slug)).toEqual(["nope"]);
  });

  it("maxTools trims but records the full count", async () => {
    const big: FakeToolkit = { slug: "github", toolsCount: 50, tools: tools("GITHUB", 50) };
    const { client } = fakeClient([big]);
    await runFetch(opts(client, { maxTools: 10 }));
    const file = readToolkitFile(dir, "github");
    expect(file?.tools).toHaveLength(10);
    expect(file?.fullToolCount).toBe(50);
    expect(readManifest().toolkits.github).toMatchObject({ tools: 10, fullTools: 50 });
  });
});
