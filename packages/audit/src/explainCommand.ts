/**
 * `audit explain <slug>`: single-tool deep-dive (plan §3a/§13, D2/D31/D33).
 * Reads only the local snapshot and the on-disk LLM cache -- never the
 * network or the Anthropic API -- and prints:
 *   - toolkit + raw tags -> the 7 known hints (deriveHints), other tags too
 *   - derived tier (deriveTier, always "derived": D20/D22)
 *   - rule classifier verdict: class/confidence/reasons (classifyTool)
 *   - LLM cache state for the current model + PROMPT_VERSION, via
 *     cacheKey/readCache: `live` (a real Batches result), `recorded`
 *     (synthetic fixture, NOT a model verdict, D31), or `miss`
 *   - GAP (rules + LIVE LLM both irreversible, no destructiveHint, D2) and
 *     single-gap (rules irreversible, no destructiveHint) -- a recorded
 *     cache entry never counts toward GAP
 *   - the spot-check label + rationale, when the slug has one
 * An unknown slug exits 2 and lists the 5 closest slugs (Levenshtein).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { ClassifierResult, ReversibilityClass } from "./classification.js";
import { loadSnapshotTools, resolveSnapshotDir } from "./classifyCommand.js";
import { isGap, isSingleGapRules } from "./compare.js";
import { classifierModel } from "./env.js";
import {
  deriveHints,
  deriveTier,
  KNOWN_HINT_TAGS,
  type DerivedTier,
  type ToolHints,
} from "./hints.js";
import {
  cacheKey,
  DEFAULT_CLASSIFIER_MODEL,
  llmCacheRoot,
  PROMPT_VERSION,
  readCache,
} from "./llm.js";
import type { SnapshotTool } from "./normalize.js";
import { findRepoRoot } from "./paths.js";
import type { CommandResult, ParsedArgs } from "./program.js";
import { classifyTool } from "./rules.js";
import { loadLabels, spotcheckFile, type SpotLabel } from "./spotcheck.js";

export interface ExplainCommandDeps {
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  /** Overrides fixtures/llm-cache (tests use a temp dir). */
  cacheRoot?: string;
  /** Overrides fixtures/labels/spotcheck.json. */
  labelsFile?: string;
}

// ---------------------------------------------------------------- similarity

/** Classic edit-distance DP, O(len(a) * len(b)); deterministic, no deps. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) dp[j] = j;
  for (let i = 1; i <= m; i += 1) {
    let prevDiag = dp[0] ?? 0;
    dp[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const tmp = dp[j] ?? 0;
      dp[j] = a[i - 1] === b[j - 1] ? prevDiag : 1 + Math.min(prevDiag, tmp, dp[j - 1] ?? 0);
      prevDiag = tmp;
    }
  }
  return dp[n] ?? Math.max(m, n);
}

/** `limit` slugs closest to `target` by edit distance; ties broken alphabetically (deterministic). */
export function closestSlugs(target: string, candidates: readonly string[], limit = 5): string[] {
  const upper = target.toUpperCase();
  return [...candidates]
    .map((slug) => ({ slug, dist: levenshtein(upper, slug) }))
    .sort((a, b) => a.dist - b.dist || a.slug.localeCompare(b.slug))
    .slice(0, limit)
    .map((c) => c.slug);
}

// ---------------------------------------------------------------- data shape

export type LlmCacheState = "live" | "recorded" | "miss";

export interface ExplainLlm {
  model: string;
  promptVersion: string;
  state: LlmCacheState;
  /** Set for `live` and `recorded` (recorded is a synthetic fixture, NOT a model verdict, D31). */
  class: ReversibilityClass | null;
  rationale: string | null;
}

export interface ExplainSpotcheck {
  label: ReversibilityClass;
  rationale: string;
}

export interface ExplainResult {
  slug: string;
  name: string;
  toolkit: string;
  deprecated: boolean;
  tags: string[];
  hints: ToolHints;
  tier: DerivedTier;
  rule: ClassifierResult;
  llm: ExplainLlm;
  /** D2: rules + LIVE LLM both irreversible, no destructiveHint. Recorded cache never counts. */
  gap: boolean;
  /** rules irreversible, no destructiveHint (no LLM needed). */
  singleGap: boolean;
  spotcheck: ExplainSpotcheck | null;
}

export function buildExplainResult(
  tool: SnapshotTool,
  opts: { model: string; cacheRoot: string; label?: SpotLabel },
): ExplainResult {
  const rule = classifyTool(tool);
  const hints = deriveHints(tool.tags);
  const tier = deriveTier(hints).tier;

  const entry = readCache(opts.cacheRoot, opts.model, cacheKey(tool));
  const state: LlmCacheState = entry ? entry.provenance : "miss";
  const liveResult: ClassifierResult | null = entry?.provenance === "live" ? entry.result : null;

  const gap = isGap({ rule, llm: liveResult, hints });
  const singleGap = isSingleGapRules({ rule, hints });

  return {
    slug: tool.slug,
    name: tool.name,
    toolkit: tool.toolkit.slug,
    deprecated: tool.isDeprecated,
    tags: tool.tags,
    hints,
    tier,
    rule,
    llm: {
      model: opts.model,
      promptVersion: PROMPT_VERSION,
      state,
      class: entry ? entry.result.class : null,
      rationale: entry ? entry.output.rationale : null,
    },
    gap,
    singleGap,
    spotcheck: opts.label ? { label: opts.label.label, rationale: opts.label.rationale } : null,
  };
}

