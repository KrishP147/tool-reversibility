import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ReversibilityClass } from "./classification.js";
import {
  formatTokens,
  formatUsd,
  OPUS_MODEL,
  priceEstimate,
  SONNET_MODEL,
  CHARS_PER_TOKEN,
  type CostEstimate,
} from "./costEstimate.js";
import { anthropicApiKey, classifierModel, loadRepoEnv } from "./env.js";
import {
  CLASSES,
  createAnthropicBatchClient,
  DEFAULT_CLASSIFIER_MODEL,
  estimateRequests,
  llmCacheRoot,
  loadPrompt,
  planLlm,
  PROMPT_VERSION,
  runLlmClassify,
  type BatchClient,
} from "./llm.js";
import type { SnapshotTool } from "./normalize.js";
import { catalogRoot, findRepoRoot } from "./paths.js";
import type { CommandResult, ParsedArgs } from "./program.js";
import { listSnapshotSlugs, MANIFEST_FILE, readToolkitFile } from "./snapshot.js";

export interface ClassifyCommandDeps {
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  /** Client factory; only called for a `--live` run with a key. Tests assert it is never called otherwise. */
  createClient?: (apiKey: string) => BatchClient;
  /** Overrides fixtures/llm-cache (tests use a temp dir). */
  cacheRoot?: string;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

const DATED = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `--snapshot` (absolute or repo-relative), else the newest dated snapshot
 * under fixtures/catalog that has a manifest, else the committed trimmed one.
 */
export function resolveSnapshotDir(repoRoot: string, arg: string | null): string {
  if (arg) return path.isAbsolute(arg) ? arg : path.join(repoRoot, arg);
  const root = catalogRoot(repoRoot);
  let dated: string[] = [];
  try {
    dated = readdirSync(root)
      .filter((n) => DATED.test(n) && existsSync(path.join(root, n, MANIFEST_FILE)))
      .sort();
  } catch {
    // no catalog dir
  }
  const latest = dated[dated.length - 1];
  return path.join(root, latest ?? "trimmed");
}

export function loadSnapshotTools(dir: string, toolkits: string[] | null): SnapshotTool[] {
  const want = toolkits ? new Set(toolkits) : null;
  const tools: SnapshotTool[] = [];
  for (const slug of listSnapshotSlugs(dir)) {
    if (want && !want.has(slug)) continue;
    const file = readToolkitFile(dir, slug);
    if (file) tools.push(...file.tools);
  }
  return tools;
}

function costLine(c: CostEstimate): string {
  return (
    `    ${c.model}: input ~${formatTokens(c.inputTokens)} tok, output ~${formatTokens(c.outputTokens)} tok` +
    ` -> ${formatUsd(c.totalUsd)} (in ${formatUsd(c.inputUsd)} + out ${formatUsd(c.outputUsd)})`
  );
}

/** `audit classify`: rules (#3) and/or the LLM pass over a snapshot. */
export async function classifyCommand(
  args: ParsedArgs,
  deps: ClassifyCommandDeps = {},
): Promise<CommandResult> {
  const repoRoot = deps.repoRoot ?? findRepoRoot();
  const env = deps.env ?? process.env;
  if (!deps.env) loadRepoEnv(repoRoot);
  const log = deps.log ?? ((m: string) => console.log(m));

  const dir = resolveSnapshotDir(repoRoot, args.snapshot);
  if (!existsSync(dir)) {
    return { output: `classify: snapshot dir not found: ${dir}`, exitCode: 2 };
  }
  const tools = loadSnapshotTools(dir, args.toolkits);
  const rel = (path.relative(repoRoot, dir) || ".").split(path.sep).join("/");
  const lines = [`classify: snapshot ${rel.startsWith("..") ? dir : rel}, ${tools.length} tools`];
  if (tools.length === 0) {
    lines.push("classify: no tools found (check --snapshot / --toolkits)");
    return { output: lines.join("\n"), exitCode: 2 };
  }

  const runRules = args.rules || !args.llm;
  const runLlm = args.llm || !args.rules;
  let exitCode = 0;

  if (runRules) {
    // TODO(#3): wire rulesCommand from ./rulesCommand.js once #3 lands.
    lines.push("rules: not implemented (#3)");
  }
  if (!runLlm) return { output: lines.join("\n"), exitCode };

  const deprecated = tools.filter((t) => t.isDeprecated).length;
  const llmTools = args.includeDeprecated ? tools : tools.filter((t) => !t.isDeprecated);
  const model = args.model ?? classifierModel(env) ?? DEFAULT_CLASSIFIER_MODEL;
  const cacheRoot = deps.cacheRoot ?? llmCacheRoot(repoRoot);
  const system = loadPrompt(repoRoot);
  const depNote = args.includeDeprecated
    ? `${deprecated} deprecated included (--include-deprecated)`
    : `${deprecated} deprecated excluded (--include-deprecated to add)`;

  if (args.dryRun) {
    // D11 gate: estimate only. No client is constructed, no key is read.
    lines.push(
      `llm dry-run: prompt ${PROMPT_VERSION}, Batch prices, local estimate at ${CHARS_PER_TOKEN} chars/token (no API call)`,
      `  ${llmTools.length} tools for the LLM; ${depNote}`,
    );
    const models = [SONNET_MODEL, OPUS_MODEL];
    if (!models.includes(model)) models.push(model);
    for (const m of models) {
      // Only real results count as hits: recorded fixtures would still cost money live.
      const plan = planLlm({ tools: llmTools, model: m, cacheRoot, acceptProvenance: ["live"] });
      const t = estimateRequests(system, plan.requests);
      lines.push(
        `  ${m}: ${plan.hits.size} cache hits (excluded), ${t.tools} to send in ${t.requests} requests`,
      );
      const c = priceEstimate(m, t);
      lines.push(c ? costLine(c) : `    ${m}: no known Batch price; add it to costEstimate.ts`);
    }
    lines.push(
      `  selected model: ${model}`,
      "  nothing was sent. A live run needs --live, ANTHROPIC_API_KEY and the user's approval of this cost (D11).",
    );
    return { output: lines.join("\n"), exitCode };
  }

  // A live run re-classifies anything not backed by a real result.
  const accept = args.live ? (["live"] as const) : (["live", "recorded"] as const);
  const plan = planLlm({ tools: llmTools, model, cacheRoot, acceptProvenance: [...accept] });
  let client: BatchClient | null = null;
  if (plan.misses.length > 0) {
    if (!args.live) {
      lines.push(
        `llm: ${plan.misses.length} of ${llmTools.length} tools not cached for ${model}; refusing to call the API.`,
        "  Run with --dry-run for the cost, then --live (with ANTHROPIC_API_KEY) once the user approves it (D11).",
      );
      return { output: lines.join("\n"), exitCode: 2 };
    }
    const key = anthropicApiKey(env);
    if (!key) {
      lines.push("llm: --live needs ANTHROPIC_API_KEY (add it to .env at the repo root)");
      return { output: lines.join("\n"), exitCode: 2 };
    }
    client = (deps.createClient ?? createAnthropicBatchClient)(key);
  }

  const res = await runLlmClassify({
    tools: llmTools,
    model,
    cacheRoot,
    systemPrompt: system,
    client,
    acceptProvenance: [...accept],
    sleep: deps.sleep,
    log,
  });
  const counts = Object.fromEntries(CLASSES.map((c) => [c, 0])) as Record<
    ReversibilityClass,
    number
  >;
  for (const r of res.results.values()) counts[r.class] += 1;
  lines.push(
    `llm (${model}, ${PROMPT_VERSION}): ${llmTools.length} tools; ${depNote}`,
    `  cache hits ${res.hits}, misses ${res.misses}, requests sent ${res.submittedRequests}, cached ${res.written}` +
      (res.batchIds.length ? `, batches ${res.batchIds.join(",")}` : ""),
    `  ${CLASSES.map((c) => `${c} ${counts[c]}`).join(", ")}`,
  );
  if (res.recordedHits > 0) {
    lines.push(
      `  note: ${res.recordedHits} results are recorded fixtures (synthetic, not model output); not usable for reports`,
    );
  }
  if (res.failed.length > 0) {
    const reasons = new Map<string, number>();
    for (const f of res.failed) reasons.set(f.reason, (reasons.get(f.reason) ?? 0) + 1);
    lines.push(
      `  ${res.failed.length} tools left unknown and uncached: ${[...reasons].map(([r, n]) => `${r} ${n}`).join(", ")}`,
    );
    exitCode = 1;
  }
  return { output: lines.join("\n"), exitCode };
}
