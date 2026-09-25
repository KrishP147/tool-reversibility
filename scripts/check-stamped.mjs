#!/usr/bin/env node
// Stamp check for prose docs: no Composio number without a stamp (plan.md §4, CONTRIBUTING.md).
// Plain Node, no deps. Convention: docs/stamping.md. Run: `pnpm check:stamped`.
/* global process, console */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Snapshots whose counts were verified live (plan.md §10 D19–D24). Only these may be cited. */
export const KNOWN_SNAPSHOTS = [{ date: "2026-09-24", sdk: "0.21.0" }];

/** Report keys the docs may reference; the contract with issue #5's reports/report.json. */
export const KEY_PATTERNS = [
  /^totals\.(tools|toolkits|deprecatedExcluded)$/,
  /^(rules|llm)\.byClass\.(reversible|compensable|irreversible|unknown)$/,
  /^agreement\.rate$/,
  /^gap\.[MNP]$/,
  /^singleGap\.rules\.[MNP]$/,
  /^perToolkit\.[a-z0-9_]+\.[A-Za-z]+$/,
  /^spotcheck\.(n|rules\.precision|rules\.recall)$/,
];

/** Keys computable from rules + catalog alone; everything else needs a live LLM run. */
const RULES_ONLY = /^(totals\.|rules\.|singleGap\.rules\.|spotcheck\.)/;

const PENDING = "[[pending live run]]";
const PLACEHOLDER = /\[\[([^\]]*)\]\]/g;
const SNAPSHOT_MARK = /\[snapshot (\d{4}-\d{2}-\d{2}), @composio\/core (\d+\.\d+\.\d+)\]/g;
const REPORT_MARK = /\[report (\d{4}-\d{2}-\d{2}), commit ([0-9a-f]{7,40})\]/g;
const PERCENT = /\d+(?:\.\d+)?\s?%/g;
// "56,216 tools", "659 deprecated tools", "1,562 Composio toolkits" (<=2 words between).
const NUM_THEN_TOOLS =
  /(?<![\w.-])\d[\d,]*(?:\.\d+)?\s+(?:[A-Za-z-]+\s+){0,2}(?:toolkits?|tools?)\b/gi;
// "tools: 56216", "toolkits (1,562)". The lookbehind skips CLI flags such as `--max-tools 25`.
const TOOLS_THEN_NUM = /(?<![\w-])(?:toolkits?|tools?)\b[\s:=(]*\d[\d,]*(?:\.\d+)?/gi;

/** Dotted-path lookup; undefined when any segment is missing. */
export function lookup(obj, key) {
  let cur = obj;
  for (const part of key.split(".")) {
    if (cur === null || typeof cur !== "object" || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** `stamp` block of report.json (falls back to top level). */
export function reportStamp(report) {
  if (!report) return null;
  return report.stamp && typeof report.stamp === "object" ? report.stamp : report;
}

function validMarks(line, report) {
  const errors = [];
  let cited = false;
  for (const m of line.matchAll(SNAPSHOT_MARK)) {
    if (KNOWN_SNAPSHOTS.some((s) => s.date === m[1] && s.sdk === m[2])) cited = true;
    else errors.push(`unknown snapshot stamp "${m[0]}" (known: see KNOWN_SNAPSHOTS)`);
  }
  for (const m of line.matchAll(REPORT_MARK)) {
    const stamp = reportStamp(report);
    const commit = stamp && typeof stamp.commit === "string" ? stamp.commit : "";
    if (stamp && stamp.date === m[1] && commit.startsWith(m[2])) cited = true;
    else errors.push(`report stamp "${m[0]}" does not match reports/report.json`);
  }
  return { cited, errors };
}

/**
 * Check one Markdown document. `report` is the parsed reports/report.json or null.
 * Returns [{ line, message }]; empty = pass.
 */
export function checkText(text, report = null) {
  const out = [];
  const lines = text.split(/\r?\n/);
  const llmLive = reportStamp(report)?.llmStatus === "live";
  let usesReportKey = false;
  let linksReport = false;

  lines.forEach((raw, i) => {
    const line = i + 1;
    if (/reports\/REPORT\.md/.test(raw)) linksReport = true;

    for (const m of raw.matchAll(PLACEHOLDER)) {
      const body = m[1];
      if (m[0] === PENDING) continue;
      if (!body.startsWith("report:")) {
        out.push({ line, message: `unknown placeholder "${m[0]}"` });
        continue;
      }
      usesReportKey = true;
      const key = body.slice("report:".length);
      if (!KEY_PATTERNS.some((re) => re.test(key))) {
        out.push({ line, message: `unknown report key "${key}" (see KEY_PATTERNS)` });
        continue;
      }
      const value = report ? lookup(report, key) : undefined;
      if (value !== undefined && (RULES_ONLY.test(key) || llmLive)) {
        out.push({
          line,
          message: `"${m[0]}" is available in reports/report.json (${JSON.stringify(value)}): fill it in and cite the report stamp`,
        });
      }
    }

    // Placeholders and stamp markers carry digits of their own; blank them before scanning.
    const prose = raw
      .replace(PLACEHOLDER, " ")
      .replace(SNAPSHOT_MARK, " ")
      .replace(REPORT_MARK, " ");
    const hits = [
      ...[...prose.matchAll(PERCENT)].map((m) => m[0]),
      ...[...prose.matchAll(NUM_THEN_TOOLS)].map((m) => m[0]),
      ...[...prose.matchAll(TOOLS_THEN_NUM)].map((m) => m[0]),
    ];
    const { cited, errors } = validMarks(raw, report);
    for (const e of errors) out.push({ line, message: e });
    if (hits.length > 0 && !cited) {
      out.push({
        line,
        message: `unstamped number(s) ${hits.map((h) => JSON.stringify(h.trim())).join(", ")}: use [[report:KEY]] / ${PENDING}, or cite a stamp on the same line`,
      });
    }
  });

  if (usesReportKey && !linksReport) {
    out.push({
      line: 0,
      message: "uses [[report:KEY]] placeholders but never links reports/REPORT.md",
    });
  }
  return out;
}

function listMarkdown(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.join(e.parentPath ?? e.path, e.name))
    .sort();
}

/** Files in scope: README.md, PROPOSAL.md, docs/**\/*.md (those that exist). */
export function filesToCheck(root) {
  const top = ["README.md", "PROPOSAL.md"].map((f) => path.join(root, f)).filter(existsSync);
  return [...top, ...listMarkdown(path.join(root, "docs"))];
}

export function loadReport(root) {
  const file = path.join(root, "reports", "report.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Check a repo checkout. Returns [{ file, line, message }]. */
export function checkRepo(root) {
  const report = loadReport(root);
  return filesToCheck(root).flatMap((file) =>
    checkText(readFileSync(file, "utf8"), report).map((v) => ({
      file: path.relative(root, file).split(path.sep).join("/"),
      ...v,
    })),
  );
}

function main() {
  const root = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const files = filesToCheck(root);
  const violations = checkRepo(root);
  for (const v of violations) console.error(`${v.file}:${v.line}: ${v.message}`);
  if (violations.length > 0) {
    console.error(
      `check:stamped: ${violations.length} violation(s) (convention: docs/stamping.md)`,
    );
    process.exitCode = 1;
  } else {
    console.log(`check:stamped: ok (${files.length} file(s))`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
