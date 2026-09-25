/**
 * Pure argument-parsing for the audit CLI. Kept dependency-free and
 * side-effect-free so it can be unit-tested without spawning a process.
 */

export const COMMANDS = ["fetch", "classify", "report", "all"] as const;
export type Command = (typeof COMMANDS)[number];

export interface ParsedArgs {
  command: Command | null;
  help: boolean;
  toolkits: string[] | null;
  offline: boolean;
  dryRun: boolean;
  refresh: boolean;
  out: string | null;
  maxTools: number | null;
  /** classify: run the rule classifier. */
  rules: boolean;
  /** classify: run the LLM classifier. */
  llm: boolean;
  /** classify: allow a paid Batches submission (also needs ANTHROPIC_API_KEY). */
  live: boolean;
  /** classify: model id (default CLASSIFIER_MODEL env, else claude-sonnet-5). */
  model: string | null;
  /** classify: snapshot dir, absolute or repo-relative. */
  snapshot: string | null;
  /** classify: send deprecated tools to the LLM too. */
  includeDeprecated: boolean;
}

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

/**
 * Parse CLI argv (excluding the node/script entries). Never throws: unknown
 * input just falls through to `help: true` so the caller can print usage.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: null,
    help: false,
    toolkits: null,
    offline: false,
    dryRun: false,
    refresh: false,
    out: null,
    maxTools: null,
    rules: false,
    llm: false,
    live: false,
    model: null,
    snapshot: null,
    includeDeprecated: false,
  };

  // `pnpm <script> -- <args>` (and `npm run` before it) forwards the literal
  // "--" separator into argv instead of stripping it. Drop it so
  // `pnpm --filter audit start -- --help` reaches this parser as `--help`.
  const rest = argv.filter((a) => a !== "--");
  const first = rest[0];
  if (first && isCommand(first)) {
    result.command = first;
    rest.shift();
  }

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--offline") {
      result.offline = true;
    } else if (arg === "--dry-run") {
      result.dryRun = true;
    } else if (arg === "--refresh") {
      result.refresh = true;
    } else if (arg === "--rules") {
      result.rules = true;
    } else if (arg === "--llm") {
      result.llm = true;
    } else if (arg === "--live") {
      result.live = true;
    } else if (arg === "--include-deprecated") {
      result.includeDeprecated = true;
    } else if (arg === "--model" || arg === "--snapshot") {
      const value = rest[i + 1];
      if (value && !value.startsWith("--")) {
        if (arg === "--model") result.model = value;
        else result.snapshot = value;
        i += 1;
      }
    } else if (arg === "--out") {
      const value = rest[i + 1];
      if (value) {
        result.out = value;
        i += 1;
      }
    } else if (arg === "--max-tools") {
      const n = Number(rest[i + 1]);
      if (Number.isInteger(n) && n > 0) {
        result.maxTools = n;
        i += 1;
      }
    } else if (arg === "--toolkits") {
      const value = rest[i + 1];
      if (value) {
        result.toolkits = value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        i += 1;
      }
    }
  }

  if (!result.command) {
    result.help = true;
  }

  return result;
}

export function helpText(): string {
  return [
    "Usage: audit <command> [options]",
    "",
    "Commands:",
    "  fetch      Pull the Composio tool catalog into fixtures/catalog",
    "  classify   Run the rules + LLM classifiers over a snapshot",
    "  report     Build the stamped REPORT.md / report.json",
    "  all        Run fetch, classify and report in sequence",
    "",
    "Options:",
    "  --toolkits <a,b,c>  Limit to specific toolkit slugs",
    "  --offline           Use the committed trimmed fixture, no network",
    "  --dry-run           Print a cost estimate and exit before spending",
    "  --refresh           Re-fetch toolkits already on disk (default: resume)",
    "  --out <dir>         fetch: output dir (default fixtures/catalog/<YYYY-MM-DD>)",
    "  --max-tools <n>     fetch: keep at most n tools per toolkit (trimmed fixture)",
    "  --rules             classify: run the rule classifier",
    "  --llm               classify: run the LLM classifier (neither flag = both)",
    "  --live              classify: submit uncached tools to the paid Batches API",
    "                      (needs ANTHROPIC_API_KEY and the user's approval of the dry-run cost)",
    "  --model <id>        classify: model id (default $CLASSIFIER_MODEL, else claude-sonnet-5)",
    "  --snapshot <dir>    classify: snapshot dir (default latest fixtures/catalog/<date>, else trimmed)",
    "  --include-deprecated  classify: also send deprecated tools to the LLM",
    "  -h, --help          Show this help",
  ].join("\n");
}

export interface CommandResult {
  output: string;
  exitCode: number;
}

/**
 * Build a description of the CLI's registered commands. This is the "program"
 * that cli.ts drives; kept testable and separate from process I/O. Real
 * command implementations are injected via `handlers`.
 */
export interface ProgramCommand {
  name: Command;
  run: (args: ParsedArgs) => Promise<CommandResult>;
}

export type Handlers = Partial<Record<Command, (args: ParsedArgs) => Promise<CommandResult>>>;

export function buildProgram(handlers: Handlers = {}): ProgramCommand[] {
  return COMMANDS.map((name) => ({
    name,
    run:
      handlers[name] ??
      (async (_args: ParsedArgs) => ({ output: `${name}: not implemented`, exitCode: 0 })),
  }));
}
