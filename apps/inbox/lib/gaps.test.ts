import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getGapDetail, getGapsSummary, llmStatusLabel } from "./gaps";

function makeRepo(): string {
  return mkdtempSync(path.join(tmpdir(), "inbox-gaps-"));
}

function writeReport(repoRoot: string, report: unknown): void {
  mkdirSync(path.join(repoRoot, "reports"), { recursive: true });
  writeFileSync(path.join(repoRoot, "reports", "report.json"), JSON.stringify(report));
}

function writeLabels(repoRoot: string, labels: unknown): void {
  mkdirSync(path.join(repoRoot, "fixtures", "labels"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "fixtures", "labels", "spotcheck.json"),
    JSON.stringify(labels),
  );
}

const SAMPLE_REPORT = {
  stub: false,
  stamp: {
    date: "2026-09-24",
    commit: "a9d50c00eb877ffeb7c670fc17383f5aa78b1cb3",
    llmStatus: "recorded",
    model: "pending",
    generatedAt: "2026-09-25T18:06:10.216Z",
  },
  totals: { tools: 100, toolkits: 10, deprecatedExcluded: 5 },
  perToolkit: {
    gmail: { tools: 60, rulesIrreversible: 10, singleGap: 3 },
    outlook: { tools: 20, rulesIrreversible: 2, singleGap: 1 },
  },
  topGaps: {
    kind: "single-classifier (rules only)",
    rows: [
      {
        slug: "GMAIL_SEND_EMAIL",
        toolkit: "gmail",
        ruleClass: "irreversible",
        llmClass: null,
        confidence: 1,
        important: true,
        tags: ["openWorldHint", "createHint"],
        reason: "verb:SEND",
      },
      // Not in `tools[]` below -- `tools[]` only covers Enhanced Controls
      // apps + pending slugs, so most real topGaps rows land here.
      {
        slug: "GOOGLESUPER_SEND_EMAIL",
        toolkit: "googlesuper",
        ruleClass: "irreversible",
        llmClass: null,
        confidence: 1,
        important: true,
        tags: ["openWorldHint", "createHint", "important", "email"],
        reason: "verb:SEND",
      },
    ],
  },
  tools: [
    {
      slug: "GMAIL_SEND_EMAIL",
      toolkit: "gmail",
      ruleClass: "irreversible",
      llmClass: "unknown",
      agree: false,
      hints: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
        createHint: true,
        updateHint: false,
        important: true,
      },
      tier: "Write",
      tierSource: "derived",
      reasons: ["verb:SEND"],
      ruleConfidence: 1,
    },
    {
      slug: "GMAIL_MOVE_TO_TRASH",
      toolkit: "gmail",
      ruleClass: "compensable",
      llmClass: "compensable",
      agree: true,
      hints: { destructiveHint: false },
      tier: "Write",
      tierSource: "derived",
      reasons: ["verb:MOVE"],
      compensatingTool: "GMAIL_UNTRASH_MESSAGE",
    },
  ],
};

describe("llmStatusLabel", () => {
  it("labels 'live' as-is", () => {
    expect(llmStatusLabel("live")).toBe("live");
  });

  it("labels anything else as rules-only / pending", () => {
    expect(llmStatusLabel("recorded")).toBe("rules-only — LLM pending");
    expect(llmStatusLabel("pending")).toBe("rules-only — LLM pending");
    expect(llmStatusLabel(undefined)).toBe("rules-only — LLM pending");
  });
});

