/**
 * `audit report`: stream a catalog snapshot one toolkit file at a time, run
 * the rule classifier, look up LLM results in the cache (never the API),
 * compare, score the spot-check set, and write the stamped
 * reports/REPORT.md + reports/report.json plus a full per-tool CSV
 * (gitignored, reports/full/tools.csv).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ClassifierResult, ReversibilityClass } from "./classification.js";
import { resolveSnapshotDir } from "./classifyCommand.js";
import {
  buildRow,
  Comparison,
  EC_TOOLKITS,
  isGap,
  isSingleGapRules,
  type ToolRow,
} from "./compare.js";
import { classifierModel } from "./env.js";
import {
  cacheKey,
  DEFAULT_CLASSIFIER_MODEL,
  llmCacheRoot,
  PROMPT_VERSION,
  readCache,
} from "./llm.js";
import { findRepoRoot } from "./paths.js";
import type { CommandResult, ParsedArgs } from "./program.js";
import {
  buildReport,
  renderMarkdown,
  toReportTool,
  type LlmStatus,
  type ReportTool,
  type Stamp,
} from "./report.js";
import { classifyTool } from "./rules.js";
import { listSnapshotSlugs, MANIFEST_FILE, readToolkitFile, type Manifest } from "./snapshot.js";
import { loadLabels, score, spotcheckFile } from "./spotcheck.js";

export interface GitState {
  commit: string;
  dirty: boolean;
}

export interface ReportCommandDeps {
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  cacheRoot?: string;
  labelsFile?: string;
  /** Where REPORT.md / report.json go (default <root>/reports). */
  outDir?: string;
  /** Full per-tool CSV (default <root>/reports/full/tools.csv, gitignored). */
  csvFile?: string;
  git?: (repoRoot: string) => GitState;
  now?: () => Date;
}

export function gitState(repoRoot: string): GitState {
  const run = (args: string[]) =>
    execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  try {
    return { commit: run(["rev-parse", "HEAD"]), dirty: run(["status", "--porcelain"]).length > 0 };
  } catch {
    return { commit: "unknown", dirty: true };
  }
}

/** `--snapshot` value to print in `regenerate`: repo-style path when it looks like fixtures/catalog/<name>. */
export function regenerateCommand(snapshotDir: string, toolkits: string[] | null): string {
  const m = /[\\/]fixtures[\\/]catalog[\\/]([^\\/]+)[\\/]?$/.exec(snapshotDir);
  const snap = m ? `fixtures/catalog/${m[1]}` : snapshotDir.split(path.sep).join("/");
  return (
    `pnpm audit:cli report --snapshot ${snap}` +
    (toolkits ? ` --toolkits ${toolkits.join(",")}` : "")
  );
}

function pendingSlugs(repoRoot: string): Set<string> {
  const dir = path.join(repoRoot, "fixtures", "pending");
  const out = new Set<string>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const slug = (JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { slug?: unknown }).slug;
      if (typeof slug === "string") out.add(slug);
    } catch {
      // not a pending action
    }
  }
  return out;
}

