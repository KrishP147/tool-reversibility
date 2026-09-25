/**
 * Report step (plan §3a, §4): turn a finished Comparison + spot-check scores
 * into the stamped reports/report.json and reports/REPORT.md. Pure: the
 * caller (reportCommand.ts) does all I/O.
 *
 * Honesty rules (D31, docs/stamping.md): LLM-dependent numbers (llm.*,
 * agreement.*, gap.*, perToolkit.*.irreversible|gap, LLM P/R, disagreement
 * sample) are only emitted when every in-population tool has a *live* LLM
 * result. Recorded (synthetic) cache entries never count; until then the
 * headline is the literal `[[pending live run]]`.
 */
import type { ReversibilityClass } from "./classification.js";
import {
  CLASS_ORDER,
  EC_TOOLKITS,
  rankGaps,
  seededSample,
  type ClassCounts,
  type Comparison,
  type Confusion,
  type GapRow,
  type MNP,
  type ToolRow,
} from "./compare.js";
import type { Score } from "./spotcheck.js";

export const PENDING = "[[pending live run]]";
export const TOP_GAPS = 50;
export const DISAGREEMENT_SAMPLE = 25;
export const DISAGREEMENT_SEED = 20260925;

export type LlmStatus = "live" | "recorded" | "pending";

export interface Stamp {
  /** Catalog snapshot date (manifest.date). */
  date: string;
  generatedAt: string;
  commit: string;
  dirty: boolean;
  sdkVersion: string;
  /** Model id when live, else "pending". */
  model: string;
  llmStatus: LlmStatus;
  promptVersion: string;
  manifestSha256: string;
  regenerate: string;
}

/** Same shape as apps/inbox/lib/report.ts ToolReport (plus ruleConfidence). */
export interface ReportTool {
  slug: string;
  toolkit: string;
  ruleClass: ReversibilityClass;
  /** "unknown" unless llmStatus is live. */
  llmClass: ReversibilityClass;
  agree: boolean;
  hints: Record<string, boolean>;
  tier: string;
  tierSource: "derived";
  reasons: string[];
  ruleConfidence: number;
}

export function toReportTool(row: ToolRow, live: boolean): ReportTool {
  const h = row.hints;
  const llm = live ? row.llm : null;
  return {
    slug: row.slug,
    toolkit: row.toolkit,
    ruleClass: row.rule.class,
    llmClass: llm?.class ?? "unknown",
    agree: llm !== null && llm.class === row.rule.class,
    hints: {
      readOnlyHint: h.readOnlyHint,
      destructiveHint: h.destructiveHint,
      idempotentHint: h.idempotentHint,
      openWorldHint: h.openWorldHint,
      createHint: h.createHint,
      updateHint: h.updateHint,
      important: h.important,
    },
    tier: row.tier,
    tierSource: "derived",
    reasons: row.rule.reasons.map((r) => `rules: ${r}`),
    ruleConfidence: row.rule.confidence,
  };
}

export interface SpotcheckInput {
  /** Labels whose slug was found in the snapshot (non-deprecated). */
  rules: Score;
  /** Only when live. */
  llm: Score | null;
  /** Labelled slugs not found in this snapshot. */
  missing: string[];
}

export interface BuildInput {
  cmp: Comparison;
  stamp: Stamp;
  spot: SpotcheckInput;
  tools: ReportTool[];
  llmCoverage: { live: number; recorded: number; population: number };
}

interface PerToolkit {
  tools: number;
  rulesIrreversible: number;
  singleGap: number;
  irreversible?: number;
  gap?: number;
}

export interface ReportJson {
  stub: false;
  note: string;
  generatedAt: string;
  llmStatus: LlmStatus;
  stamp: Stamp;
  population: string;
  llmCoverage: BuildInput["llmCoverage"];
  totals: { tools: number; toolkits: number; deprecatedExcluded: number };
  rules: { byClass: ClassCounts };
  llm?: { byClass: ClassCounts };
  agreement?: { rate: number | null; agree: number; compared: number };
  gap?: MNP;
  confusion?: Confusion;
  singleGap: { rules: MNP };
  perToolkit: Record<string, PerToolkit>;
  spotcheck: {
    n: number;
    missing: string[];
    rules: Score;
    llm: Score | "pending";
  };
  topGaps: { kind: "both classifiers (D2)" | "single-classifier (rules only)"; rows: GapRow[] };
  disagreementSample: { seed: number; size: number; rows: GapRow[] } | "pending";
  tools: ReportTool[];
}

