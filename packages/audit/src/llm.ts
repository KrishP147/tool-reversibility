/**
 * LLM classifier (plan §3a LLM, §6 item 4): Message Batches + structured
 * output, one cache file per tool (D4). Requests are keyed by `custom_id`;
 * results are keyed by `slug` inside the structured output, never by position.
 *
 * Spend guard (D11): nothing here builds an Anthropic client except
 * createAnthropicBatchClient, which only classifyCommand calls, only for an
 * approved `--live` run. Dry runs, cache-only re-runs and tests pass
 * `client: null` or a fake.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { ClassifierResult, ReversibilityClass } from "./classification.js";
import {
  estimateTokens,
  OUTPUT_TOKENS_PER_REQUEST,
  OUTPUT_TOKENS_PER_TOOL,
  SONNET_MODEL,
  type TokenEstimate,
} from "./costEstimate.js";
import type { SnapshotTool } from "./normalize.js";
import { writeJsonAtomic } from "./snapshot.js";

export const PROMPT_VERSION = "classify.v1";
/** D11: sonnet for the full pass; opus re-judges disagreements (approval-gated). */
export const DEFAULT_CLASSIFIER_MODEL = SONNET_MODEL;
/** Fixed confidence for a classification the model returned. */
export const LLM_CONFIDENCE = 0.7;
export const RATIONALE_MAX = 200;
export const CACHE_SCHEMA_VERSION = 1;

export const CLASSES: readonly ReversibilityClass[] = [
  "reversible",
  "compensable",
  "irreversible",
  "unknown",
];

// ---------------------------------------------------------------- paths

export function promptFile(repoRoot: string, version = PROMPT_VERSION): string {
  return path.join(repoRoot, "prompts", `${version}.md`);
}

/** The system prompt, LF-normalized so a CRLF checkout sends the same bytes. */
export function loadPrompt(repoRoot: string, version = PROMPT_VERSION): string {
  return readFileSync(promptFile(repoRoot, version), "utf8").replace(/\r\n/g, "\n").trim();
}

export function llmCacheRoot(repoRoot: string): string {
  return path.join(repoRoot, "fixtures", "llm-cache");
}

// ---------------------------------------------------------------- cache key

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** JSON with object keys sorted at every depth, so key order never changes the hash. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!isRec(v)) return v;
  const out: Rec = {};
  for (const k of Object.keys(v).sort()) {
    if (v[k] !== undefined) out[k] = sortKeys(v[k]);
  }
  return out;
}

/** D4: sha256(prompt_version + canonical tool JSON). Hashes the FULL tool, never the compacted prompt form. */
export function cacheKey(tool: SnapshotTool, promptVersion = PROMPT_VERSION): string {
  return createHash("sha256")
    .update(promptVersion + canonicalJson(tool))
    .digest("hex");
}

export function cacheFile(cacheRoot: string, model: string, key: string): string {
  return path.join(cacheRoot, model, `${key}.json`);
}

/**
 * `live` = a real Batches result. `recorded` = replayed from
 * fixtures/llm-recorded (synthetic test data, NOT model output); dry runs and
 * `--live` runs treat recorded entries as misses.
 */
export type Provenance = "live" | "recorded";

export interface LlmToolOutput {
  slug: string;
  class: ReversibilityClass;
  inverse_tool: string | null;
  rationale: string;
}

export interface CacheEntry {
  schemaVersion: number;
  promptVersion: string;
  model: string;
  key: string;
  slug: string;
  provenance: Provenance;
  output: LlmToolOutput;
  result: ClassifierResult;
}

export function readCache(cacheRoot: string, model: string, key: string): CacheEntry | null {
  const file = cacheFile(cacheRoot, model, key);
  if (!existsSync(file)) return null;
  try {
    const e = JSON.parse(readFileSync(file, "utf8")) as Partial<CacheEntry>;
    if (
      e.schemaVersion !== CACHE_SCHEMA_VERSION ||
      e.key !== key ||
      !e.result ||
      !CLASSES.includes(e.result.class)
    ) {
      return null;
    }
    return e as CacheEntry;
  } catch {
    return null;
  }
}

export function writeCache(cacheRoot: string, entry: CacheEntry): void {
  writeJsonAtomic(cacheFile(cacheRoot, entry.model, entry.key), entry);
}

// ---------------------------------------------------------------- prompt form

/** Parameter schemas longer than this (JSON chars) are compacted to names + descriptions. */
export const PARAM_CHAR_LIMIT = 6000;
export const COMPACT_MAX_PROPERTIES = 80;
export const COMPACT_DESCRIPTION_CHARS = 160;
export const DESCRIPTION_CHAR_LIMIT = 8000;