function csvCell(v: string | number | boolean | null): string {
  const s = v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEAD = [
  "slug",
  "toolkit",
  "deprecated",
  "tier_derived",
  "tags",
  "rule_class",
  "rule_confidence",
  "llm_class",
  "llm_provenance",
  "agree",
  "gap",
  "single_gap_rules",
  "rule_reasons",
];

interface CsvRow {
  row: ToolRow;
  tags: string;
  provenance: "live" | "recorded" | null;
}

export async function reportCommand(
  args: ParsedArgs,
  deps: ReportCommandDeps = {},
): Promise<CommandResult> {
  const repoRoot = deps.repoRoot ?? findRepoRoot();
  const env = deps.env ?? process.env;
  const dir = resolveSnapshotDir(repoRoot, args.snapshot);
  const manifestPath = path.join(dir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    return { output: `report: no ${MANIFEST_FILE} in ${dir}`, exitCode: 2 };
  }
  const manifestBytes = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as Manifest;
  const model = args.model ?? classifierModel(env) ?? DEFAULT_CLASSIFIER_MODEL;
  const cacheRoot = deps.cacheRoot ?? llmCacheRoot(repoRoot);
  const labels = loadLabels(deps.labelsFile ?? spotcheckFile(repoRoot));
  const labelBySlug = new Map(labels.map((l) => [l.slug, l.label]));
  const pending = pendingSlugs(repoRoot);
  const ec = new Set<string>(EC_TOOLKITS);

  const want = args.toolkits ? new Set(args.toolkits) : null;
  const cmp = new Comparison();
  const csv: CsvRow[] = [];
  const subset: ToolRow[] = [];
  const spotRows = new Map<string, ToolRow>();
  let liveHits = 0;
  let recordedHits = 0;
  let population = 0;

  // Stream: one toolkit file in memory at a time.
  for (const slug of listSnapshotSlugs(dir)) {
    if (want && !want.has(slug)) continue;
    const file = readToolkitFile(dir, slug);
    if (!file) continue;
    for (const tool of file.tools) {
      const rule = classifyTool(tool);
      let llm: ClassifierResult | null = null;
      let provenance: CsvRow["provenance"] = null;
      if (!tool.isDeprecated) {
        population += 1;
        const entry = readCache(cacheRoot, model, cacheKey(tool));
        if (entry?.provenance === "live") {
          llm = entry.result;
          provenance = "live";
          liveHits += 1;
        } else if (entry?.provenance === "recorded") {
          provenance = "recorded";
          recordedHits += 1;
        }
      }
      const row = buildRow(tool, rule, llm);
      cmp.add(row);
      csv.push({ row, tags: tool.tags.join(" "), provenance });
      if ((ec.has(row.toolkit) && !row.deprecated) || pending.has(row.slug)) subset.push(row);
      if (labelBySlug.has(row.slug) && !row.deprecated) spotRows.set(row.slug, row);
    }
  }

  if (population === 0) {
    return { output: `report: no tools found in ${dir}`, exitCode: 2 };
  }

  const llmStatus: LlmStatus =
    liveHits === population ? "live" : recordedHits > 0 ? "recorded" : "pending";
  const live = llmStatus === "live";
  const git = (deps.git ?? gitState)(repoRoot);
  const now = (deps.now ?? (() => new Date()))();

  const stamp: Stamp = {
    date: manifest.date,
    generatedAt: now.toISOString(),
    commit: git.commit,
    dirty: git.dirty,
    sdkVersion: manifest.sdk?.version ?? "unknown",
    model: live ? model : "pending",
    llmStatus,
    promptVersion: PROMPT_VERSION,
    manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    regenerate: regenerateCommand(dir, args.toolkits),
  };

  const found = labels.filter((l) => spotRows.has(l.slug));
  const rulesScore = score(
    found.map((l) => ({ label: l.label, predicted: (spotRows.get(l.slug) as ToolRow).rule.class })),
  );
  const llmScore = live
    ? score(
        found.map((l) => ({
          label: l.label,
          predicted: ((spotRows.get(l.slug) as ToolRow).llm?.class ??
            "unknown") as ReversibilityClass,
        })),
      )
    : null;

  const tools: ReportTool[] = subset
    .map((row) => toReportTool(row, live))
    .sort((a, b) => a.toolkit.localeCompare(b.toolkit) || a.slug.localeCompare(b.slug));

  const report = buildReport({
    cmp,
    stamp,
    spot: {
      rules: rulesScore,
      llm: llmScore,
      missing: labels.filter((l) => !spotRows.has(l.slug)).map((l) => l.slug),
    },
    tools,
    llmCoverage: { live: liveHits, recorded: recordedHits, population },
  });

  const outDir = deps.outDir ?? path.join(repoRoot, "reports");
  const csvFile = deps.csvFile ?? path.join(outDir, "full", "tools.csv");
  mkdirSync(outDir, { recursive: true });
  mkdirSync(path.dirname(csvFile), { recursive: true });
  writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(path.join(outDir, "REPORT.md"), renderMarkdown(report), "utf8");
  const lines = [CSV_HEAD.join(",")];
  for (const { row, tags, provenance } of csv) {
    const llmClass = live && row.llm ? row.llm.class : null;
    lines.push(
      [
        row.slug,
        row.toolkit,
        row.deprecated,
        row.tier,
        tags,
        row.rule.class,
        row.rule.confidence,
        llmClass,
        provenance,
        llmClass === null ? null : llmClass === row.rule.class,
        live ? isGap(row) : null,
        isSingleGapRules(row),
        row.rule.reasons.join("; "),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  writeFileSync(csvFile, `${lines.join("\n")}\n`, "utf8");

  const rel = (f: string) => path.relative(repoRoot, f).split(path.sep).join("/");
  const out = [
    `report: ${cmp.tools} tools (${cmp.deprecatedExcluded} deprecated excluded) in ${cmp.toolkits.size} toolkits from ${dir}`,
    `  llmStatus ${llmStatus} (live ${liveHits}/${population}, recorded ${recordedHits} ignored per D31)`,
    `  spot-check ${rulesScore.n} labels: rules irreversible P ${rulesScore.precision} R ${rulesScore.recall}`,
    `  wrote ${rel(path.join(outDir, "REPORT.md"))}, ${rel(path.join(outDir, "report.json"))}, ${rel(csvFile)}`,
  ];
  if (git.dirty)
    out.push(
      "  warning: working tree is dirty (stamp.dirty = true); commit first for a citable report",
    );
  return { output: out.join("\n"), exitCode: 0 };
}
