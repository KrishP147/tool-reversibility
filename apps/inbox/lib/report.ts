import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { findRepoRoot } from "./repoRoot";
import stubReport from "./stub/report.stub.json";

/**
 * Reversibility taxonomy (plan.md §1 / §7 D1):
 * - reversible: no external effect
 * - compensable: an inverse API exists
 * - irreversible: the effect escapes the system (message sent, money moved,
 *   hard delete)
 * - unknown: neither classifier could decide, or the tool has no report entry
 */
export type ToolClass = "reversible" | "compensable" | "irreversible" | "unknown";

/** "real" if the Enhanced Controls tier came straight from the SDK, "derived"
 * if it was inferred from hints (plan.md §3a "Hints", §7 D6). */
export type TierSource = "real" | "derived";

export interface ToolReport {
  slug: string;
  toolkit: string;
  ruleClass: ToolClass;
  llmClass: ToolClass;
  agree: boolean;
  hints: Record<string, boolean>;
  tier: string;
  tierSource: TierSource;
  reasons: string[];
  compensatingTool?: string;
}

export type LlmStatus = "live" | "recorded" | "pending";

export interface ReportStamp {
  date: string;
  generatedAt: string;
  commit: string;
  dirty: boolean;
  sdkVersion: string;
  model: string;
  llmStatus: LlmStatus;
  promptVersion: string;
  manifestSha256: string;
  regenerate: string;
}

export interface Report {
  /** True when this report is the bundled placeholder, not a real audit run. */
  stub: boolean;
  /** Human-readable explanation shown in the UI when stub === true. */
  note?: string;
  generatedAt?: string;
  /**
   * LLM status of a real report (packages/audit, issue #5). Only "live" means
   * llmClass is real model output; otherwise llmClass is "unknown" and agree
   * is false.
   */
  llmStatus?: LlmStatus;
  /** Stamp block of a real report (docs/stamping.md). */
  stamp?: ReportStamp;
  tools: ToolReport[];
}

/**
 * Loads `<repoRoot>/reports/report.json` (produced by issue #5's
 * packages/audit pipeline) when it exists. Until then this falls back to the
 * bundled stub, which is clearly flagged (`stub: true`) and carries no
 * invented Composio numbers/counts/percentages (acceptance item 1).
 */
export function loadReport(repoRoot: string = findRepoRoot()): Report {
  const realReportPath = path.join(repoRoot, "reports", "report.json");

  if (existsSync(realReportPath)) {
    const raw = readFileSync(realReportPath, "utf-8");
    const parsed = JSON.parse(raw) as Report;
    // A real report on disk is never the stub, regardless of what it says.
    return { ...parsed, stub: false };
  }

  return stubReport as Report;
}

export function findToolReport(report: Report, slug: string): ToolReport | undefined {
  return report.tools.find((tool) => tool.slug === slug);
}
