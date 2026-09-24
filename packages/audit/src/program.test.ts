import { describe, expect, it } from "vitest";
import { buildProgram, helpText, parseArgs } from "./program.js";

describe("parseArgs", () => {
  it("defaults to help with no arguments", () => {
    const result = parseArgs([]);
    expect(result.help).toBe(true);
    expect(result.command).toBeNull();
  });

  it("parses a known command", () => {
    const result = parseArgs(["fetch"]);
    expect(result.command).toBe("fetch");
    expect(result.help).toBe(false);
  });

  it("parses flags after the command", () => {
    const result = parseArgs(["classify", "--toolkits", "gmail,slack", "--dry-run"]);
    expect(result.command).toBe("classify");
    expect(result.toolkits).toEqual(["gmail", "slack"]);
    expect(result.dryRun).toBe(true);
  });

  it("ignores a literal '--' separator forwarded by pnpm/npm", () => {
    const result = parseArgs(["--", "fetch"]);
    expect(result.command).toBe("fetch");
    expect(result.help).toBe(false);
  });

  it("treats --help as help regardless of command", () => {
    const result = parseArgs(["report", "--help"]);
    expect(result.help).toBe(true);
  });
});

describe("helpText", () => {
  it("mentions every command", () => {
    const text = helpText();
    expect(text).toContain("fetch");
    expect(text).toContain("classify");
    expect(text).toContain("report");
    expect(text).toContain("all");
  });
});

describe("buildProgram", () => {
  it("registers stub commands that report not implemented", () => {
    const program = buildProgram();
    expect(program.map((c) => c.name)).toEqual(["fetch", "classify", "report", "all"]);
    for (const command of program) {
      expect(command.run({} as never)).toBe(`${command.name}: not implemented`);
    }
  });
});