export interface PromptTool {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  toolkit: string;
  deprecated?: true;
  inputParameters: unknown;
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…[+${s.length - max} chars]`;
}

/**
 * Deterministic compaction of an oversized parameter schema: top-level
 * property names with clipped descriptions, `required`, and how much was cut.
 * Only the prompt sees this; the cache key hashes the full tool.
 */
export function compactParams(params: unknown, limit = PARAM_CHAR_LIMIT): unknown {
  const full = JSON.stringify(params ?? null);
  if (full.length <= limit) return params ?? null;
  const props = isRec(params) && isRec(params.properties) ? params.properties : {};
  const names = Object.keys(props);
  const kept = names.slice(0, COMPACT_MAX_PROPERTIES);
  const properties: Record<string, string> = {};
  for (const n of kept) {
    const p = props[n];
    const d = isRec(p) && typeof p.description === "string" ? p.description : "";
    properties[n] = clip(d, COMPACT_DESCRIPTION_CHARS);
  }
  const required =
    isRec(params) && Array.isArray(params.required)
      ? params.required.filter((r): r is string => typeof r === "string")
      : [];
  return {
    compacted: true,
    originalChars: full.length,
    required,
    properties,
    ...(names.length > kept.length ? { omittedProperties: names.length - kept.length } : {}),
  };
}

export function toPromptTool(tool: SnapshotTool): PromptTool {
  return {
    slug: tool.slug,
    name: tool.name,
    description: clip(tool.description, DESCRIPTION_CHAR_LIMIT),
    tags: tool.tags,
    toolkit: tool.toolkit.slug,
    ...(tool.isDeprecated ? { deprecated: true as const } : {}),
    inputParameters: compactParams(tool.inputParameters),
  };
}

// ---------------------------------------------------------------- packing

export interface PackOptions {
  /** Budget for the tools JSON of one request, in estimated tokens (system prompt excluded). */
  maxToolTokensPerRequest: number;
  /** Hard cap so the structured output stays well under max_tokens. */
  maxToolsPerRequest: number;
}

export const DEFAULT_PACK: PackOptions = {
  maxToolTokensPerRequest: 40_000,
  maxToolsPerRequest: 25,
};

export interface PackItem {
  key: string;
  tool: SnapshotTool;
  prompt: PromptTool;
  tokens: number;
}

export interface PackedRequest {
  customId: string;
  items: PackItem[];
  toolTokens: number;
}

export function toPackItem(tool: SnapshotTool, key = cacheKey(tool)): PackItem {
  const prompt = toPromptTool(tool);
  return { key, tool, prompt, tokens: estimateTokens(JSON.stringify(prompt)) + 1 };
}

/**
 * Greedy pack by token budget (not a fixed count): a request closes when the
 * next tool would overflow the budget, the tool cap is hit, or a slug would
 * repeat (results are keyed by slug). A tool bigger than the budget goes alone.
 */
export function packRequests(items: PackItem[], opts: Partial<PackOptions> = {}): PackedRequest[] {
  const o = { ...DEFAULT_PACK, ...opts };
  const out: PackedRequest[] = [];
  let cur: PackItem[] = [];
  let tokens = 0;
  const flush = () => {
    if (cur.length === 0) return;
    out.push({
      customId: `req-${String(out.length).padStart(5, "0")}`,
      items: cur,
      toolTokens: tokens,
    });
    cur = [];
    tokens = 0;
  };
  for (const it of items) {
    const dupSlug = cur.some((c) => c.tool.slug === it.tool.slug);
    if (
      cur.length > 0 &&
      (dupSlug ||
        tokens + it.tokens > o.maxToolTokensPerRequest ||
        cur.length >= o.maxToolsPerRequest)
    ) {
      flush();
    }
    cur.push(it);
    tokens += it.tokens;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- request shape

export const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          slug: { type: "string" },
          class: { type: "string", enum: [...CLASSES] },
          inverse_tool: { anyOf: [{ type: "string" }, { type: "null" }] },
          // ≤200 chars is asked for in the prompt and enforced on parse:
          // structured outputs do not support maxLength.
          rationale: { type: "string" },
        },
        required: ["slug", "class", "inverse_tool", "rationale"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

export type BatchRequest = Anthropic.Messages.Batches.BatchCreateParams.Request;
export type BatchResultLine = Anthropic.Messages.Batches.MessageBatchIndividualResponse;

export function userMessage(req: PackedRequest): string {
  const tools = JSON.stringify(req.items.map((i) => i.prompt));
  return `Classify these ${req.items.length} tools. Return exactly one result per slug.\n\n${tools}`;
}

export function maxTokensFor(toolCount: number): number {
  return Math.min(16_000, 1024 + 200 * toolCount);
}

/** No temperature (removed on current models), no prefill, no fallbacks (rejected on Batches). */
export function buildBatchRequest(model: string, system: string, req: PackedRequest): BatchRequest {
  return {
    custom_id: req.customId,
    params: {
      model,
      max_tokens: maxTokensFor(req.items.length),
      system,
      messages: [{ role: "user", content: userMessage(req) }],
      thinking: { type: "disabled" },
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
    },
  };
}

export function estimateRequests(system: string, reqs: PackedRequest[]): TokenEstimate {
  const sys = estimateTokens(system);
  let inputTokens = 0;
  let outputTokens = 0;
  let tools = 0;
  for (const r of reqs) {
    inputTokens += sys + estimateTokens(userMessage(r));
    outputTokens += OUTPUT_TOKENS_PER_REQUEST + OUTPUT_TOKENS_PER_TOOL * r.items.length;
    tools += r.items.length;
  }
  return { requests: reqs.length, tools, inputTokens, outputTokens };
}

// ---------------------------------------------------------------- results

export function unknownResult(reason: string): ClassifierResult {
  return { class: "unknown", confidence: 0, reasons: [`llm: ${reason}`] };
}

export function toClassifierResult(o: LlmToolOutput): ClassifierResult {
  return {
    class: o.class,
    confidence: LLM_CONFIDENCE,
    reasons: [o.rationale, ...(o.inverse_tool ? [`inverse_tool: ${o.inverse_tool}`] : [])],
  };
}

/** Parse the structured output; malformed entries are dropped (their tools fall back to unknown). */
export function parseOutput(text: string): LlmToolOutput[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRec(data) || !Array.isArray(data.results)) return null;
  const out: LlmToolOutput[] = [];
  for (const r of data.results) {
    if (!isRec(r) || typeof r.slug !== "string" || typeof r.rationale !== "string") continue;
    const cls = r.class as ReversibilityClass;
    if (!CLASSES.includes(cls)) continue;
    const inv =
      typeof r.inverse_tool === "string" && r.inverse_tool.trim() ? r.inverse_tool.trim() : null;
    out.push({
      slug: r.slug,
      class: cls,
      inverse_tool: inv,
      rationale: r.rationale.trim().slice(0, RATIONALE_MAX),
    });
  }
  return out;
}

export type LineOutcome = { ok: true; outputs: LlmToolOutput[] } | { ok: false; reason: string };

/** Map one batch result line to outputs, or to the reason every tool in it is `unknown`. */
export function interpretLine(line: BatchResultLine): LineOutcome {
  const r = line.result;
  if (r.type !== "succeeded") return { ok: false, reason: r.type };
  const msg = r.message;
  if (msg.stop_reason === "refusal") return { ok: false, reason: "refusal" };
  if (msg.stop_reason === "max_tokens") {
    return { ok: false, reason: "max_tokens (truncated output)" };
  }
  const text = msg.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const outputs = parseOutput(text);
  if (!outputs) return { ok: false, reason: "unparseable output" };
  return { ok: true, outputs };
}

// ---------------------------------------------------------------- client

/** The slice of the Batches API the classifier needs. Tests inject a fake. */
export interface BatchClient {
  create(requests: BatchRequest[]): Promise<{ id: string }>;
  retrieve(id: string): Promise<{ id: string; processing_status: string }>;
  results(id: string): Promise<AsyncIterable<BatchResultLine>>;
}

/** The only place an Anthropic client is constructed. Called for approved `--live` runs only. */
export function createAnthropicBatchClient(apiKey: string): BatchClient {
  const client = new Anthropic({ apiKey });
  return {
    create: (requests) => client.messages.batches.create({ requests }),
    retrieve: (id) => client.messages.batches.retrieve(id),
    results: (id) => client.messages.batches.results(id),
  };
}

// ---------------------------------------------------------------- plan + run

export interface PlanOptions {
  tools: SnapshotTool[];
  model: string;
  cacheRoot: string;
  /** Which cache entries count as hits. Dry runs and `--live` accept only real results. */
  acceptProvenance?: Provenance[];
  pack?: Partial<PackOptions>;
}

export interface LlmPlan {
  hits: Map<string, CacheEntry>;
  /** Unique uncached tools, by cache key. */
  misses: PackItem[];
  requests: PackedRequest[];
  /** Cache key per input tool, same order as `tools`. */
  keys: string[];
}

export function planLlm(o: PlanOptions): LlmPlan {
  const accept = o.acceptProvenance ?? ["live", "recorded"];
  const hits = new Map<string, CacheEntry>();
  const missByKey = new Map<string, PackItem>();
  const keys: string[] = [];
  for (const tool of o.tools) {
    const key = cacheKey(tool);
    keys.push(key);
    if (hits.has(key) || missByKey.has(key)) continue;
    const entry = readCache(o.cacheRoot, o.model, key);
    if (entry && accept.includes(entry.provenance)) hits.set(key, entry);
    else missByKey.set(key, toPackItem(tool, key));
  }
  const misses = [...missByKey.values()];
  return { hits, misses, keys, requests: packRequests(misses, o.pack) };
}

/** Batch limits are 100k requests / 256 MB; stay well under both. */
export const MAX_REQUESTS_PER_BATCH = 10_000;
export const MAX_BATCH_BYTES = 200 * 1024 * 1024;

export function chunkBatches(reqs: BatchRequest[]): BatchRequest[][] {
  const out: BatchRequest[][] = [];
  let cur: BatchRequest[] = [];
  let bytes = 0;
  for (const r of reqs) {
    const size = Buffer.byteLength(JSON.stringify(r));
    if (
      cur.length > 0 &&
      (cur.length >= MAX_REQUESTS_PER_BATCH || bytes + size > MAX_BATCH_BYTES)
    ) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(r);
    bytes += size;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

export interface RunOptions extends PlanOptions {
  systemPrompt: string;
  /** null = cache-only: misses come back `unknown`, nothing is sent. */
  client: BatchClient | null;
  /** Provenance stamped on newly written cache entries. */
  provenance?: Provenance;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

export interface RunResult {
  /** Result per input tool slug. */
  results: Map<string, ClassifierResult>;
  hits: number;
  /** Hits that are recorded fixtures (synthetic), not real model output. */
  recordedHits: number;
  misses: number;
  submittedRequests: number;
  batchIds: string[];
  written: number;
  /** Tools left `unknown` and not cached, with why. */
  failed: { slug: string; reason: string }[];
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runLlmClassify(o: RunOptions): Promise<RunResult> {
  const log = o.log ?? (() => {});
  const plan = planLlm(o);
  const byKey = new Map<string, ClassifierResult>();
  for (const [k, e] of plan.hits) byKey.set(k, e.result);
  const failed: RunResult["failed"] = [];
  const batchIds: string[] = [];
  let written = 0;
  let submittedRequests = 0;

  const fail = (it: PackItem, reason: string) => {
    byKey.set(it.key, unknownResult(reason));
    failed.push({ slug: it.tool.slug, reason });
  };

  if (plan.requests.length > 0 && o.client) {
    const client = o.client;
    const byId = new Map(plan.requests.map((r) => [r.customId, r]));
    const seen = new Set<string>();
    const settle = (req: PackedRequest, outcome: LineOutcome) => {
      const bySlug = new Map(outcome.ok ? outcome.outputs.map((x) => [x.slug, x]) : []);
      for (const it of req.items) {
        const out = bySlug.get(it.tool.slug);
        if (!out) {
          fail(it, outcome.ok ? "slug missing from output" : outcome.reason);
          continue;
        }
        const result = toClassifierResult(out);
        byKey.set(it.key, result);
        writeCache(o.cacheRoot, {
          schemaVersion: CACHE_SCHEMA_VERSION,
          promptVersion: PROMPT_VERSION,
          model: o.model,
          key: it.key,
          slug: it.tool.slug,
          provenance: o.provenance ?? "live",
          output: out,
          result,
        });
        written += 1;
      }
    };

    const all = plan.requests.map((r) => buildBatchRequest(o.model, o.systemPrompt, r));
    for (const chunk of chunkBatches(all)) {
      const batch = await client.create(chunk);
      batchIds.push(batch.id);
      submittedRequests += chunk.length;
      log(`llm: submitted batch ${batch.id} (${chunk.length} requests)`);
      for (;;) {
        const b = await client.retrieve(batch.id);
        if (b.processing_status === "ended") break;
        log(`llm: batch ${batch.id} ${b.processing_status}`);
        await (o.sleep ?? realSleep)(o.pollIntervalMs ?? 60_000);
      }
      for await (const line of await client.results(batch.id)) {
        const req = byId.get(line.custom_id);
        if (!req || seen.has(line.custom_id)) continue;
        seen.add(line.custom_id);
        settle(req, interpretLine(line));
      }
    }
    for (const req of plan.requests) {
      if (!seen.has(req.customId)) settle(req, { ok: false, reason: "no result line" });
    }
  } else {
    for (const it of plan.misses) fail(it, "not cached");
  }

  const results = new Map<string, ClassifierResult>();
  o.tools.forEach((t, i) => {
    const r = byKey.get(plan.keys[i] ?? "");
    if (r) results.set(t.slug, r);
  });
  return {
    results,
    hits: plan.hits.size,
    recordedHits: [...plan.hits.values()].filter((e) => e.provenance === "recorded").length,
    misses: plan.misses.length,
    submittedRequests,
    batchIds,
    written,
    failed,
  };
}
