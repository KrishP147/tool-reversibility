import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { findRepoRoot } from "./repoRoot";

/**
 * Read-only slices of `reports/report.json` for the `/gaps` pages (issue
 * #35). Deliberately independent of `lib/report.ts`: that module's
 * `Report`/`ToolReport` types cover only the per-action lookup the inbox
 * list/detail views need, and don't carry the report's `stamp`, `totals`,
 * `perToolkit` or `topGaps` blocks (plan.md §3b, §15 D36/D37). Rather than
 * widen that contract, this file reads the same file itself and returns
 * only bounded slices a server component needs -- never the full parsed
 * report or the 1600+-entry `tools` array -- so nothing here ships the full
 * JSON to the client.
 *
 * Stub-safe (issue #35 acceptance): a missing `reports/report.json`, or one
 * with `stub: true`, resolves to `{ available: false }` everywhere below.
 * This never falls back to the bundled `lib/stub/report.stub.json` the way
 * `lib/report.ts` does for the inbox list -- that stub has no `stamp`,
 * `totals`, `perToolkit` or `topGaps`, so there is nothing gap-shaped to
 * show, and "no report yet" is the honest state (plan.md D31/D36: no
 * invented Composio numbers).
 */

export type GapsLlmStatus = "live" | "recorded" | "pending" | string;

export interface GapsStamp {
  date: string;
  commit: string;
  llmStatus: GapsLlmStatus;
  model: string;
  generatedAt?: string;
}

export interface GapsTotals {
  tools: number;
  toolkits: number;
  deprecatedExcluded: number;
}

/** One row of the top-50 single-classifier gaps table, enriched from the
 * matching `tools[]` entry (topGaps rows carry confidence/tags but not
 * tier/hints/reasons, which live only on the full per-tool entry).
 *
 * `tools[]` only holds the Enhanced Controls apps plus pending slugs -- not
 * every slug that can appear in `topGaps.rows`. When a row's slug isn't in
 * `tools[]`, `tier`/`tierSource` are `null` (never invented) and `hints` is
 * derived from the row's own `tags` instead. */
export interface GapsTableRow {
  slug: string;
  toolkit: string;
  ruleClass: string;
  confidence: number;
  /** Hint tags that are `true` for this tool (e.g. "openWorldHint"). */
  hints: string[];
  tier: string | null;
  tierSource: string | null;
  reasons: string[];
}

export interface ToolkitSummaryRow {
  toolkit: string;
  tools: number;
  irreversible: number;
  gap: number;
}

export type GapsSummary =
  | { available: false; note: string }
  | {
      available: true;
      stamp: GapsStamp;
      llmStatusLabel: string;
      totals: GapsTotals;
      topGaps: GapsTableRow[];
      perToolkit: ToolkitSummaryRow[];
    };

export interface GapSpotcheck {
  label: string;
  rationale: string;
}

export interface GapDetail {
  slug: string;
  toolkit: string;
  ruleClass: string;
  ruleConfidence: number | null;
  reasons: string[];
  hints: Record<string, boolean>;
  /** `null` when this slug isn't in the report's `tools[]` slice (see
   * `partial`) -- never invented from the topGaps row alone. */
  tier: string | null;
  tierSource: string | null;
  llmClass: string | null;
  llmStatus: GapsLlmStatus;
  llmStatusLabel: string;
  agree: boolean;
  compensatingTool?: string;
  /** rules irreversible, no destructiveHint (mirrors `audit:cli explain`'s
   * single-gap flag, plan.md D2/D46). */
  singleGap: boolean;
  /** rules + live LLM both irreversible, no destructiveHint. A "recorded"
   * (synthetic) llmClass never counts, per D31/D46. */
  gap: boolean;
  spotcheck: GapSpotcheck | null;
  /** true when this detail was built from a `topGaps.rows` entry that has
   * no matching `tools[]` entry -- only the row's own fields are real,
   * `tier`/`tierSource` are unknown and `agree`/`compensatingTool` are
   * derived, not sourced from a full per-tool record. */
  partial?: boolean;
}

export type GapDetailResult =
  { status: "no-report" } | { status: "not-found" } | { status: "ok"; detail: GapDetail };

/** The 8 Enhanced Controls apps this page reports per-toolkit (plan.md §3b),
 * in the order they should be displayed. */
export const GAPS_TOOLKITS = [
  "gmail",
  "outlook",
  "slack",
  "googlesheets",
  "googlecalendar",
  "googledrive",
  "github",
  "notion",
] as const;

const NO_REPORT_NOTE = "No report yet — run the audit pipeline (issue #5) to produce one.";

