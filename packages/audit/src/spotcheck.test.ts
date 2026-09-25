import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findRepoRoot } from "./paths.js";
import { loadLabels, parseLabels, ratio, score, spotcheckFile } from "./spotcheck.js";

const ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));

describe("spotcheck labels file", () => {
  it("has >=60 blind labels covering all four classes, >=24 from EC apps", () => {
    const labels = loadLabels(spotcheckFile(ROOT));
    expect(labels.length).toBeGreaterThanOrEqual(60);
    const by = (c: string) => labels.filter((l) => l.label === c).length;
    for (const c of ["reversible", "compensable", "irreversible", "unknown"]) {
      expect(by(c)).toBeGreaterThanOrEqual(15);
    }
    const ec = [
      "gmail",
      "outlook",
      "slack",
      "googlesheets",
      "googlecalendar",
      "googledrive",
      "github",
      "notion",
    ];
    expect(labels.filter((l) => ec.includes(l.toolkit)).length).toBeGreaterThanOrEqual(24);
    expect(labels.find((l) => l.slug === "GMAIL_SEND_EMAIL")?.label).toBe("irreversible");
    for (const l of labels) expect(l.labeller).toMatch(/pending Krish review/);
  });

  it("rejects bad labels and duplicates", () => {
    expect(() => parseLabels({})).toThrow(/labels/);
    expect(() => parseLabels({ labels: [{ slug: "A", label: "maybe" }] })).toThrow(/invalid/);
    expect(() =>
      parseLabels({
        labels: [
          { slug: "A", label: "unknown" },
          { slug: "A", label: "unknown" },
        ],
      }),
    ).toThrow(/duplicate/);
  });
});

describe("score", () => {
  it("computes per-class and irreversible precision/recall", () => {
    const s = score([
      { label: "irreversible", predicted: "irreversible" },
      { label: "irreversible", predicted: "compensable" },
      { label: "compensable", predicted: "irreversible" },
      { label: "reversible", predicted: "reversible" },
      { label: "unknown", predicted: "unknown" },
    ]);
    expect(s.n).toBe(5);
    expect(s.precision).toBe(0.5);
    expect(s.recall).toBe(0.5);
    expect(s.accuracy).toBe(0.6);
    expect(s.perClass.reversible).toEqual({
      tp: 1,
      predicted: 1,
      actual: 1,
      precision: 1,
      recall: 1,
    });
    expect(s.perClass.compensable.precision).toBe(0);
    expect(s.confusion.irreversible.compensable).toBe(1);
  });

  it("returns null ratios for empty classes", () => {
    const s = score([]);
    expect(s.precision).toBeNull();
    expect(s.accuracy).toBeNull();
    expect(ratio(2, 3)).toBe(0.667);
  });
});
