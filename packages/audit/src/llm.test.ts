import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSnapshotTools } from "./classifyCommand.js";
import {
  BATCH_PRICES,
  estimateTokens,
  OPUS_MODEL,
  priceEstimate,
  SONNET_MODEL,
} from "./costEstimate.js";
import {
  buildBatchRequest,
  cacheFile,
  cacheKey,
  canonicalJson,
  compactParams,
  interpretLine,
  llmCacheRoot,
  loadPrompt,
  OUTPUT_SCHEMA,
  packRequests,
  parseOutput,
  planLlm,
  PROMPT_VERSION,
  readCache,
  runLlmClassify,
  toPackItem,
  type BatchRequest,
  type BatchResultLine,
  type LlmToolOutput,
} from "./llm.js";
import type { SnapshotTool } from "./normalize.js";
import { findRepoRoot } from "./paths.js";
import {
  recordedDir,
  SAMPLE_OUTCOMES,
  SAMPLE_PACK,
  SAMPLE_TOOLS,
  syntheticAnswer,
  trimmedDir,
} from "./testing/buildLlmFixture.js";
import {
  createFakeBatchClient,
  promptToolsOf,
  recordedResponder,
  replayLines,
  succeeded,
} from "./testing/fakeAnthropic.js";

const repoRoot = findRepoRoot();
const system = loadPrompt(repoRoot);
const trimmed = loadSnapshotTools(trimmedDir(repoRoot), null);
const live = trimmed.filter((t) => !t.isDeprecated);
const answers = JSON.parse(
  readFileSync(path.join(recordedDir(repoRoot), "trimmed.answers.json"), "utf8"),
) as { answers: Record<string, Omit<LlmToolOutput, "slug">> };
const sampleLines = readFileSync(
  path.join(recordedDir(repoRoot), "batch-results.sample.jsonl"),
  "utf8",
)
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as BatchResultLine);
const noSleep = async () => {};

function tool(slug: string, extra: Partial<SnapshotTool> = {}): SnapshotTool {
  return {
    slug,
    name: slug,
    description: `${slug} description`,
    tags: ["openWorldHint"],
    inputParameters: { type: "object", properties: { id: { type: "string", description: "id" } } },
    toolkit: { slug: "demo", name: "Demo" },
    version: "1",
    isDeprecated: false,
    scopes: [],
    ...extra,
  };
}

let cacheRoot: string;
beforeEach(() => {
  cacheRoot = mkdtempSync(path.join(tmpdir(), "llm-cache-"));
});
afterEach(() => rmSync(cacheRoot, { recursive: true, force: true }));

function cachedCount(model = SONNET_MODEL): number {
  const dir = path.join(cacheRoot, model);
  return existsSync(dir) ? readdirSync(dir).length : 0;
}

