#!/usr/bin/env node
import { buildProgram, helpText, parseArgs } from "./program.js";

function main(argv: string[]): void {
  const args = parseArgs(argv);

  if (args.help || !args.command) {
    console.log(helpText());
    return;
  }

  const program = buildProgram();
  const command = program.find((c) => c.name === args.command);
  if (!command) {
    console.log(helpText());
    process.exitCode = 1;
    return;
  }

  console.log(command.run(args));
}

main(process.argv.slice(2));
