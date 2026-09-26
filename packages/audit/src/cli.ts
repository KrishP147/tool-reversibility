#!/usr/bin/env node
import { allCommand } from "./allCommand.js";
import { classifyCommand } from "./classifyCommand.js";
import { explainCommand } from "./explainCommand.js";
import { fetchCommand } from "./fetchCommand.js";
import { reportCommand } from "./reportCommand.js";
import { buildProgram, helpText, parseArgs } from "./program.js";

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  if (args.help || !args.command) {
    console.log(helpText());
    return;
  }

  const program = buildProgram({
    fetch: (a) => fetchCommand(a),
    classify: (a) => classifyCommand(a),
    report: (a) => reportCommand(a),
    all: (a) => allCommand(a),
    explain: (a) => explainCommand(a),
  });
  const command = program.find((c) => c.name === args.command);
  if (!command) {
    console.log(helpText());
    process.exitCode = 1;
    return;
  }

  const result = await command.run(args);
  console.log(result.output);
  process.exitCode = result.exitCode;
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
