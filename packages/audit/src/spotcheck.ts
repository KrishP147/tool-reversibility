/**
 * Hand-labelled spot-check set (plan §4): load fixtures/labels/spotcheck.json
 * and score a classifier's predictions against it (per-class precision and
 * recall, plus the headline "irreversible" P/R).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReversibilityClass } from "./classification.js";
import { CLASS_ORDER, emptyConfusion, type Confusion } from "./compare.js";

export interface SpotLabel {
  slug: string;
  toolkit: string;
  label: ReversibilityClass;
  rationale: string;
  labeller: string;
  labelledAt: string;
}

export interface SpotcheckFile {
  schemaVersion: number;
  snapshot?: string;
  method?: string;
  labels: SpotLabel[];
}

export function spotcheckFile(repoRoot: string): string {
  return path.join(repoRoot, "fixtures", "labels", "spotcheck.json");
}

export function parseLabels(raw: unknown): SpotLabel[] {
  const doc = raw as Partial<SpotcheckFile>;
  if (!doc || !Array.isArray(doc.labels)) throw new Error("spotcheck: missing labels[]");
  const seen = new Set<string>();
  return doc.labels.map((l, i) => {
    if (!l || typeof l.slug !== "string" || !CLASS_ORDER.includes(l.label)) {
      throw new Error(`spotcheck: invalid label at index ${i}`);
    }
    if (seen.has(l.slug)) throw new Error(`spotcheck: duplicate slug ${l.slug}`);
    seen.add(l.slug);
    return l;
  });
}

export function loadLabels(file: string): SpotLabel[] {
  return parseLabels(JSON.parse(readFileSync(file, "utf8")));
}

export interface PR {
  tp: number;
  /** Tools the classifier put in this class. */
  predicted: number;
  /** Tools labelled with this class. */
  actual: number;
  precision: number | null;
  recall: number | null;
}

export interface Score {
  n: number;
  accuracy: number | null;
  perClass: Record<ReversibilityClass, PR>;
  /** Headline: precision/recall on "irreversible". */
  precision: number | null;
  recall: number | null;
  /** rows = label, columns = prediction. */
  confusion: Confusion;
}

/** Ratio with 3 decimals, or null when the denominator is 0. */
export function ratio(n: number, d: number): number | null {
  return d === 0 ? null : Math.round((n / d) * 1000) / 1000;
}

export function score(
  pairs: readonly { label: ReversibilityClass; predicted: ReversibilityClass }[],
): Score {
  const confusion = emptyConfusion();
  for (const p of pairs) confusion[p.label][p.predicted] += 1;
  let correct = 0;
  const perClass = {} as Record<ReversibilityClass, PR>;
  for (const c of CLASS_ORDER) {
    const tp = confusion[c][c];
    correct += tp;
    const predicted = CLASS_ORDER.reduce((s, l) => s + confusion[l][c], 0);
    const actual = CLASS_ORDER.reduce((s, p) => s + confusion[c][p], 0);
    perClass[c] = {
      tp,
      predicted,
      actual,
      precision: ratio(tp, predicted),
      recall: ratio(tp, actual),
    };
  }
  return {
    n: pairs.length,
    accuracy: ratio(correct, pairs.length),
    perClass,
    precision: perClass.irreversible.precision,
    recall: perClass.irreversible.recall,
    confusion,
  };
}
