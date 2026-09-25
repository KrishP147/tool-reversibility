import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSnapshotTools } from "./classifyCommand.js";
import { cacheKey, CACHE_SCHEMA_VERSION, PROMPT_VERSION, writeCache } from "./llm.js";
import { findRepoRoot } from "./paths.js";
import { parseArgs } from "./program.js";
import { PENDING, type ReportJson } from "./report.js";
import { regenerateCommand, reportCommand } from "./reportCommand.js";
import { classifyTool } from "./rules.js";

const ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const TRIMMED = path.join(ROOT, "fixtures", "catalog", "trimmed");
const git = () => ({ commit: "abcdef1234567890", dirty: false });
const now = () => new Date("2026-09-25T12:00:00Z");

let out: string;
beforeEach(() => {
  out = mkdtempSync(path.join(tmpdir(), "audit-report-"));
});
afterEach(() => {
  rmSync(out, { recursive: true, force: true });
});

function readReport(): ReportJson {
  return JSON.parse(readFileSync(path.join(out, "report.json"), "utf8")) as ReportJson;
}

describe("reportCommand (trimmed fixture, recorded cache)", () => {
  it("writes a stamped rules-only report; LLM numbers stay pending (D31)", async () => {
    const res = await reportCommand(
      parseArgs(["report", "--snapshot", "fixtures/catalog/trimmed"]),
      {
        repoRoot: ROOT,
        env: {},
        outDir: out,
        git,
        now,
      },
    );
    expect(res.exitCode).toBe(0);
    expect(res.output).toMatch(/llmStatus recorded/);

    const rep = readReport();
    expect(rep.stamp).toMatchObject({
      commit: "abcdef1234567890",
      dirty: false,
      model: "pending",
      llmStatus: "recorded",
      promptVersion: PROMPT_VERSION,
      regenerate: "pnpm audit:cli report --snapshot fixtures/catalog/trimmed",
    });
    expect(rep.stamp.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rep.stamp.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rep.totals.toolkits).toBe(5);
    expect(rep.totals.tools + rep.totals.deprecatedExcluded).toBe(125);
    const sum = Object.values(rep.rules.byClass).reduce((a, b) => a + b, 0);
    expect(sum).toBe(rep.totals.tools);

    // LLM-dependent keys are absent unless live.
    expect(rep.llm).toBeUndefined();
    expect(rep.agreement).toBeUndefined();
    expect(rep.gap).toBeUndefined();
    expect(rep.perToolkit.gmail).toBeDefined();
    expect(rep.perToolkit.gmail?.irreversible).toBeUndefined();
    expect(rep.perToolkit.gmail?.gap).toBeUndefined();
    expect(rep.disagreementSample).toBe("pending");
    expect(rep.spotcheck.llm).toBe("pending");

    expect(rep.singleGap.rules.M).toBeGreaterThan(0);
    expect(rep.topGaps.kind).toBe("single-classifier (rules only)");
    expect(rep.topGaps.rows.map((r) => r.slug)).toContain("GMAIL_SEND_EMAIL");

    // Spot-check: only labels present in the trimmed fixture are scored.
    expect(rep.spotcheck.n).toBeGreaterThan(0);
    expect(rep.spotcheck.n + rep.spotcheck.missing.length).toBeGreaterThanOrEqual(60);

    // tools[]: inbox shape, EC apps + pending fixture slugs, llmClass never invented.
    const send = rep.tools.find((t) => t.slug === "GMAIL_SEND_EMAIL");
    expect(send).toMatchObject({
      ruleClass: "irreversible",
      llmClass: "unknown",
      agree: false,
      tierSource: "derived",
    });
    expect(rep.tools.every((t) => t.llmClass === "unknown")).toBe(true);

    const md = readFileSync(path.join(out, "REPORT.md"), "utf8");
    expect(md).toContain(PENDING);
    expect(md).toContain("abcdef1234567890");
    expect(md).toMatch(/single-classifier/);
    expect(existsSync(path.join(out, "full", "tools.csv"))).toBe(true);
    const csv = readFileSync(path.join(out, "full", "tools.csv"), "utf8")
      .trim()
      .split("\n");
    expect(csv).toHaveLength(126);
    expect(csv[0]).toMatch(/^slug,toolkit,deprecated,/);
  });

  it("fails cleanly on a dir without a manifest", async () => {
    const res = await reportCommand(parseArgs(["report", "--snapshot", out]), {
      repoRoot: ROOT,
      env: {},
      outDir: out,
      git,
      now,
    });
    expect(res.exitCode).toBe(2);
    expect(res.output).toMatch(/manifest/);
  });
});

describe("reportCommand (synthetic live cache in a temp dir)", () => {
  it("emits gap, agreement, confusion and a seeded disagreement sample when every tool is live", async () => {
    const cacheRoot = path.join(out, "cache");
    const model = "test-model";
    const tools = loadSnapshotTools(TRIMMED, null).filter((t) => !t.isDeprecated);
    for (const [i, tool] of tools.entries()) {
      const rule = classifyTool(tool);
      // Flip every 5th tool so there are disagreements.
      const cls =
        i % 5 === 0 ? (rule.class === "reversible" ? "unknown" : "reversible") : rule.class;
      writeCache(cacheRoot, {
        schemaVersion: CACHE_SCHEMA_VERSION,
        promptVersion: PROMPT_VERSION,
        model,
        key: cacheKey(tool),
        slug: tool.slug,
        provenance: "live",
        output: { slug: tool.slug, class: cls, inverse_tool: null, rationale: "test" },
        result: { class: cls, confidence: 0.7, reasons: ["test"] },
      });
    }
    const res = await reportCommand(
      parseArgs(["report", "--snapshot", "fixtures/catalog/trimmed", "--model", model]),
      { repoRoot: ROOT, env: {}, outDir: out, cacheRoot, git, now },
    );
    expect(res.exitCode).toBe(0);
    const rep = readReport();
    expect(rep.llmStatus).toBe("live");
    expect(rep.stamp.model).toBe(model);
    expect(rep.gap?.M).toBeGreaterThan(0);
    expect(rep.agreement?.compared).toBe(tools.length);
    expect(rep.agreement?.rate).toBeLessThan(100);
    expect(rep.perToolkit.gmail?.gap).toBeDefined();
    expect(rep.spotcheck.llm).not.toBe("pending");
    expect(rep.disagreementSample).not.toBe("pending");
    if (rep.disagreementSample !== "pending") {
      expect(rep.disagreementSample.rows.length).toBeLessThanOrEqual(25);
      expect(rep.disagreementSample.rows.length).toBeGreaterThan(0);
    }
    expect(rep.topGaps.kind).toBe("both classifiers (D2)");
    const md = readFileSync(path.join(out, "REPORT.md"), "utf8");
    expect(md).not.toContain(PENDING);
  });
});

describe("regenerateCommand", () => {
  it("prints a repo-style snapshot path when possible", () => {
    expect(regenerateCommand(path.join("C:", "x", "fixtures", "catalog", "2026-09-24"), null)).toBe(
      "pnpm audit:cli report --snapshot fixtures/catalog/2026-09-24",
    );
    expect(regenerateCommand("/tmp/snap", ["gmail", "slack"])).toBe(
      "pnpm audit:cli report --snapshot /tmp/snap --toolkits gmail,slack",
    );
  });
});
