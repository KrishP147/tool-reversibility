import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyCommand, resolveSnapshotDir } from "./classifyCommand.js";
import type { BatchClient } from "./llm.js";
import { findRepoRoot } from "./paths.js";
import { parseArgs } from "./program.js";
import { recordedDir } from "./testing/buildLlmFixture.js";
import { createFakeBatchClient, recordedResponder } from "./testing/fakeAnthropic.js";

const repoRoot = findRepoRoot();
const SECRET = "sk-ant-test-DO-NOT-PRINT-0123456789";
const answers = (
  JSON.parse(readFileSync(path.join(recordedDir(repoRoot), "trimmed.answers.json"), "utf8")) as {
    answers: Parameters<typeof recordedResponder>[0];
  }
).answers;

let cacheRoot: string;
let logs: string[];
beforeEach(() => {
  cacheRoot = mkdtempSync(path.join(tmpdir(), "classify-cache-"));
  logs = [];
});
afterEach(() => rmSync(cacheRoot, { recursive: true, force: true }));

function deps(createClient: (key: string) => BatchClient, env: NodeJS.ProcessEnv = {}) {
  return {
    repoRoot,
    env,
    cacheRoot,
    createClient,
    sleep: async () => {},
    log: (m: string) => logs.push(m),
  };
}

const neverClient = () => vi.fn<(key: string) => BatchClient>();

describe("classify --llm --dry-run", () => {
  it("prints tokens + $ for sonnet and opus and never constructs a client", async () => {
    const factory = neverClient();
    const res = await classifyCommand(
      parseArgs(["classify", "--llm", "--dry-run"]),
      deps(factory, { ANTHROPIC_API_KEY: SECRET }),
    );
    expect(res.exitCode).toBe(0);
    expect(factory).not.toHaveBeenCalled();
    expect(res.output).toContain("snapshot fixtures/catalog/trimmed, 125 tools");
    expect(res.output).toContain("116 tools for the LLM; 9 deprecated excluded");
    expect(res.output).toMatch(
      /claude-sonnet-5: 0 cache hits \(excluded\), 116 to send in \d+ requests/,
    );
    expect(res.output).toMatch(
      /claude-sonnet-5: input ~[\d,]+ tok, output ~[\d,]+ tok -> \$\d+\.\d\d/,
    );
    expect(res.output).toMatch(
      /claude-opus-5: input ~[\d,]+ tok, output ~[\d,]+ tok -> \$\d+\.\d\d/,
    );
    expect(res.output).toContain("nothing was sent");
    expect(res.output).not.toContain(SECRET);
    expect(logs.join("\n")).not.toContain(SECRET);
    expect(res.output).not.toContain("rules:");
  });

  it("does not count recorded (synthetic) cache entries as hits", async () => {
    const res = await classifyCommand(parseArgs(["classify", "--llm", "--dry-run"]), {
      ...deps(neverClient()),
      cacheRoot: undefined,
    });
    expect(res.output).toContain("claude-sonnet-5: 0 cache hits");
  });

  it("excludes live cache hits and honours --include-deprecated and --model", async () => {
    const fake = createFakeBatchClient({ respond: recordedResponder(answers) });
    await classifyCommand(
      parseArgs(["classify", "--llm", "--live", "--toolkits", "gmail"]),
      deps(() => fake, { ANTHROPIC_API_KEY: SECRET }),
    );
    const factory = neverClient();
    const res = await classifyCommand(
      parseArgs(["classify", "--llm", "--dry-run", "--include-deprecated", "--model", "claude-x"]),
      deps(factory, { ANTHROPIC_API_KEY: SECRET }),
    );
    expect(factory).not.toHaveBeenCalled();
    expect(res.output).toContain("125 tools for the LLM; 9 deprecated included");
    // gmail: 25 tools, 1 deprecated -> 24 live-cached for sonnet
    expect(res.output).toContain("claude-sonnet-5: 24 cache hits (excluded), 101 to send");
    expect(res.output).toContain("claude-opus-5: 0 cache hits (excluded), 125 to send");
    expect(res.output).toContain("claude-x: no known Batch price");
    expect(res.output).toContain("selected model: claude-x");
  });
});

