import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSnapshotTools } from "./classifyCommand.js";
import {
  buildExplainResult,
  closestSlugs,
  explainCommand,
  levenshtein,
  renderPlain,
  type ExplainResult,
} from "./explainCommand.js";
import { cacheKey, DEFAULT_CLASSIFIER_MODEL, writeCache } from "./llm.js";
import { findRepoRoot } from "./paths.js";
import { parseArgs } from "./program.js";

const repoRoot = findRepoRoot();
// Pin the committed fixture (D33): a local gitignored dated snapshot would otherwise win.
const TRIMMED = "fixtures/catalog/trimmed";

let cacheRoot: string;
beforeEach(() => {
  cacheRoot = mkdtempSync(path.join(tmpdir(), "explain-cache-"));
});
afterEach(() => rmSync(cacheRoot, { recursive: true, force: true }));

describe("levenshtein / closestSlugs", () => {
  it("is 0 for identical strings and symmetric-ish for simple edits", () => {
    expect(levenshtein("GMAIL_SEND_EMAIL", "GMAIL_SEND_EMAIL")).toBe(0);
    expect(levenshtein("CAT", "CATS")).toBe(1);
    expect(levenshtein("", "ABC")).toBe(3);
  });

  it("ranks the exact slug first and is deterministic on ties", () => {
    const candidates = ["GMAIL_SEND_EMAIL", "GMAIL_SEND_DRAFT", "SLACK_CHAT_POST_MESSAGE"];
    expect(closestSlugs("GMAIL_SEND_EMAIL", candidates, 2)).toEqual([
      "GMAIL_SEND_EMAIL",
      "GMAIL_SEND_DRAFT",
    ]);
    // Same candidates, same target -> same order every time.
    expect(closestSlugs("GMAIL_SEND_EMAIL", candidates, 2)).toEqual(
      closestSlugs("GMAIL_SEND_EMAIL", candidates, 2),
    );
  });
});