export function buildReport(input: BuildInput): ReportJson {
  const { cmp, stamp, spot } = input;
  const live = stamp.llmStatus === "live";
  const perToolkit: Record<string, PerToolkit> = {};
  for (const slug of EC_TOOLKITS) {
    const s = cmp.perToolkit.get(slug);
    if (!s) continue;
    perToolkit[slug] = {
      tools: s.tools,
      rulesIrreversible: s.rulesIrreversible,
      singleGap: s.singleGap,
      ...(live ? { irreversible: s.bothIrreversible, gap: s.gap } : {}),
    };
  }
  const report: ReportJson = {
    stub: false,
    note: live
      ? "Live LLM run: every number is stamped."
      : `LLM status ${stamp.llmStatus}: rule-classifier numbers only; every LLM-dependent number is ${PENDING} (D31).`,
    generatedAt: stamp.generatedAt,
    llmStatus: stamp.llmStatus,
    stamp,
    population:
      "Non-deprecated tools of the snapshot. Deprecated tools are counted in totals.deprecatedExcluded and left out of every other number (D28).",
    llmCoverage: input.llmCoverage,
    totals: {
      tools: cmp.tools,
      toolkits: cmp.toolkits.size,
      deprecatedExcluded: cmp.deprecatedExcluded,
    },
    rules: { byClass: { ...cmp.rulesByClass } },
    singleGap: { rules: cmp.singleGap() },
    perToolkit,
    spotcheck: {
      n: spot.rules.n,
      missing: spot.missing,
      rules: spot.rules,
      llm: live && spot.llm ? spot.llm : "pending",
    },
    topGaps: live
      ? { kind: "both classifiers (D2)", rows: rankGaps(cmp.gaps, TOP_GAPS) }
      : { kind: "single-classifier (rules only)", rows: rankGaps(cmp.singleGaps, TOP_GAPS) },
    disagreementSample: live
      ? {
          seed: DISAGREEMENT_SEED,
          size: DISAGREEMENT_SAMPLE,
          rows: seededSample(cmp.disagreements, DISAGREEMENT_SAMPLE, DISAGREEMENT_SEED),
        }
      : "pending",
    tools: input.tools,
  };
  if (live) {
    report.llm = { byClass: { ...cmp.llmByClass } };
    report.agreement = { rate: cmp.agreementRate(), agree: cmp.agree, compared: cmp.llmCompared };
    report.gap = cmp.gap();
    report.confusion = cmp.confusion;
  }
  return report;
}

// ------------------------------------------------------------------ markdown

const n = (v: number) => v.toLocaleString("en-US");
const p = (v: number | null) => (v === null ? "n/a" : `${v}%`);
const r = (v: number | null) => (v === null ? "n/a" : v.toFixed(3));

