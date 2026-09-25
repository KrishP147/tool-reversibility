/**
 * Compare step (plan §3a, D2): per-tool rows from the rule and LLM
 * classifiers plus the Composio hints, aggregated into totals, a 4x4
 * rules-vs-LLM confusion matrix, the GAP counts and per-toolkit stats.
 * Pure: no I/O. Rows are fed one at a time so a caller can stream toolkit
 * files instead of loading the whole catalog.
 */
import type { ClassifierResult, ReversibilityClass } from "./classification.js";
import { deriveHints, deriveTier, type DerivedTier, type ToolHints } from "./hints.js";
import type { SnapshotTool } from "./normalize.js";

export const CLASS_ORDER: readonly ReversibilityClass[] = [
  "reversible",
  "compensable",
  "irreversible",
  "unknown",
];

/** The 8 Enhanced Controls apps (plan §1). */
export const EC_TOOLKITS = [
  "gmail",
  "outlook",
  "slack",
  "googlesheets",
  "googlecalendar",
  "googledrive",
  "github",
  "notion",
] as const;

export interface ToolRow {
  slug: string;
  toolkit: string;
  deprecated: boolean;
  hints: ToolHints;
  tier: DerivedTier;
  rule: ClassifierResult;
  /** LLM result, or null when no usable (live) result exists for this tool. */
  llm: ClassifierResult | null;
}

export function buildRow(
  tool: SnapshotTool,
  rule: ClassifierResult,
  llm: ClassifierResult | null,
): ToolRow {
  const hints = deriveHints(tool.tags);
  return {
    slug: tool.slug,
    toolkit: tool.toolkit.slug,
    deprecated: tool.isDeprecated,
    hints,
    tier: deriveTier(hints).tier,
    rule,
    llm,
  };
}

/** D2 GAP: both classifiers say irreversible and there is no destructiveHint. */
export function isGap(row: Pick<ToolRow, "rule" | "llm" | "hints">): boolean {
  return (
    row.llm !== null &&
    row.rule.class === "irreversible" &&
    row.llm.class === "irreversible" &&
    !row.hints.destructiveHint
  );
}

/** Single-classifier gap (rules only): irreversible by rules, no destructiveHint. */
export function isSingleGapRules(row: Pick<ToolRow, "rule" | "hints">): boolean {
  return row.rule.class === "irreversible" && !row.hints.destructiveHint;
}

export type ClassCounts = Record<ReversibilityClass, number>;
export type Confusion = Record<ReversibilityClass, ClassCounts>;

export function emptyCounts(): ClassCounts {
  return { reversible: 0, compensable: 0, irreversible: 0, unknown: 0 };
}

/** rows = first classifier (rules / label), columns = second (LLM / prediction). */
export function emptyConfusion(): Confusion {
  return {
    reversible: emptyCounts(),
    compensable: emptyCounts(),
    irreversible: emptyCounts(),
    unknown: emptyCounts(),
  };
}

/** Percentage with one decimal, or null when the denominator is 0. */
export function pct(n: number, d: number): number | null {
  return d === 0 ? null : Math.round((n / d) * 1000) / 10;
}

export interface MNP {
  M: number;
  N: number;
  P: number | null;
}

export interface ToolkitStats {
  tools: number;
  rulesIrreversible: number;
  singleGap: number;
  /** Both classifiers irreversible (only meaningful when the LLM is live). */
  bothIrreversible: number;
  gap: number;
}

/** Compact row kept for the top-gaps table and the disagreement sample. */
export interface GapRow {
  slug: string;
  toolkit: string;
  ruleClass: ReversibilityClass;
  llmClass: ReversibilityClass | null;
  confidence: number;
  important: boolean;
  tags: string[];
  reason: string;
}

function gapRow(row: ToolRow): GapRow {
  const h = row.hints;
  const tags = (
    [
      "readOnlyHint",
      "destructiveHint",
      "idempotentHint",
      "openWorldHint",
      "createHint",
      "updateHint",
      "important",
    ] as const
  ).filter((k) => h[k]);
  return {
    slug: row.slug,
    toolkit: row.toolkit,
    ruleClass: row.rule.class,
    llmClass: row.llm?.class ?? null,
    confidence: row.rule.confidence,
    important: h.important,
    tags: [...tags, ...h.otherTags],
    reason: row.rule.reasons[0] ?? "",
  };
}