describe("classify --llm (no dry run)", () => {
  it("refuses to call the API without --live when tools are uncached", async () => {
    const factory = neverClient();
    const res = await classifyCommand(
      parseArgs(["classify", "--llm"]),
      deps(factory, { ANTHROPIC_API_KEY: SECRET }),
    );
    expect(res.exitCode).toBe(2);
    expect(factory).not.toHaveBeenCalled();
    expect(res.output).toContain("116 of 116 tools not cached for claude-sonnet-5; refusing");
  });

  it("refuses --live without ANTHROPIC_API_KEY", async () => {
    const factory = neverClient();
    const res = await classifyCommand(parseArgs(["classify", "--llm", "--live"]), deps(factory));
    expect(res.exitCode).toBe(2);
    expect(factory).not.toHaveBeenCalled();
    expect(res.output).toContain("--live needs ANTHROPIC_API_KEY");
  });

  it("--live with a key runs the batch; the re-run is 100% cache hits with no client", async () => {
    const fake = createFakeBatchClient({ respond: recordedResponder(answers), shuffle: true });
    const factory = vi.fn((_key: string) => fake as BatchClient);
    const first = await classifyCommand(
      parseArgs(["classify", "--llm", "--live"]),
      deps(factory, { ANTHROPIC_API_KEY: SECRET }),
    );
    expect(first.exitCode).toBe(0);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(SECRET);
    expect(first.output).toMatch(/cache hits 0, misses 116, requests sent \d+, cached 116/);
    expect(first.output + logs.join("\n")).not.toContain(SECRET);

    const again = neverClient();
    const second = await classifyCommand(
      parseArgs(["classify", "--llm", "--live"]),
      deps(again, { ANTHROPIC_API_KEY: SECRET }),
    );
    expect(second.exitCode).toBe(0);
    expect(again).not.toHaveBeenCalled();
    expect(second.output).toContain("cache hits 116, misses 0, requests sent 0, cached 0");
    expect(second.output).not.toContain("recorded fixtures");
  });

  it("uses the committed recorded cache offline and says it is synthetic", async () => {
    const factory = neverClient();
    const res = await classifyCommand(parseArgs(["classify", "--llm"]), {
      ...deps(factory),
      cacheRoot: undefined,
    });
    expect(res.exitCode).toBe(0);
    expect(factory).not.toHaveBeenCalled();
    expect(res.output).toContain("cache hits 116, misses 0, requests sent 0");
    expect(res.output).toContain("116 results are recorded fixtures (synthetic, not model output)");
  });
});

describe("classify --rules", () => {
  it("reports rules as not implemented until #3 lands", async () => {
    const res = await classifyCommand(parseArgs(["classify", "--rules"]), deps(neverClient()));
    expect(res.output).toContain("rules: not implemented (#3)");
    expect(res.output).not.toContain("llm");
  });
});

describe("resolveSnapshotDir", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "classify-root-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("defaults to trimmed, then to the newest dated snapshot with a manifest", () => {
    const cat = path.join(root, "fixtures", "catalog");
    expect(resolveSnapshotDir(root, null)).toBe(path.join(cat, "trimmed"));
    for (const d of ["2026-09-20", "2026-09-24"]) {
      mkdirSync(path.join(cat, d), { recursive: true });
      writeFileSync(path.join(cat, d, "manifest.json"), "{}");
    }
    mkdirSync(path.join(cat, "2026-09-30"), { recursive: true }); // no manifest: ignored
    expect(resolveSnapshotDir(root, null)).toBe(path.join(cat, "2026-09-24"));
  });

  it("accepts absolute or repo-relative --snapshot", () => {
    expect(resolveSnapshotDir(root, "fixtures/x")).toBe(path.join(root, "fixtures", "x"));
    const abs = path.join(tmpdir(), "snap");
    expect(resolveSnapshotDir(root, abs)).toBe(abs);
  });

  it("exits 2 for a missing snapshot dir", async () => {
    const res = await classifyCommand(
      parseArgs(["classify", "--llm", "--dry-run", "--snapshot", "fixtures/nope"]),
      deps(neverClient()),
    );
    expect(res.exitCode).toBe(2);
  });
});