function table(head: string[], rows: string[][]): string {
  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function confusionTable(c: Confusion, rowName: string, colName: string): string {
  return table(
    [`${rowName} \\ ${colName}`, ...CLASS_ORDER],
    CLASS_ORDER.map((row) => [row, ...CLASS_ORDER.map((col) => n(c[row][col]))]),
  );
}

function gapTable(rows: GapRow[]): string {
  return table(
    ["#", "slug", "toolkit", "rule confidence", "tags", "rule reason"],
    rows.map((g, i) => [
      String(i + 1),
      `\`${g.slug}\``,
      g.toolkit,
      g.confidence.toFixed(2),
      g.tags.join(", ") || "(none)",
      g.reason.replace(/\|/g, "\\|"),
    ]),
  );
}

export function renderMarkdown(rep: ReportJson): string {
  const s = rep.stamp;
  const live = s.llmStatus === "live";
  const out: string[] = [];
  out.push("# Tool reversibility report", "");
  out.push(
    table(
      ["stamp", "value"],
      [
        ["date (snapshot)", s.date],
        ["generatedAt", s.generatedAt],
        ["commit", `\`${s.commit}\``],
        ["dirty", String(s.dirty)],
        ["@composio/core", s.sdkVersion],
        ["model", s.model],
        ["llmStatus", s.llmStatus],
        ["promptVersion", s.promptVersion],
        ["manifestSha256", `\`${s.manifestSha256}\``],
        ["regenerate", `\`${s.regenerate}\``],
      ],
    ),
    "",
  );
  out.push(
    "Classes are **our** classification (plan D1), not ground truth. The tier is **derived** from",
    "hints (destructiveHint -> Destructive, readOnlyHint -> Read, else Write; D6/D22).",
    "",
  );

  out.push("## Headline", "");
  if (live && rep.gap) {
    out.push(
      `Of ${n(rep.gap.M)} tools that both classifiers call irreversible, ${n(rep.gap.N)} (${p(rep.gap.P)}) carry no \`destructiveHint\`.`,
    );
  } else {
    out.push(
      `Of ${PENDING} tools that both classifiers call irreversible, ${PENDING} (${PENDING}%) carry no \`destructiveHint\`.`,
      "",
      `LLM status is \`${s.llmStatus}\`: live LLM results cover ${n(rep.llmCoverage.live)} of ${n(rep.llmCoverage.population)} tools` +
        (rep.llmCoverage.recorded > 0
          ? ` (${n(rep.llmCoverage.recorded)} recorded synthetic cache entries ignored, D31).`
          : "."),
      "Only rule-classifier numbers below are real; every LLM-dependent number waits for the approved live pass (D11).",
    );
  }
  out.push("");

  out.push("## Population", "");
  out.push(
    table(
      ["", "count"],
      [
        ["toolkits", n(rep.totals.toolkits)],
        ["tools (non-deprecated, the population)", n(rep.totals.tools)],
        ["deprecated tools excluded", n(rep.totals.deprecatedExcluded)],
      ],
    ),
    "",
  );

  out.push("## Classes", "");
  out.push(
    table(
      ["class", "rules", "LLM"],
      CLASS_ORDER.map((c) => [
        c,
        n(rep.rules.byClass[c]),
        rep.llm ? n(rep.llm.byClass[c]) : PENDING,
      ]),
    ),
    "",
  );

  out.push("## Rules vs LLM", "");
  if (rep.confusion && rep.agreement) {
    out.push(
      `Agreement: ${n(rep.agreement.agree)} of ${n(rep.agreement.compared)} (${p(rep.agreement.rate)}).`,
      "",
      confusionTable(rep.confusion, "rules", "LLM"),
    );
  } else {
    out.push(`Agreement rate and the 4x4 confusion matrix: ${PENDING}.`);
  }
  out.push("");

  const sg = rep.singleGap.rules;
  out.push("## Single-classifier gap (rules only)", "");
  out.push(
    `Of ${n(sg.M)} tools the rules call irreversible, ${n(sg.N)} (${p(sg.P)}) carry no \`destructiveHint\`.`,
    "This is not the D2 headline gap, which also needs the LLM to agree.",
    "",
  );

  out.push("## Enhanced Controls apps", "");
  out.push(
    table(
      [
        "toolkit",
        "tools",
        "irreversible (rules)",
        "no destructiveHint (rules)",
        "irreversible (both)",
        "gap (both)",
      ],
      Object.entries(rep.perToolkit).map(([slug, t]) => [
        slug,
        n(t.tools),
        n(t.rulesIrreversible),
        n(t.singleGap),
        t.irreversible === undefined ? PENDING : n(t.irreversible),
        t.gap === undefined ? PENDING : n(t.gap),
      ]),
    ),
    "",
  );

  const sc = rep.spotcheck;
  out.push("## Spot-check", "");
  out.push(
    `Hand-labelled set: \`fixtures/labels/spotcheck.json\`, ${n(sc.n)} labels scored` +
      (sc.missing.length
        ? ` (${sc.missing.length} not in this snapshot: ${sc.missing.join(", ")})`
        : "") +
      ". Labelled blind, pending Krish's review.",
    "",
    `Rules on "irreversible": precision ${r(sc.rules.precision)}, recall ${r(sc.rules.recall)}; accuracy ${r(sc.rules.accuracy)}.`,
    "",
    table(
      [
        "class",
        "labelled",
        "predicted",
        "correct",
        "rules precision",
        "rules recall",
        "LLM precision",
        "LLM recall",
      ],
      CLASS_ORDER.map((c) => {
        const pr = sc.rules.perClass[c];
        const llm = sc.llm === "pending" ? null : sc.llm.perClass[c];
        return [
          c,
          n(pr.actual),
          n(pr.predicted),
          n(pr.tp),
          r(pr.precision),
          r(pr.recall),
          llm ? r(llm.precision) : PENDING,
          llm ? r(llm.recall) : PENDING,
        ];
      }),
    ),
    "",
    confusionTable(sc.rules.confusion, "label", "rules"),
    "",
  );

  out.push(`## Top ${TOP_GAPS} gaps: ${rep.topGaps.kind}`, "");
  if (!live) {
    out.push(
      "Rules say irreversible and there is no `destructiveHint`. These are **single-classifier** candidates,",
      "not D2 gaps. Ranked: Enhanced Controls apps first, then `important`, then rule confidence.",
      "",
    );
  }
  out.push(rep.topGaps.rows.length ? gapTable(rep.topGaps.rows) : "(none)", "");

  out.push("## Disagreement sample", "");
  if (rep.disagreementSample === "pending") {
    out.push(`Seeded ${DISAGREEMENT_SAMPLE}-row sample of rules-vs-LLM disagreements: ${PENDING}.`);
  } else {
    const d = rep.disagreementSample;
    out.push(
      `Seed ${d.seed}, ${d.rows.length} rows.`,
      "",
      table(
        ["slug", "toolkit", "rules", "LLM", "rule reason"],
        d.rows.map((g) => [
          `\`${g.slug}\``,
          g.toolkit,
          g.ruleClass,
          g.llmClass ?? "",
          g.reason.replace(/\|/g, "\\|"),
        ]),
      ),
    );
  }
  out.push("");
  return out.join("\n");
}