interface RawTool {
  slug: string;
  toolkit: string;
  ruleClass: string;
  llmClass: string;
  agree: boolean;
  hints?: Record<string, boolean>;
  tier: string;
  tierSource: string;
  reasons: string[];
  ruleConfidence?: number;
  compensatingTool?: string;
}

interface RawTopGapRow {
  slug: string;
  toolkit: string;
  ruleClass: string;
  llmClass: string | null;
  confidence: number;
  important: boolean;
  tags: string[];
  reason: string;
}

interface RawReport {
  stub?: boolean;
  stamp?: GapsStamp;
  totals?: GapsTotals;
  perToolkit?: Record<string, { tools: number; rulesIrreversible: number; singleGap: number }>;
  topGaps?: { kind: string; rows: RawTopGapRow[] };
  tools?: RawTool[];
}

interface RawLabel {
  slug: string;
  label: string;
  rationale: string;
}

interface RawLabelsFile {
  labels?: RawLabel[];
}

// Module-level cache (per resolved file path): the report and label files
// are read from disk once per process, not once per request/render.
const reportCache = new Map<string, RawReport | null>();
const labelsCache = new Map<string, RawLabel[]>();

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function readRawReport(repoRoot: string): RawReport | null {
  const reportPath = path.join(repoRoot, "reports", "report.json");
  if (reportCache.has(reportPath)) return reportCache.get(reportPath) ?? null;

  const parsed = readJson<RawReport>(reportPath);
  reportCache.set(reportPath, parsed);
  return parsed;
}

function readLabels(repoRoot: string): RawLabel[] {
  const labelsPath = path.join(repoRoot, "fixtures", "labels", "spotcheck.json");
  if (labelsCache.has(labelsPath)) return labelsCache.get(labelsPath) ?? [];

  const parsed = readJson<RawLabelsFile>(labelsPath);
  const labels = parsed?.labels ?? [];
  labelsCache.set(labelsPath, labels);
  return labels;
}

/** "live" is the only state that means llmClass/gap are real model output
 * (plan.md D31); everything else (including a missing status) is rules-only. */
export function llmStatusLabel(llmStatus: string | undefined): string {
  return llmStatus === "live" ? "live" : "rules-only — LLM pending";
}

function isUsableReport(raw: RawReport | null): raw is RawReport & {
  stamp: GapsStamp;
  totals: GapsTotals;
  perToolkit: NonNullable<RawReport["perToolkit"]>;
  topGaps: NonNullable<RawReport["topGaps"]>;
  tools: RawTool[];
} {
  return (
    raw !== null &&
    raw.stub !== true &&
    raw.stamp !== undefined &&
    raw.totals !== undefined &&
    raw.perToolkit !== undefined &&
    raw.topGaps !== undefined &&
    Array.isArray(raw.tools)
  );
}

function trueHintKeys(hints: Record<string, boolean> | undefined): string[] {
  if (!hints) return [];
  return Object.keys(hints).filter((key) => hints[key] === true);
}

/** The hint-tag names that also appear as `tools[].hints` keys (plan.md
 * §3b). `topGaps.rows[].tags` mixes these in with unrelated category tags
 * (toolkit-specific scope names like "email"/"repos"/"admin.users"); this is
 * how a fallback row (slug not in `tools[]`) tells hints from noise. */
const HINT_TAG_NAMES = new Set([
  "readOnlyHint",
  "destructiveHint",
  "idempotentHint",
  "openWorldHint",
  "createHint",
  "updateHint",
  "important",
]);

/** Builds a `tag -> true` hints record from a topGaps row's `tags`,
 * keeping only the tags that are actually hint names. */
function hintsFromTags(tags: string[]): Record<string, boolean> {
  const hints: Record<string, boolean> = {};
  for (const tag of tags) {
    if (HINT_TAG_NAMES.has(tag)) hints[tag] = true;
  }
  return hints;
}

/** Server-side summary for the `/gaps` list page: stamp, totals, the
 * top-50 single-classifier gaps table and the per-toolkit breakdown for the
 * 8 Enhanced Controls apps. Never throws; `available: false` when there is
 * no real report yet. */
