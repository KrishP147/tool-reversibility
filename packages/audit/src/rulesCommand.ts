/**
 * `audit rules`: run the pure rule-based classifier (rules.ts) over one or
 * more already-fetched toolkit snapshots and print a table. #4 wires the
 * `--rules` CLI flag onto this — not done here.
 */
import { deriveHints, deriveTier } from "./hints.js";
import type { CommandResult } from "./program.js";
import { classifyTool } from "./rules.js";
import { listSnapshotSlugs, readToolkitFile } from "./snapshot.js";

export interface RulesCommandOptions {
  /** Directory holding `<slug>.json` toolkit snapshots (e.g. fixtures/catalog/trimmed). */
  snapshotDir: string;
  /** Toolkit slugs to classify, or null for every snapshot found in `snapshotDir`. */
  toolkits: string[] | null;
}

interface Row {
  slug: string;
  tier: string;
  klass: string;
  confidence: string;
  reasons: string;
}

const HEADER: Row = {
  slug: "slug",
  tier: "tier (derived)",
  klass: "class",
  confidence: "confidence",
  reasons: "reasons",
};

function formatTable(rows: Row[]): string {
  const all = [HEADER, ...rows];
  const width = (key: keyof Row) => Math.max(...all.map((r) => r[key].length));
  const w = {
    slug: width("slug"),
    tier: width("tier"),
    klass: width("klass"),
    confidence: width("confidence"),
  };
  return all
    .map((r) =>
      [
        r.slug.padEnd(w.slug),
        r.tier.padEnd(w.tier),
        r.klass.padEnd(w.klass),
        r.confidence.padEnd(w.confidence),
        r.reasons,
      ].join("  "),
    )
    .join("\n");
}

/** `audit rules`: classify every tool in the given (or all) toolkit snapshots. */
export async function rulesCommand(opts: RulesCommandOptions): Promise<CommandResult> {
  const available = new Set(listSnapshotSlugs(opts.snapshotDir));
  const slugs = opts.toolkits ?? [...available].sort();

  if (slugs.length === 0) {
    return {
      output: `rules: no toolkit snapshots found in ${opts.snapshotDir}`,
      exitCode: 2,
    };
  }

  const rows: Row[] = [];
  const missing: string[] = [];
  for (const slug of slugs) {
    const file = readToolkitFile(opts.snapshotDir, slug);
    if (!file) {
      missing.push(slug);
      continue;
    }
    for (const tool of file.tools) {
      const hints = deriveHints(tool.tags);
      const tier = deriveTier(hints);
      const result = classifyTool(tool);
      rows.push({
        slug: tool.slug,
        tier: `${tier.tier} (${tier.source})`,
        klass: result.class,
        confidence: result.confidence.toFixed(2),
        reasons: result.reasons.join("; "),
      });
    }
  }
  rows.sort((a, b) => a.slug.localeCompare(b.slug));

  if (rows.length === 0) {
    return {
      output: `rules: missing/invalid toolkit snapshot(s): ${missing.join(", ")} (looked in ${opts.snapshotDir})`,
      exitCode: 2,
    };
  }

  const lines = [formatTable(rows)];
  if (missing.length > 0) {
    lines.push(`missing/invalid toolkit snapshot(s): ${missing.join(", ")}`);
  }
  return { output: lines.join("\n\n"), exitCode: missing.length > 0 ? 1 : 0 };
}
