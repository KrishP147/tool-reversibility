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
    "  --refresh           Ignore cached snapshots/results",
    "  -h, --help          Show this help",
  ].join("\n");
}

/**
 * Build a description of the CLI's registered commands. This is the "program"
 * that cli.ts drives; kept pure/testable and separate from process I/O.
 */
export interface ProgramCommand {
  name: Command;
  run: (args: ParsedArgs) => string;
}

export function buildProgram(): ProgramCommand[] {
  return COMMANDS.map((name) => ({
    name,
    run: (_args: ParsedArgs) => `${name}: not implemented`,
  }));
}
