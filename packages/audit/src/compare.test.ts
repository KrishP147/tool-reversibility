import { describe, expect, it } from "vitest";
import type { ClassifierResult, ReversibilityClass } from "./classification.js";
import {
  buildRow,
  Comparison,
  isGap,
  isSingleGapRules,
  mulberry32,
  pct,
  rankGaps,
  seededSample,
  type GapRow,
} from "./compare.js";
import type { SnapshotTool } from "./normalize.js";

function tool(
  slug: string,
  tags: string[] = [],
  toolkit = "gmail",
  isDeprecated = false,
): SnapshotTool {
  return {
    slug,
    name: slug,
    description: "",
    tags,
    inputParameters: {},
    toolkit: { slug: toolkit, name: toolkit },
    version: null,
    isDeprecated,
    scopes: [],
  };
}

function res(c: ReversibilityClass, confidence = 0.9): ClassifierResult {
  return { class: c, confidence, reasons: [`r:${c}`] };
}

describe("gap predicates (D2)", () => {
  it("GAP needs both irreversible and no destructiveHint", () => {
    const send = buildRow(
      tool("GMAIL_SEND_EMAIL", ["important", "openWorldHint"]),
      res("irreversible"),
      res("irreversible"),
    );
    expect(isGap(send)).toBe(true);
    const del = buildRow(
      tool("GMAIL_DELETE_MESSAGE", ["destructiveHint"]),
      res("irreversible"),
      res("irreversible"),
    );
    expect(isGap(del)).toBe(false);
    const split = buildRow(tool("X_SEND"), res("irreversible"), res("compensable"));
    expect(isGap(split)).toBe(false);
    const noLlm = buildRow(tool("X_SEND"), res("irreversible"), null);
    expect(isGap(noLlm)).toBe(false);
    expect(isSingleGapRules(noLlm)).toBe(true);
    expect(isSingleGapRules(del)).toBe(false);
  });

  it("derives the tier from hints", () => {
    expect(buildRow(tool("A", ["destructiveHint"]), res("irreversible"), null).tier).toBe(
      "Destructive",
    );
    expect(buildRow(tool("A", ["readOnlyHint"]), res("reversible"), null).tier).toBe("Read");
    expect(buildRow(tool("A"), res("compensable"), null).tier).toBe("Write");
  });
});

describe("Comparison", () => {
  it("aggregates totals, confusion, agreement and gaps; excludes deprecated", () => {
    const c = new Comparison();
    c.add(buildRow(tool("GMAIL_SEND_EMAIL"), res("irreversible"), res("irreversible")));
    c.add(
      buildRow(
        tool("GMAIL_DELETE_MESSAGE", ["destructiveHint"]),
        res("irreversible"),
        res("irreversible"),
      ),
    );
    c.add(
      buildRow(tool("GMAIL_LIST_LABELS", ["readOnlyHint"]), res("reversible"), res("reversible")),
    );
    c.add(
      buildRow(tool("SLACK_SEND_MESSAGE", [], "slack"), res("irreversible"), res("compensable")),
    );
    c.add(buildRow(tool("SLACK_OLD", [], "slack", true), res("irreversible"), null));

    expect(c.tools).toBe(4);
    expect(c.deprecatedExcluded).toBe(1);
    expect(c.toolkits.size).toBe(2);
    expect(c.rulesByClass).toEqual({ reversible: 1, compensable: 0, irreversible: 3, unknown: 0 });
    expect(c.llmByClass.compensable).toBe(1);
    expect(c.confusion.irreversible.irreversible).toBe(2);
    expect(c.confusion.irreversible.compensable).toBe(1);
    expect(c.agreementRate()).toBe(75);
    expect(c.gap()).toEqual({ M: 2, N: 1, P: 50 });
    expect(c.singleGap()).toEqual({ M: 3, N: 2, P: 66.7 });
    expect(c.perToolkit.get("gmail")).toEqual({
      tools: 3,
      rulesIrreversible: 2,
      singleGap: 1,
      bothIrreversible: 2,
      gap: 1,
    });
    expect(c.disagreements.map((d) => d.slug)).toEqual(["SLACK_SEND_MESSAGE"]);
    expect(c.gaps.map((d) => d.slug)).toEqual(["GMAIL_SEND_EMAIL"]);
  });

  it("with no LLM results, only rule stats move", () => {
    const c = new Comparison();
    c.add(buildRow(tool("GMAIL_SEND_EMAIL"), res("irreversible"), null));
    expect(c.llmCompared).toBe(0);
    expect(c.agreementRate()).toBeNull();
    expect(c.gap()).toEqual({ M: 0, N: 0, P: null });
    expect(c.singleGap()).toEqual({ M: 1, N: 1, P: 100 });
  });
});

describe("helpers", () => {
  it("pct rounds to one decimal", () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(0, 0)).toBeNull();
  });

  it("rankGaps puts EC apps and important tools first, deterministic", () => {
    const g = (slug: string, toolkit: string, important: boolean, confidence: number): GapRow => ({
      slug,
      toolkit,
      ruleClass: "irreversible",
      llmClass: null,
      confidence,
      important,
      tags: [],
      reason: "",
    });
    const ranked = rankGaps(
      [
        g("Z_SEND", "zapier", true, 0.9),
        g("GMAIL_B", "gmail", false, 0.9),
        g("GMAIL_A", "gmail", true, 0.5),
      ],
      2,
    );
    expect(ranked.map((r) => r.slug)).toEqual(["GMAIL_A", "GMAIL_B"]);
  });

  it("seededSample is reproducible and order-independent", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      slug: `T_${String(i).padStart(3, "0")}`,
    }));
    const a = seededSample(rows, 25, 5);
    const b = seededSample([...rows].reverse(), 25, 5);
    expect(a).toHaveLength(25);
    expect(a).toEqual(b);
    expect(seededSample(rows, 25, 6)).not.toEqual(a);
    expect(seededSample(rows.slice(0, 3), 25, 5)).toHaveLength(3);
    const r = mulberry32(1);
    expect(r()).toBeGreaterThanOrEqual(0);
  });
});