export function getGapsSummary(repoRoot: string = findRepoRoot()): GapsSummary {
  const raw = readRawReport(repoRoot);
  if (!isUsableReport(raw)) {
    return { available: false, note: NO_REPORT_NOTE };
  }

  const toolsBySlug = new Map(raw.tools.map((tool) => [tool.slug, tool]));

  const topGaps: GapsTableRow[] = raw.topGaps.rows.slice(0, 50).map((row) => {
    const tool = toolsBySlug.get(row.slug);
    if (tool) {
      return {
        slug: row.slug,
        toolkit: row.toolkit,
        ruleClass: row.ruleClass,
        confidence: row.confidence,
        hints: trueHintKeys(tool.hints),
        tier: tool.tier,
        tierSource: tool.tierSource,
        reasons: tool.reasons,
      };
    }
    // Fallback: this slug isn't in the report's `tools[]` slice (it only
    // holds Enhanced Controls apps + pending slugs, not every topGaps
    // slug). Don't invent a tier -- null renders as "--" (see GapsTable).
    return {
      slug: row.slug,
      toolkit: row.toolkit,
      ruleClass: row.ruleClass,
      confidence: row.confidence,
      hints: Object.keys(hintsFromTags(row.tags)),
      tier: null,
      tierSource: null,
      reasons: [row.reason],
    };
  });

  const perToolkit: ToolkitSummaryRow[] = GAPS_TOOLKITS.map((toolkit) => {
    const entry = raw.perToolkit[toolkit];
    return {
      toolkit,
      tools: entry?.tools ?? 0,
      irreversible: entry?.rulesIrreversible ?? 0,
      gap: entry?.singleGap ?? 0,
    };
  });

  return {
    available: true,
    stamp: raw.stamp,
    llmStatusLabel: llmStatusLabel(raw.stamp.llmStatus),
    totals: raw.totals,
    topGaps,
    perToolkit,
  };
}

/** Server-side detail for `/gaps/[slug]`: the fields `audit:cli explain`
 * prints (plan.md D46), read from report.json + the spot-check labels only
 * -- no CLI call. Never throws: `no-report` when there's no real report,
 * `not-found` when the slug isn't in it. */
export function getGapDetail(slug: string, repoRoot: string = findRepoRoot()): GapDetailResult {
  const raw = readRawReport(repoRoot);
  if (!isUsableReport(raw)) {
    return { status: "no-report" };
  }

  const tool = raw.tools.find((t) => t.slug === slug);
  const llmStatus = raw.stamp.llmStatus;
  const label = readLabels(repoRoot).find((l) => l.slug === slug);

  if (tool) {
    const hints = tool.hints ?? {};
    const singleGap = tool.ruleClass === "irreversible" && hints.destructiveHint !== true;
    const gap = singleGap && llmStatus === "live" && tool.llmClass === "irreversible";

    return {
      status: "ok",
      detail: {
        slug: tool.slug,
        toolkit: tool.toolkit,
        ruleClass: tool.ruleClass,
        ruleConfidence: tool.ruleConfidence ?? null,
        reasons: tool.reasons,
        hints,
        tier: tool.tier,
        tierSource: tool.tierSource,
        llmClass: tool.llmClass ?? null,
        llmStatus,
        llmStatusLabel: llmStatusLabel(llmStatus),
        agree: tool.agree,
        compensatingTool: tool.compensatingTool,
        singleGap,
        gap,
        spotcheck: label ? { label: label.label, rationale: label.rationale } : null,
      },
    };
  }

  // Fallback: slug is in `topGaps.rows` but not in the report's `tools[]`
  // slice. Build an "ok" detail from the row alone rather than 404 --
  // `tools[]` only covers Enhanced Controls apps + pending slugs, so most of
  // the top-50 gaps table's own slugs land here. `tier` is never invented;
  // `agree` mirrors packages/audit/src/report.ts's own definition
  // (llmClass !== null && llmClass === ruleClass), same as a full row.
  const row = raw.topGaps.rows.find((r) => r.slug === slug);
  if (!row) {
    return { status: "not-found" };
  }

  const hints = hintsFromTags(row.tags);
  const singleGap = row.ruleClass === "irreversible" && hints.destructiveHint !== true;
  const gap = singleGap && llmStatus === "live" && row.llmClass === "irreversible";

  return {
    status: "ok",
    detail: {
      slug: row.slug,
      toolkit: row.toolkit,
      ruleClass: row.ruleClass,
      ruleConfidence: row.confidence ?? null,
      reasons: [row.reason],
      hints,
      tier: null,
      tierSource: null,
      llmClass: row.llmClass,
      llmStatus,
      llmStatusLabel: llmStatusLabel(llmStatus),
      agree: row.llmClass !== null && row.llmClass === row.ruleClass,
      compensatingTool: undefined,
      singleGap,
      gap,
      spotcheck: label ? { label: label.label, rationale: label.rationale } : null,
      partial: true,
    },
  };
}
