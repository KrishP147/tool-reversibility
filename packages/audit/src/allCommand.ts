/**
 * `audit all`: fetch -> classify --rules -> report, stopping at the first
 * non-zero exit. `all` never touches the LLM (rules only, D33) and refuses
 * `--live`/`--llm` outright so it can never spend money.
 *
 * `--offline` skips fetch (no network) and pins the snapshot to the
 * committed `fixtures/catalog/trimmed` fixture instead of letting
 * `resolveSnapshotDir` pick up a local dated snapshot. Its report is written
 * to `reports/offline/` (or `--out`), never to the committed
 * `reports/REPORT.md` / `reports/report.json`.
 */
import path from "node:path";
import { classifyCommand } from "./classifyCommand.js";
import { fetchCommand } from "./fetchCommand.js";
import { findRepoRoot } from "./paths.js";
import type { CommandResult, ParsedArgs } from "./program.js";
import { reportCommand } from "./reportCommand.js";

const TRIMMED_SNAPSHOT = path.join("fixtures", "catalog", "trimmed");

export interface AllReportDeps {
  outDir?: string;
  csvFile?: string;
}

export type FetchRunner = (args: ParsedArgs) => Promise<CommandResult>;
export type ClassifyRunner = (args: ParsedArgs) => Promise<CommandResult>;
export type ReportRunner = (args: ParsedArgs, deps: AllReportDeps) => Promise<CommandResult>;

export interface AllCommandDeps {
  repoRoot?: string;
  runFetch?: FetchRunner;
  runClassify?: ClassifyRunner;
  runReport?: ReportRunner;
  log?: (msg: string) => void;
}

function resolveDir(repoRoot: string, dir: string): string {
  return path.isAbsolute(dir) ? dir : path.join(repoRoot, dir);
}

/** `audit all`: see module doc. */
export async function allCommand(
  args: ParsedArgs,
  deps: AllCommandDeps = {},
): Promise<CommandResult> {
  if (args.live || args.llm) {
    return {
      output:
        "all: --live and --llm are not allowed here; `all` always runs `classify --rules` " +
        "and never calls the LLM. Use `classify --llm` (and `--live` once approved, D11) directly.",
      exitCode: 2,
    };
  }

  const repoRoot = deps.repoRoot ?? findRepoRoot();
  const log = deps.log ?? ((m: string) => console.log(m));
  const runFetch = deps.runFetch ?? ((a: ParsedArgs) => fetchCommand(a));
  const runClassify = deps.runClassify ?? ((a: ParsedArgs) => classifyCommand(a));
  const runReport = deps.runReport ?? ((a: ParsedArgs, d: AllReportDeps) => reportCommand(a, d));

  const parts: string[] = [];

  if (args.offline) {
    parts.push(
      "all --offline: skipping fetch (needs network); classifying the committed " +
        `${TRIMMED_SNAPSHOT.split(path.sep).join("/")} fixture instead`,
    );
  } else {
    log("all: fetch");
    const fetchRes = await runFetch({ ...args, command: "fetch" });
    parts.push(fetchRes.output);
    if (fetchRes.exitCode !== 0) {
      return { output: parts.join("\n\n"), exitCode: fetchRes.exitCode };
    }
  }

  // D33: rules only, never the LLM. Offline pins the snapshot explicitly so
  // resolveSnapshotDir can't pick up a local (multi-hundred-MB) dated one.
  // Online, `--out` is where fetch just wrote, so classify/report read it.
  const snapshot = args.snapshot ?? (args.offline ? TRIMMED_SNAPSHOT : args.out);

  log("all: classify --rules");
  const classifyRes = await runClassify({
    ...args,
    command: "classify",
    rules: true,
    llm: false,
    live: false,
    snapshot,
  });
  parts.push(classifyRes.output);
  if (classifyRes.exitCode !== 0) {
    return { output: parts.join("\n\n"), exitCode: classifyRes.exitCode };
  }

  log("all: report");
  const reportDeps: AllReportDeps = {};
  if (args.offline) {
    reportDeps.outDir = args.out
      ? resolveDir(repoRoot, args.out)
      : path.join(repoRoot, "reports", "offline");
    reportDeps.csvFile = path.join(reportDeps.outDir, "full", "tools.csv");
  }
  const reportRes = await runReport({ ...args, command: "report", snapshot }, reportDeps);
  parts.push(reportRes.output);

  return { output: parts.join("\n\n"), exitCode: reportRes.exitCode };
}