describe("getGapsSummary", () => {
  it("is unavailable when reports/report.json is absent", () => {
    const repoRoot = makeRepo();
    try {
      const summary = getGapsSummary(repoRoot);
      expect(summary.available).toBe(false);
      if (!summary.available) {
        expect(summary.note).toMatch(/no report/i);
      }
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("is unavailable when the report is a stub", () => {
    const repoRoot = makeRepo();
    try {
      writeReport(repoRoot, { ...SAMPLE_REPORT, stub: true });
      const summary = getGapsSummary(repoRoot);
      expect(summary.available).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("never throws on a malformed report.json", () => {
    const repoRoot = makeRepo();
    try {
      mkdirSync(path.join(repoRoot, "reports"), { recursive: true });
      writeFileSync(path.join(repoRoot, "reports", "report.json"), "{ not json");
      expect(() => getGapsSummary(repoRoot)).not.toThrow();
      expect(getGapsSummary(repoRoot).available).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns stamp, totals, an enriched top-gaps table and the per-toolkit rows", () => {
    const repoRoot = makeRepo();
    try {
      writeReport(repoRoot, SAMPLE_REPORT);
      const summary = getGapsSummary(repoRoot);
      expect(summary.available).toBe(true);
      if (!summary.available) return;

      expect(summary.stamp.commit).toBe(SAMPLE_REPORT.stamp.commit);
      expect(summary.llmStatusLabel).toBe("rules-only — LLM pending");
      expect(summary.totals.tools).toBe(100);

      expect(summary.topGaps).toHaveLength(2);
      expect(summary.topGaps[0]).toMatchObject({
        slug: "GMAIL_SEND_EMAIL",
        toolkit: "gmail",
        ruleClass: "irreversible",
        confidence: 1,
        tier: "Write",
        tierSource: "derived",
        reasons: ["verb:SEND"],
      });
      expect(summary.topGaps[0]?.hints).toEqual(
        expect.arrayContaining(["openWorldHint", "createHint", "important"]),
      );

      // Row 2's slug isn't in tools[]: tier/tierSource fall back to null
      // (never "unknown (derived)") and hints come from the row's own tags,
      // dropping non-hint tags like "email".
      expect(summary.topGaps[1]).toMatchObject({
        slug: "GOOGLESUPER_SEND_EMAIL",
        toolkit: "googlesuper",
        ruleClass: "irreversible",
        confidence: 1,
        tier: null,
        tierSource: null,
        reasons: ["verb:SEND"],
      });
      expect(summary.topGaps[1]?.hints.sort()).toEqual(
        ["createHint", "important", "openWorldHint"].sort(),
      );

      // All 8 Enhanced Controls toolkits are present, in order, even ones
      // missing from perToolkit (zero-filled rather than throwing).
      expect(summary.perToolkit.map((row) => row.toolkit)).toEqual([
        "gmail",
        "outlook",
        "slack",
        "googlesheets",
        "googlecalendar",
        "googledrive",
        "github",
        "notion",
      ]);
      expect(summary.perToolkit[0]).toEqual({
        toolkit: "gmail",
        tools: 60,
        irreversible: 10,
        gap: 3,
      });
      expect(summary.perToolkit[2]).toEqual({
        toolkit: "slack",
        tools: 0,
        irreversible: 0,
        gap: 0,
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("caps the top-gaps table at 50 rows", () => {
    const repoRoot = makeRepo();
    try {
      const rows = Array.from({ length: 60 }, (_, i) => ({
        slug: `TOOL_${i}`,
        toolkit: "gmail",
        ruleClass: "irreversible",
        llmClass: null,
        confidence: 0.5,
        important: false,
        tags: [],
        reason: "verb:X",
      }));
      writeReport(repoRoot, { ...SAMPLE_REPORT, topGaps: { kind: "x", rows } });
      const summary = getGapsSummary(repoRoot);
      expect(summary.available).toBe(true);
      if (summary.available) {
        expect(summary.topGaps).toHaveLength(50);
      }
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("getGapDetail", () => {
  it("returns no-report when there is no real report", () => {
    const repoRoot = makeRepo();
    try {
      expect(getGapDetail("GMAIL_SEND_EMAIL", repoRoot)).toEqual({ status: "no-report" });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns not-found for an unknown slug in a real report", () => {
    const repoRoot = makeRepo();
    try {
      writeReport(repoRoot, SAMPLE_REPORT);
      expect(getGapDetail("NOPE", repoRoot)).toEqual({ status: "not-found" });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("computes singleGap/gap and attaches a spot-check label when present", () => {
    const repoRoot = makeRepo();
    try {
      writeReport(repoRoot, SAMPLE_REPORT);
      writeLabels(repoRoot, {
        labels: [
          {
            slug: "GMAIL_SEND_EMAIL",
            label: "irreversible",
            rationale: "Delivers to external recipients.",
          },
        ],
      });

      const result = getGapDetail("GMAIL_SEND_EMAIL", repoRoot);
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;

      expect(result.detail).toMatchObject({
        slug: "GMAIL_SEND_EMAIL",
        toolkit: "gmail",
        ruleClass: "irreversible",
        ruleConfidence: 1,
        tier: "Write",
        tierSource: "derived",
        llmClass: "unknown",
        llmStatus: "recorded",
        llmStatusLabel: "rules-only — LLM pending",
        agree: false,
        singleGap: true, // irreversible, no destructiveHint
        gap: false, // llmStatus isn't "live"
      });
      expect(result.detail.spotcheck).toEqual({
        label: "irreversible",
        rationale: "Delivers to external recipients.",
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("has no spot-check label, no compensatingTool and gap:false for a tool without either", () => {
    const repoRoot = makeRepo();
    try {
      writeReport(repoRoot, SAMPLE_REPORT);
      const result = getGapDetail("GMAIL_MOVE_TO_TRASH", repoRoot);
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.detail.spotcheck).toBeNull();
      expect(result.detail.compensatingTool).toBe("GMAIL_UNTRASH_MESSAGE");
      expect(result.detail.singleGap).toBe(false); // compensable, not irreversible
      expect(result.detail.gap).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("marks gap true only when rules and a live LLM verdict agree it's irreversible", () => {
    const repoRoot = makeRepo();
    try {
      writeReport(repoRoot, {
        ...SAMPLE_REPORT,
        stamp: { ...SAMPLE_REPORT.stamp, llmStatus: "live" },
      });
      const result = getGapDetail("GMAIL_SEND_EMAIL", repoRoot);
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      // tools[0].llmClass is "unknown" in the fixture, so still no gap.
      expect(result.detail.gap).toBe(false);
      expect(result.detail.llmStatusLabel).toBe("live");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("falls back to the topGaps row when the slug isn't in tools[]", () => {
    const repoRoot = makeRepo();
    try {
      writeReport(repoRoot, SAMPLE_REPORT);
      const result = getGapDetail("GOOGLESUPER_SEND_EMAIL", repoRoot);
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;

      expect(result.detail).toMatchObject({
        slug: "GOOGLESUPER_SEND_EMAIL",
        toolkit: "googlesuper",
        ruleClass: "irreversible",
        ruleConfidence: 1,
        reasons: ["verb:SEND"],
        tier: null,
        tierSource: null,
        llmClass: null,
        llmStatus: "recorded",
        llmStatusLabel: "rules-only — LLM pending",
        singleGap: true, // irreversible, no destructiveHint tag
        gap: false, // llmStatus isn't "live"
        partial: true,
      });
      // Only hint-named tags become hints; "email" is dropped as a
      // non-hint category tag.
      expect(result.detail.hints).toEqual({
        openWorldHint: true,
        createHint: true,
        important: true,
      });
      expect(result.detail.spotcheck).toBeNull();
      expect(result.detail.compensatingTool).toBeUndefined();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("marks a fallback row's singleGap false when its tags include destructiveHint", () => {
    const repoRoot = makeRepo();
    try {
      writeReport(repoRoot, {
        ...SAMPLE_REPORT,
        topGaps: {
          kind: "single-classifier (rules only)",
          rows: [
            {
              slug: "SLACK_DELETE_MESSAGE",
              toolkit: "slack",
              ruleClass: "irreversible",
              llmClass: null,
              confidence: 1,
              important: true,
              tags: ["destructiveHint"],
              reason: "verb:DELETE",
            },
          ],
        },
      });
      const result = getGapDetail("SLACK_DELETE_MESSAGE", repoRoot);
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.detail.partial).toBe(true);
      expect(result.detail.singleGap).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("still returns not-found for a slug in neither tools[] nor topGaps.rows", () => {
    const repoRoot = makeRepo();
    try {
      writeReport(repoRoot, SAMPLE_REPORT);
      expect(getGapDetail("TOTALLY_UNKNOWN", repoRoot)).toEqual({ status: "not-found" });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("does not throw when reports/report.json is malformed", () => {
    const repoRoot = makeRepo();
    try {
      mkdirSync(path.join(repoRoot, "reports"), { recursive: true });
      writeFileSync(path.join(repoRoot, "reports", "report.json"), "{ not json");
      expect(() => getGapDetail("GMAIL_SEND_EMAIL", repoRoot)).not.toThrow();
      expect(getGapDetail("GMAIL_SEND_EMAIL", repoRoot)).toEqual({ status: "no-report" });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