// ---------------------------------------------------------------- rendering

function yesNo(b: boolean): string {
  return b ? "yes" : "no";
}

const HINT_LABEL_WIDTH = Math.max(...KNOWN_HINT_TAGS.map((t) => t.length), "otherTags".length) + 1;

function pad(label: string): string {
  return `  ${label.padEnd(HINT_LABEL_WIDTH)}`;
}

function provenanceForHumans(state: LlmCacheState): string {
  switch (state) {
    case "live":
      return "live";
    case "recorded":
      return "recorded-synthetic — NOT a model verdict (D31)";
    case "miss":
      return "miss (not cached for this model + prompt version)";
  }
}

export function renderPlain(r: ExplainResult): string {
  const lines: string[] = [];
  lines.push(`explain ${r.slug}${r.deprecated ? " (deprecated)" : ""}`);
  lines.push(`  name:  ${r.name}`);
  lines.push("");
  lines.push(`Toolkit:      ${r.toolkit}`);
  lines.push(`Raw tags:     ${r.tags.length ? r.tags.join(", ") : "(none)"}`);
  lines.push("Hints (deriveHints, 7 known tags):");
  for (const tag of KNOWN_HINT_TAGS) {
    lines.push(`${pad(tag)}${yesNo(r.hints[tag])}`);
  }
  lines.push(
    `${pad("otherTags")}${r.hints.otherTags.length ? r.hints.otherTags.join(", ") : "(none)"}`,
  );
  lines.push(
    `Derived tier: ${r.tier}  (deriveTier; always "derived" -- the SDK exposes no Enhanced` +
      " Controls tier, D20/D22)",
  );
  lines.push("");
  lines.push("Rule classifier (classifyTool):");
  lines.push(`  class:      ${r.rule.class}`);
  lines.push(`  confidence: ${r.rule.confidence}`);
  lines.push(`  reasons:    ${r.rule.reasons.join("; ")}`);
  lines.push("");
  lines.push(`LLM cache (model ${r.llm.model}, prompt ${r.llm.promptVersion}):`);
  lines.push(`  state:      ${provenanceForHumans(r.llm.state)}`);
  if (r.llm.state === "live") {
    lines.push(`  class:      ${r.llm.class}`);
    lines.push(`  rationale:  ${r.llm.rationale ?? ""}`);
  } else if (r.llm.state === "recorded") {
    lines.push(`  recorded class (synthetic, not the LLM's verdict): ${r.llm.class}`);
    lines.push(`  recorded rationale:                                ${r.llm.rationale ?? ""}`);
  }
  lines.push("");
  lines.push("Gap flags (D2):");
  lines.push(
    `  GAP (rules + live LLM both irreversible, no destructiveHint): ${yesNo(r.gap)}` +
      (r.llm.state !== "live" ? " (LLM not live for this model)" : ""),
  );
  lines.push(
    `  single-gap (rules irreversible, no destructiveHint):           ${yesNo(r.singleGap)}`,
  );
  if (r.spotcheck) {
    lines.push("");
    lines.push(`Spot-check label: ${r.spotcheck.label}`);
    lines.push(`  rationale: ${r.spotcheck.rationale}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- command

function relSnapshot(repoRoot: string, dir: string): string {
  const rel = (path.relative(repoRoot, dir) || ".").split(path.sep).join("/");
  return rel.startsWith("..") ? dir : rel;
}

/** `audit explain <slug>`: see module doc. */
export async function explainCommand(
  args: ParsedArgs,
  deps: ExplainCommandDeps = {},
): Promise<CommandResult> {
  const repoRoot = deps.repoRoot ?? findRepoRoot();
  const env = deps.env ?? process.env;
  const slugArg = args.slug?.trim();
  if (!slugArg) {
    return {
      output:
        "explain: missing <slug>. Usage: audit explain <SLUG> [--snapshot <dir>] [--model <id>] [--json]",
      exitCode: 2,
    };
  }

  const dir = resolveSnapshotDir(repoRoot, args.snapshot);
  if (!existsSync(dir)) {
    return { output: `explain: snapshot dir not found: ${dir}`, exitCode: 2 };
  }
  const tools = loadSnapshotTools(dir, null);
  const rel = relSnapshot(repoRoot, dir);
  const tool = tools.find((t) => t.slug === slugArg);
  if (!tool) {
    const suggestions = closestSlugs(
      slugArg,
      tools.map((t) => t.slug),
    );
    return {
      output: [
        `explain: unknown slug "${slugArg}" in ${rel} (${tools.length} tools)`,
        `  closest slugs: ${suggestions.join(", ")}`,
      ].join("\n"),
      exitCode: 2,
    };
  }

  const model = args.model ?? classifierModel(env) ?? DEFAULT_CLASSIFIER_MODEL;
  const cacheRoot = deps.cacheRoot ?? llmCacheRoot(repoRoot);
  const labels = loadLabels(deps.labelsFile ?? spotcheckFile(repoRoot));
  const label = labels.find((l) => l.slug === tool.slug);

  const result = buildExplainResult(tool, { model, cacheRoot, label });
  const output = args.json ? JSON.stringify(result, null, 2) : renderPlain(result);
  return { output, exitCode: 0 };
}