describe("cache key", () => {
  it("is independent of object key order at any depth", () => {
    const a = tool("DEMO_SEND");
    const b = {
      scopes: [],
      isDeprecated: false,
      version: "1",
      toolkit: { name: "Demo", slug: "demo" },
      inputParameters: {
        properties: { id: { description: "id", type: "string" } },
        type: "object",
      },
      tags: ["openWorldHint"],
      description: "DEMO_SEND description",
      name: "DEMO_SEND",
      slug: "DEMO_SEND",
    } as SnapshotTool;
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(cacheKey(a)).toBe(cacheKey(b));
    expect(cacheKey(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with the prompt version, the content and array order", () => {
    const a = tool("DEMO_SEND");
    expect(cacheKey(a, "classify.v2")).not.toBe(cacheKey(a));
    expect(cacheKey(tool("DEMO_SEND", { description: "x" }))).not.toBe(cacheKey(a));
    expect(cacheKey(tool("DEMO_SEND", { tags: ["b", "a"] }))).not.toBe(
      cacheKey(tool("DEMO_SEND", { tags: ["a", "b"] })),
    );
  });

  it("lays files out as <model>/<sha256>.json", () => {
    const key = cacheKey(tool("DEMO_SEND"));
    expect(cacheFile("/c", "claude-sonnet-5", key)).toBe(
      path.join("/c", "claude-sonnet-5", `${key}.json`),
    );
  });
});

describe("compaction + packing", () => {
  const bigParams = {
    type: "object",
    required: ["p0"],
    properties: Object.fromEntries(
      Array.from({ length: 300 }, (_, i) => [
        `p${i}`,
        { type: "string", description: `param ${i} ${"x".repeat(400)}`, enum: ["a", "b"] },
      ]),
    ),
  };

  it("leaves small schemas alone and compacts big ones to names + descriptions", () => {
    const small = tool("DEMO_GET").inputParameters;
    expect(compactParams(small)).toEqual(small);
    const c = compactParams(bigParams) as Record<string, unknown>;
    expect(c.compacted).toBe(true);
    expect(c.required).toEqual(["p0"]);
    expect(c.omittedProperties).toBe(220);
    expect(Object.keys(c.properties as object)).toHaveLength(80);
    expect(JSON.stringify(c).length).toBeLessThan(JSON.stringify(bigParams).length / 5);
    expect(compactParams(bigParams)).toEqual(c); // deterministic
  });

  it("hashes the full tool, not the compacted prompt form", () => {
    const a = tool("DEMO_BIG", { inputParameters: bigParams });
    const tweaked = structuredClone(bigParams);
    (tweaked.properties.p299 as { enum: string[] }).enum = ["a", "c"]; // same length, cut by compaction
    const b = tool("DEMO_BIG", { inputParameters: tweaked });
    expect(toPackItem(a).prompt).toEqual(toPackItem(b).prompt);
    expect(cacheKey(a)).not.toBe(cacheKey(b));
  });

  it("packs by token budget, puts an oversized tool alone, caps tools per request", () => {
    const huge = tool("DEMO_HUGE", { description: "d".repeat(7000) });
    const items = [
      ...Array.from({ length: 7 }, (_, i) => toPackItem(tool(`DEMO_T${i}`))),
      toPackItem(huge),
      toPackItem(tool("DEMO_AFTER")),
    ];
    const budget = 500;
    expect(items[7]!.tokens).toBeGreaterThan(budget);
    const reqs = packRequests(items, { maxToolTokensPerRequest: budget, maxToolsPerRequest: 3 });
    expect(reqs.map((r) => r.items.map((i) => i.tool.slug))).toEqual([
      ["DEMO_T0", "DEMO_T1", "DEMO_T2"],
      ["DEMO_T3", "DEMO_T4", "DEMO_T5"],
      ["DEMO_T6"],
      ["DEMO_HUGE"],
      ["DEMO_AFTER"],
    ]);
    for (const r of reqs.filter((r) => r.items.length > 1)) {
      expect(r.toolTokens).toBeLessThanOrEqual(budget);
    }
    expect(new Set(reqs.map((r) => r.customId)).size).toBe(reqs.length);
    reqs.forEach((r) => expect(r.customId).toMatch(/^[a-zA-Z0-9_-]{1,64}$/));
  });

  it("never puts the same slug twice in one request", () => {
    const reqs = packRequests([
      toPackItem(tool("DEMO_X")),
      toPackItem(tool("DEMO_X", { version: "2" })),
    ]);
    expect(reqs).toHaveLength(2);
  });

  it("packs the default budget with more than a fixed count when tools are small", () => {
    const items = Array.from({ length: 60 }, (_, i) => toPackItem(tool(`DEMO_S${i}`)));
    expect(packRequests(items).map((r) => r.items.length)).toEqual([25, 25, 10]);
    expect(
      packRequests(items, { maxToolTokensPerRequest: 200, maxToolsPerRequest: 100 }).length,
    ).toBeGreaterThan(3);
  });
});

describe("request shape", () => {
  it("uses json_schema output, effort low, thinking disabled, no temperature/prefill", () => {
    const [req] = packRequests([toPackItem(tool("DEMO_SEND"))]);
    const r = buildBatchRequest(SONNET_MODEL, system, req!);
    expect(r.custom_id).toBe("req-00000");
    expect(r.params.model).toBe("claude-sonnet-5");
    expect(r.params.thinking).toEqual({ type: "disabled" });
    expect(r.params.output_config).toEqual({
      effort: "low",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    });
    expect(r.params).not.toHaveProperty("temperature");
    expect(r.params.messages).toHaveLength(1);
    expect(r.params.messages[0]!.role).toBe("user");
    expect(promptToolsOf(r).map((t) => t.slug)).toEqual(["DEMO_SEND"]);
    const json = JSON.stringify(OUTPUT_SCHEMA);
    expect(json).not.toContain("maxLength");
    expect(json).toContain('"additionalProperties":false');
  });

  it("loads the prompt from prompts/classify.v1.md at ~1.5k tokens", () => {
    expect(PROMPT_VERSION).toBe("classify.v1");
    const t = estimateTokens(system);
    expect(t).toBeGreaterThan(1200);
    expect(t).toBeLessThan(1900);
  });
});

describe("parsing", () => {
  it("keeps valid entries, clips rationale to 200, drops bad classes", () => {
    const out = parseOutput(
      JSON.stringify({
        results: [
          { slug: "A", class: "irreversible", inverse_tool: null, rationale: "r".repeat(300) },
          { slug: "B", class: "maybe", inverse_tool: null, rationale: "x" },
          { slug: "C", class: "compensable", inverse_tool: " C_UNDO ", rationale: "ok" },
        ],
      }),
    );
    expect(out).toEqual([
      { slug: "A", class: "irreversible", inverse_tool: null, rationale: "r".repeat(200) },
      { slug: "C", class: "compensable", inverse_tool: "C_UNDO", rationale: "ok" },
    ]);
    expect(parseOutput("not json")).toBeNull();
    expect(parseOutput("{}")).toBeNull();
  });

  it("maps refusal / max_tokens / errored / expired / canceled to failure reasons", () => {
    const line = (result: BatchResultLine["result"]): BatchResultLine => ({
      custom_id: "x",
      result,
    });
    expect(interpretLine(line(succeeded("", "refusal")))).toEqual({ ok: false, reason: "refusal" });
    expect(interpretLine(line(succeeded('{"res', "max_tokens")))).toMatchObject({ ok: false });
    for (const type of ["expired", "canceled"] as const) {
      expect(interpretLine(line({ type }))).toEqual({ ok: false, reason: type });
    }
  });
});

describe("runLlmClassify (fake client, recorded answers)", () => {
  const respond = recordedResponder(answers.answers);

  it("submits misses, caches results, then re-runs at 100% hits with no batch", async () => {
    const fake = createFakeBatchClient({ respond, pollsBeforeEnd: 2 });
    let sleeps = 0;
    const opts = {
      tools: live,
      model: SONNET_MODEL,
      cacheRoot,
      systemPrompt: system,
      sleep: async () => {
        sleeps += 1;
      },
    };
    const first = await runLlmClassify({ ...opts, client: fake });
    expect(first).toMatchObject({ hits: 0, misses: live.length, written: live.length });
    expect(first.batchIds).toEqual(["msgbatch_fake_0"]);
    expect(first.failed).toEqual([]);
    expect(sleeps).toBe(2);
    expect(fake.created).toHaveLength(1);
    expect(cachedCount()).toBe(live.length);
    const send = first.results.get("GMAIL_SEND_EMAIL");
    expect(send?.class).toBe(answers.answers.GMAIL_SEND_EMAIL!.class);
    expect(send?.confidence).toBe(0.7);

    const again = createFakeBatchClient({ respond });
    const second = await runLlmClassify({ ...opts, client: again });
    expect(second).toMatchObject({ hits: live.length, misses: 0, submittedRequests: 0 });
    expect(again.created).toHaveLength(0);
    expect(second.results).toEqual(first.results);
  });

  it("keys by custom_id and slug, not position, when lines and entries are shuffled", async () => {
    const reversed = (req: BatchRequest) => {
      const r = respond(req)!;
      if (r.type !== "succeeded") return r;
      const block = r.message.content[0] as { text: string };
      const data = JSON.parse(block.text) as { results: unknown[] };
      data.results.reverse();
      return succeeded(JSON.stringify(data));
    };
    const fake = createFakeBatchClient({ respond: reversed, shuffle: true });
    const res = await runLlmClassify({
      tools: live,
      model: SONNET_MODEL,
      cacheRoot,
      systemPrompt: system,
      client: fake,
      pack: { maxToolsPerRequest: 7 },
      sleep: noSleep,
    });
    expect(fake.created[0]!.length).toBeGreaterThan(1);
    for (const t of live) {
      const a = answers.answers[t.slug]!;
      expect(res.results.get(t.slug)?.class).toBe(a.class);
      expect(res.results.get(t.slug)?.reasons[0]).toBe(a.rationale);
    }
    const entry = readCache(cacheRoot, SONNET_MODEL, cacheKey(live[0]!));
    expect(entry?.slug).toBe(live[0]!.slug);
    expect(entry?.provenance).toBe("live");
  });

  it("recorded refusal/errored/expired/canceled -> unknown for every tool in the request, not cached", async () => {
    const tools = live.slice(0, SAMPLE_TOOLS);
    const fake = createFakeBatchClient({ respond: replayLines(sampleLines), shuffle: true });
    const res = await runLlmClassify({
      tools,
      model: SONNET_MODEL,
      cacheRoot,
      systemPrompt: system,
      client: fake,
      pack: SAMPLE_PACK,
      sleep: noSleep,
    });
    const reqs = fake.created[0]!;
    expect(reqs.map((r) => r.custom_id)).toEqual(sampleLines.map((l) => l.custom_id));
    expect(cachedCount()).toBe(5);
    expect(res.written).toBe(5);
    SAMPLE_OUTCOMES.forEach((outcome, i) => {
      for (const slug of promptToolsOf(reqs[i]!).map((t) => t.slug)) {
        const r = res.results.get(slug)!;
        if (outcome === "succeeded") {
          expect(r.class).toBe(answers.answers[slug]!.class);
        } else {
          expect(r).toEqual({ class: "unknown", confidence: 0, reasons: [`llm: ${outcome}`] });
          const tool = tools.find((t) => t.slug === slug)!;
          expect(readCache(cacheRoot, SONNET_MODEL, cacheKey(tool))).toBeNull();
        }
      }
    });
    expect(res.failed).toHaveLength(20);
  });

  it("slug missing from output, max_tokens and a missing line stay unknown and uncached", async () => {
    const tools = [tool("DEMO_A"), tool("DEMO_B"), tool("DEMO_C")];
    const fake = createFakeBatchClient({
      respond: (req) => {
        if (req.custom_id === "req-00000") {
          return succeeded(
            JSON.stringify({
              results: [
                { slug: "DEMO_A", class: "reversible", inverse_tool: null, rationale: "r" },
              ],
            }),
          );
        }
        if (req.custom_id === "req-00001") return succeeded("{", "max_tokens");
        return null;
      },
    });
    const res = await runLlmClassify({
      tools: [...tools, tool("DEMO_D")],
      model: SONNET_MODEL,
      cacheRoot,
      systemPrompt: system,
      client: fake,
      pack: { maxToolsPerRequest: 2 },
      sleep: noSleep,
    });
    expect(res.results.get("DEMO_A")?.class).toBe("reversible");
    expect(res.failed).toEqual([
      { slug: "DEMO_B", reason: "slug missing from output" },
      { slug: "DEMO_C", reason: "max_tokens (truncated output)" },
      { slug: "DEMO_D", reason: "max_tokens (truncated output)" },
    ]);
    expect(cachedCount()).toBe(1);
  });

  it("with no client, misses come back unknown and nothing is sent", async () => {
    const res = await runLlmClassify({
      tools: [tool("DEMO_A")],
      model: SONNET_MODEL,
      cacheRoot,
      systemPrompt: system,
      client: null,
    });
    expect(res.results.get("DEMO_A")).toEqual({
      class: "unknown",
      confidence: 0,
      reasons: ["llm: not cached"],
    });
    expect(res.submittedRequests).toBe(0);
    expect(cachedCount()).toBe(0);
  });

  it("maps inverse_tool into reasons", async () => {
    const fake = createFakeBatchClient({
      respond: () =>
        succeeded(
          JSON.stringify({
            results: [
              {
                slug: "DEMO_CREATE_X",
                class: "compensable",
                inverse_tool: "DEMO_DELETE_X",
                rationale: "r",
              },
            ],
          }),
        ),
    });
    const res = await runLlmClassify({
      tools: [tool("DEMO_CREATE_X")],
      model: SONNET_MODEL,
      cacheRoot,
      systemPrompt: system,
      client: fake,
      sleep: noSleep,
    });
    expect(res.results.get("DEMO_CREATE_X")?.reasons).toEqual(["r", "inverse_tool: DEMO_DELETE_X"]);
  });
});

describe("committed trimmed cache", () => {
  it("covers every trimmed tool (re-run = 100% hits) and is all provenance 'recorded'", () => {
    const plan = planLlm({
      tools: trimmed,
      model: SONNET_MODEL,
      cacheRoot: llmCacheRoot(repoRoot),
    });
    expect(plan.misses).toHaveLength(0);
    expect(plan.hits.size).toBe(trimmed.length);
    for (const e of plan.hits.values()) {
      expect(e.provenance).toBe("recorded");
      expect(e.output).toEqual({ slug: e.slug, ...answers.answers[e.slug] });
    }
    const realOnly = planLlm({
      tools: trimmed,
      model: SONNET_MODEL,
      cacheRoot: llmCacheRoot(repoRoot),
      acceptProvenance: ["live"],
    });
    expect(realOnly.hits.size).toBe(0);
  });

  it("answers file matches the heuristic (regenerate with fixture:llm)", () => {
    for (const t of trimmed) expect(answers.answers[t.slug]).toEqual(syntheticAnswer(t));
  });
});

describe("cost estimate", () => {
  it("uses Batch prices (50% of standard)", () => {
    expect(BATCH_PRICES[SONNET_MODEL]).toEqual({ input: 1, output: 5 });
    expect(BATCH_PRICES[OPUS_MODEL]).toEqual({ input: 2.5, output: 12.5 });
    const c = priceEstimate(SONNET_MODEL, {
      requests: 1,
      tools: 1,
      inputTokens: 2_000_000,
      outputTokens: 1_000_000,
    });
    expect(c?.totalUsd).toBeCloseTo(7);
    expect(priceEstimate("claude-unknown", c!)).toBeNull();
    expect(estimateTokens("x".repeat(35))).toBe(10);
  });
});
