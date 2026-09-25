import path from "node:path";
import { composioSdkVersion, createComposioCatalogClient, type CatalogClient } from "./client.js";
import { composioApiKey, loadRepoEnv } from "./env.js";
import { runFetch, type RetryOptions } from "./fetch.js";
import { findRepoRoot, localDate, snapshotDir } from "./paths.js";
import type { CommandResult, ParsedArgs } from "./program.js";

export interface FetchCommandDeps {
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  createClient?: (apiKey: string) => CatalogClient;
  sdkVersion?: string;
  date?: string;
  retry?: RetryOptions;
  log?: (msg: string) => void;
}

/** `audit fetch`: resolve paths from the repo root, load .env, run the fetcher. */
export async function fetchCommand(
  args: ParsedArgs,
  deps: FetchCommandDeps = {},
): Promise<CommandResult> {
  if (args.offline) {
    return { output: "fetch: needs network; --offline has nothing to do", exitCode: 2 };
  }
  const repoRoot = deps.repoRoot ?? findRepoRoot();
  const env = deps.env ?? process.env;
  if (!deps.env) loadRepoEnv(repoRoot);
  const apiKey = composioApiKey(env);
  if (!apiKey) {
    return {
      output: "fetch: COMPOSIO_API_KEY is not set (add it to .env at the repo root)",
      exitCode: 2,
    };
  }
  const date = deps.date ?? localDate();
  const outDir = snapshotDir(repoRoot, args.out, date);
  const client = (deps.createClient ?? createComposioCatalogClient)(apiKey);
  const log = deps.log ?? ((m: string) => console.log(m));
  const argv = ["fetch"];
  if (args.toolkits) argv.push("--toolkits", args.toolkits.join(","));
  if (args.out) argv.push("--out", args.out);
  if (args.maxTools) argv.push("--max-tools", String(args.maxTools));
  if (args.refresh) argv.push("--refresh");

  log(`fetch -> ${path.relative(repoRoot, outDir) || "."}${args.refresh ? " (refresh)" : ""}`);
  const res = await runFetch({
    client,
    outDir,
    toolkits: args.toolkits,
    refresh: args.refresh,
    maxTools: args.maxTools ?? undefined,
    retry: deps.retry,
    log,
    manifest: {
      sdkVersion: deps.sdkVersion ?? composioSdkVersion(),
      date,
      command: `pnpm audit:cli ${argv.join(" ")}`,
    },
  });
  const c = res.manifest.counts;
  const lines = [
    `listed ${res.listed}, fetched ${res.fetched.length}, skipped ${res.skipped.length} (on disk), rest fallbacks ${res.fallbacks.length}, failures ${res.failures.length}`,
    `manifest: ${c.toolkits} toolkits, ${c.fullTools} tools (${c.deprecatedTools} deprecated)${c.tools !== c.fullTools ? `, ${c.tools} kept` : ""}`,
    ...res.failures.map((f) => `  failed ${f.slug}: ${f.error}`),
  ];
  return { output: lines.join("\n"), exitCode: res.failures.length > 0 ? 1 : 0 };
}