describe("explainCommand (offline, --snapshot fixtures/catalog/trimmed)", () => {
  it("GMAIL_SEND_EMAIL: hints, tier, rule verdict, recorded LLM cache, single-gap, spot-check", async () => {
    const res = await explainCommand(
      parseArgs(["explain", "GMAIL_SEND_EMAIL", "--snapshot", TRIMMED]),
      {
        repoRoot,
        cacheRoot: path.join(repoRoot, "fixtures", "llm-cache"),
      },
    );
    expect(res.exitCode).toBe(0);
    const out = res.output;
    expect(out).toContain("explain GMAIL_SEND_EMAIL");
    expect(out).toContain("Toolkit:      gmail");
    expect(out).toContain("openWorldHint");
    expect(out).toContain("createHint");
    expect(out).toMatch(/Derived tier: Write/);
    expect(out).toContain("class:      irreversible");
    expect(out).toContain("verb:SEND");
    // Recorded cache: state is labelled clearly, class is NOT presented as a live verdict.
    expect(out).toContain("recorded-synthetic");
    expect(out).toContain("NOT a model verdict");
    expect(out).not.toMatch(/state:\s+live/);
    expect(out).toContain("recorded class (synthetic, not the LLM's verdict): irreversible");
    // Recorded cache never counts toward GAP, even though both would agree.
    expect(out).toMatch(/GAP \(rules \+ live LLM.*no.*\(LLM not live for this model\)/);
    expect(out).toMatch(/single-gap \(rules irreversible, no destructiveHint\):\s+yes/);
    // Spot-check label present for this slug (fixtures/labels/spotcheck.json).
    expect(out).toContain("Spot-check label: irreversible");
    expect(out).toContain("Delivers an email to external recipients");
  });

  it("reports a miss when the model has no cache entry", async () => {
    const res = await explainCommand(
      parseArgs([
        "explain",
        "GMAIL_SEND_EMAIL",
        "--snapshot",
        TRIMMED,
        "--model",
        "claude-does-not-exist",
      ]),
      { repoRoot, cacheRoot: path.join(repoRoot, "fixtures", "llm-cache") },
    );
    expect(res.exitCode).toBe(0);
    expect(res.output).toMatch(/state:\s+miss \(not cached/);
    expect(res.output).not.toContain("recorded class");
  });

  it("shows a live LLM verdict and counts it toward GAP when both classifiers agree", async () => {
    const dir = path.join(repoRoot, "fixtures", "catalog", "trimmed");
    const tools = loadSnapshotTools(dir, ["gmail"]);
    const tool = tools.find((t) => t.slug === "GMAIL_SEND_EMAIL");
    if (!tool) throw new Error("fixture missing GMAIL_SEND_EMAIL");
    const key = cacheKey(tool);
    writeCache(cacheRoot, {
      schemaVersion: 1,
      promptVersion: "classify.v1",
      model: DEFAULT_CLASSIFIER_MODEL,
      key,
      slug: tool.slug,
      provenance: "live",
      output: {
        slug: tool.slug,
        class: "irreversible",
        inverse_tool: null,
        rationale: "Delivers an email; no undo API exists.",
      },
      result: { class: "irreversible", confidence: 0.7, reasons: ["Delivers an email"] },
    });

    const res = await explainCommand(
      parseArgs(["explain", "GMAIL_SEND_EMAIL", "--snapshot", TRIMMED]),
      {
        repoRoot,
        cacheRoot,
      },
    );
    expect(res.exitCode).toBe(0);
    expect(res.output).toMatch(/state:\s+live/);
    expect(res.output).toContain("class:      irreversible");
    expect(res.output).toContain("Delivers an email; no undo API exists.");
    expect(res.output).toMatch(
      /GAP \(rules \+ live LLM both irreversible, no destructiveHint\): yes/,
    );
  });

  it("unknown slug exits 2 and lists 5 closest slugs, deterministically", async () => {
    const res = await explainCommand(
      parseArgs(["explain", "GMAIL_SEND_EMALL", "--snapshot", TRIMMED]),
      { repoRoot, cacheRoot },
    );
    expect(res.exitCode).toBe(2);
    expect(res.output).toContain('unknown slug "GMAIL_SEND_EMALL"');
    const m = /closest slugs: (.+)$/m.exec(res.output);
    expect(m).not.toBeNull();
    const suggestions = (m?.[1] ?? "").split(", ");
    expect(suggestions).toHaveLength(5);
    expect(suggestions).toContain("GMAIL_SEND_EMAIL");

    const res2 = await explainCommand(
      parseArgs(["explain", "GMAIL_SEND_EMALL", "--snapshot", TRIMMED]),
      { repoRoot, cacheRoot },
    );
    expect(res2.output).toBe(res.output);
  });

  it("--json emits the same data as JSON", async () => {
    const res = await explainCommand(
      parseArgs(["explain", "GMAIL_SEND_EMAIL", "--snapshot", TRIMMED, "--json"]),
      { repoRoot, cacheRoot: path.join(repoRoot, "fixtures", "llm-cache") },
    );
    expect(res.exitCode).toBe(0);
    const data = JSON.parse(res.output) as ExplainResult;
    expect(data.slug).toBe("GMAIL_SEND_EMAIL");
    expect(data.toolkit).toBe("gmail");
    expect(data.tier).toBe("Write");
    expect(data.rule.class).toBe("irreversible");
    expect(data.llm.state).toBe("recorded");
    expect(data.llm.class).toBe("irreversible");
    expect(data.gap).toBe(false);
    expect(data.singleGap).toBe(true);
    expect(data.spotcheck?.label).toBe("irreversible");
    // renderPlain and the command's plain-text branch stay in sync.
    expect(renderPlain(data)).toContain("explain GMAIL_SEND_EMAIL");
  });

  it("no network/API: never touches ANTHROPIC_API_KEY or hits the LLM", async () => {
    const res = await explainCommand(
      parseArgs(["explain", "GMAIL_SEND_EMAIL", "--snapshot", TRIMMED]),
      {
        repoRoot,
        env: {},
        cacheRoot: path.join(repoRoot, "fixtures", "llm-cache"),
      },
    );
    expect(res.exitCode).toBe(0);
  });

  it("errors with exit 2 and a usage message when the slug is missing", async () => {
    const res = await explainCommand(parseArgs(["explain", "--snapshot", TRIMMED]), {
      repoRoot,
      cacheRoot,
    });
    expect(res.exitCode).toBe(2);
    expect(res.output).toContain("missing <slug>");
  });
});

describe("buildExplainResult", () => {
  it("gap requires the LLM result to be live, never recorded, even if it would agree", () => {
    const dir = path.join(repoRoot, "fixtures", "catalog", "trimmed");
    const tools = loadSnapshotTools(dir, ["gmail"]);
    const tool = tools.find((t) => t.slug === "GMAIL_SEND_EMAIL");
    if (!tool) throw new Error("fixture missing GMAIL_SEND_EMAIL");
    const result = buildExplainResult(tool, {
      model: DEFAULT_CLASSIFIER_MODEL,
      cacheRoot: path.join(repoRoot, "fixtures", "llm-cache"),
    });
    expect(result.llm.state).toBe("recorded");
    expect(result.gap).toBe(false);
    expect(result.singleGap).toBe(true);
  });
});