/**
 * Streaming accumulator. Deprecated tools are counted in
 * `deprecatedExcluded` and left out of every other statistic (D28: the LLM
 * pass excludes them, so both classifiers cover the same population).
 */
export class Comparison {
  readonly toolkits = new Set<string>();
  tools = 0;
  deprecatedExcluded = 0;
  readonly rulesByClass = emptyCounts();
  readonly llmByClass = emptyCounts();
  readonly confusion = emptyConfusion();
  llmCompared = 0;
  agree = 0;
  gapM = 0;
  gapN = 0;
  singleM = 0;
  singleN = 0;
  readonly perToolkit = new Map<string, ToolkitStats>();
  readonly gaps: GapRow[] = [];
  readonly singleGaps: GapRow[] = [];
  readonly disagreements: GapRow[] = [];

  add(row: ToolRow): void {
    this.toolkits.add(row.toolkit);
    if (row.deprecated) {
      this.deprecatedExcluded += 1;
      return;
    }
    this.tools += 1;
    this.rulesByClass[row.rule.class] += 1;
    const tk = this.toolkit(row.toolkit);
    tk.tools += 1;

    if (row.rule.class === "irreversible") {
      this.singleM += 1;
      tk.rulesIrreversible += 1;
      if (isSingleGapRules(row)) {
        this.singleN += 1;
        tk.singleGap += 1;
        this.singleGaps.push(gapRow(row));
      }
    }

    if (row.llm) {
      this.llmCompared += 1;
      this.llmByClass[row.llm.class] += 1;
      this.confusion[row.rule.class][row.llm.class] += 1;
      if (row.rule.class === row.llm.class) this.agree += 1;
      else this.disagreements.push(gapRow(row));
      if (row.rule.class === "irreversible" && row.llm.class === "irreversible") {
        this.gapM += 1;
        tk.bothIrreversible += 1;
        if (isGap(row)) {
          this.gapN += 1;
          tk.gap += 1;
          this.gaps.push(gapRow(row));
        }
      }
    }
  }

  private toolkit(slug: string): ToolkitStats {
    let s = this.perToolkit.get(slug);
    if (!s) {
      s = { tools: 0, rulesIrreversible: 0, singleGap: 0, bothIrreversible: 0, gap: 0 };
      this.perToolkit.set(slug, s);
    }
    return s;
  }

  gap(): MNP {
    return { M: this.gapM, N: this.gapN, P: pct(this.gapN, this.gapM) };
  }

  singleGap(): MNP {
    return { M: this.singleM, N: this.singleN, P: pct(this.singleN, this.singleM) };
  }

  agreementRate(): number | null {
    return pct(this.agree, this.llmCompared);
  }
}

/**
 * Rank gap rows for the "top gaps" table: EC apps first, then tools Composio
 * tags `important`, then rule confidence, then slug (deterministic).
 */
export function rankGaps(rows: readonly GapRow[], limit = 50): GapRow[] {
  const ec = new Set<string>(EC_TOOLKITS);
  return [...rows]
    .sort(
      (a, b) =>
        Number(ec.has(b.toolkit)) - Number(ec.has(a.toolkit)) ||
        Number(b.important) - Number(a.important) ||
        b.confidence - a.confidence ||
        a.slug.localeCompare(b.slug),
    )
    .slice(0, limit);
}

/** mulberry32: small seeded PRNG so the disagreement sample is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded sample of `n` rows, independent of input order (sorted by slug first). */
export function seededSample<T extends { slug: string }>(
  rows: readonly T[],
  n: number,
  seed: number,
): T[] {
  const arr = [...rows].sort((a, b) => a.slug.localeCompare(b.slug));
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
  }
  return arr.slice(0, n).sort((a, b) => a.slug.localeCompare(b.slug));
}
