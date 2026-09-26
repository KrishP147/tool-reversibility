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

  it("parses fetch options", () => {
    const r = parseArgs(["fetch", "--refresh", "--out", "x/y", "--max-tools", "40"]);
    expect(r).toMatchObject({ refresh: true, out: "x/y", maxTools: 40 });
  });

  it("parses classify options", () => {
    const r = parseArgs([
      "classify",
      "--rules",
      "--llm",
      "--live",
      "--model",
      "claude-opus-5",
      "--snapshot",
      "C:/snap",
      "--include-deprecated",
    ]);
    expect(r).toMatchObject({
      command: "classify",
      rules: true,
      llm: true,
      live: true,
      model: "claude-opus-5",
      snapshot: "C:/snap",
      includeDeprecated: true,
      dryRun: false,
    });
  });

  it("defaults classify options off and ignores a flag-valued --model", () => {
    const r = parseArgs(["classify", "--model", "--dry-run"]);
    expect(r).toMatchObject({ rules: false, llm: false, live: false, model: null, dryRun: true });
    expect(r.snapshot).toBeNull();
    expect(r.includeDeprecated).toBe(false);
  });

  it("ignores a non-positive --max-tools", () => {
    expect(parseArgs(["fetch", "--max-tools", "0"]).maxTools).toBeNull();
  });

  it("treats --help as help regardless of command", () => {
    const result = parseArgs(["report", "--help"]);
    expect(result.help).toBe(true);
  });

  it("parses explain's positional slug and --json/--snapshot/--model", () => {
    const r = parseArgs([
      "explain",
      "GMAIL_SEND_EMAIL",
      "--snapshot",
      "fixtures/catalog/trimmed",
      "--model",
      "claude-opus-5",
      "--json",
    ]);
    expect(r).toMatchObject({
      command: "explain",
      slug: "GMAIL_SEND_EMAIL",
      snapshot: "fixtures/catalog/trimmed",
      model: "claude-opus-5",
      json: true,
    });
  });

  it("leaves explain's slug null when none is given", () => {
    const r = parseArgs(["explain", "--json"]);
    expect(r.slug).toBeNull();
    expect(r.json).toBe(true);
  });

  it("does not treat other commands' stray positionals as a slug", () => {
    const r = parseArgs(["fetch", "stray"]);
    expect(r.slug).toBeNull();
  });
});

describe("helpText", () => {
  it("mentions every command", () => {
    const text = helpText();
    expect(text).toContain("fetch");
    expect(text).toContain("classify");
    expect(text).toContain("report");
    expect(text).toContain("all");
    expect(text).toContain("explain");
  });
});

describe("buildProgram", () => {
  it("registers stub commands that report not implemented", async () => {
    const program = buildProgram();
    expect(program.map((c) => c.name)).toEqual(["fetch", "classify", "report", "all", "explain"]);
    for (const command of program) {
      expect((await command.run({} as never)).output).toBe(`${command.name}: not implemented`);
    }
  });

  it("uses injected handlers", async () => {
    const program = buildProgram({ fetch: async () => ({ output: "ok", exitCode: 0 }) });
    expect(await program[0]?.run({} as never)).toEqual({ output: "ok", exitCode: 0 });
  });
});
