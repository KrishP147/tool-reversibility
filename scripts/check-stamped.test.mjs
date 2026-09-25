// node:test suite for check-stamped.mjs. Runs in the gate via `pnpm check:stamped`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { checkRepo, checkText, filesToCheck, lookup } from "./check-stamped.mjs";

const SNAP = "[snapshot 2026-09-24, @composio/core 0.21.0]";
const REPORT = {
  stamp: { date: "2026-10-01", commit: "abc1234def", llmStatus: "recorded" },
  totals: { tools: 56216, toolkits: 1562 },
  gap: { M: 10, N: 7, P: 70 },
};
const messages = (text, report = null) => checkText(text, report).map((v) => v.message);

describe("pass cases", () => {
  it("allows prose with no Composio numbers", () => {
    assert.deepEqual(messages("Node 22, pnpm 10.28.1, issue #4327, D11, top 12 of the track."), []);
  });
  it("allows the pending placeholder", () => {
    assert.deepEqual(
      messages("Of [[pending live run]] tools, [[pending live run]] carry no hint."),
      [],
    );
  });
  it("allows a report key before report.json exists (with a REPORT.md link)", () => {
    const text = "Of [[report:gap.M]] tools, [[report:gap.P]]% lack it.\nSee reports/REPORT.md.";
    assert.deepEqual(messages(text), []);
  });
  it("allows numbers on a line carrying a known snapshot stamp", () => {
    assert.deepEqual(messages(`1,562 toolkits, 56,216 tools (659 deprecated) ${SNAP}.`), []);
  });
  it("does not flag CLI flags such as --max-tools 25, in or out of code fences", () => {
    const text = [
      "Run `pnpm audit:cli fetch --max-tools 25`.",
      "```sh",
      "pnpm audit:cli fetch --toolkits gmail,slack --out fixtures/catalog/trimmed --max-tools 25 --refresh",
      "```",
    ].join("\n");
    assert.deepEqual(messages(text), []);
  });
  it("allows numbers cited to the matching report stamp", () => {
    assert.deepEqual(messages("56,216 tools [report 2026-10-01, commit abc1234].", REPORT), []);
  });
  it("keeps LLM-dependent keys as placeholders while llmStatus is not live", () => {
    assert.deepEqual(messages("[[report:gap.M]] tools, reports/REPORT.md", REPORT), []);
  });
});

describe("fail cases", () => {
  it("flags any percentage without a stamp", () => {
    assert.match(messages("About 40% of tools lack it.")[0], /unstamped number.*40%/);
  });
  it("flags a number before tools/toolkits", () => {
    assert.match(messages("We scanned 56,216 tools.")[0], /56,216 tools/);
    assert.match(messages("across 1,562 Composio toolkits")[0], /1,562 Composio toolkits/);
  });
  it("flags a number after tools/toolkits", () => {
    assert.match(messages("tools: 56216")[0], /tools: 56216/);
  });
  it("does not let a stamp on another line cover the number", () => {
    assert.equal(messages(`${SNAP}\nWe scanned 56,216 tools.`).length, 1);
  });
  it("rejects an unknown snapshot stamp", () => {
    const out = messages("56,216 tools [snapshot 2026-01-01, @composio/core 9.9.9]");
    assert.ok(out.some((m) => /unknown snapshot stamp/.test(m)));
    assert.ok(out.some((m) => /unstamped number/.test(m)));
  });
  it("rejects a report stamp when no report exists or it does not match", () => {
    assert.ok(
      messages("56,216 tools [report 2026-10-01, commit abc1234]")[0].includes("does not match"),
    );
    assert.ok(
      messages("56,216 tools [report 2026-10-01, commit fff1234]", REPORT)[0].includes(
        "does not match",
      ),
    );
  });
  it("rejects unknown placeholders and unknown report keys", () => {
    assert.match(messages("[[TBD]]")[0], /unknown placeholder/);
    assert.match(messages("[[report:made.up]] reports/REPORT.md")[0], /unknown report key/);
  });
  it("requires a reports/REPORT.md link when report keys are used", () => {
    assert.match(messages("[[report:totals.tools]]")[0], /never links reports\/REPORT\.md/);
  });
  it("flags a leftover rules-only key once report.json has it", () => {
    const out = messages("[[report:totals.tools]] (reports/REPORT.md)", REPORT);
    assert.match(out[0], /available in reports\/report\.json \(56216\)/);
  });
  it("flags a leftover LLM key once the report is live", () => {
    const live = { ...REPORT, stamp: { ...REPORT.stamp, llmStatus: "live" } };
    assert.match(messages("[[report:gap.M]] reports/REPORT.md", live)[0], /available/);
  });
});

describe("helpers + repo scan", () => {
  it("lookup walks dotted paths", () => {
    assert.equal(lookup(REPORT, "gap.N"), 7);
    assert.equal(lookup(REPORT, "gap.X"), undefined);
    assert.equal(lookup(REPORT, "perToolkit.gmail.gap"), undefined);
  });
  it("scans README, PROPOSAL and docs/**, and reads reports/report.json", () => {
    const root = mkdtempSync(path.join(tmpdir(), "stamped-"));
    try {
      mkdirSync(path.join(root, "docs", "sub"), { recursive: true });
      mkdirSync(path.join(root, "reports"));
      writeFileSync(path.join(root, "README.md"), "clean\n");
      writeFileSync(path.join(root, "PROPOSAL.md"), "[[report:totals.tools]] reports/REPORT.md\n");
      writeFileSync(path.join(root, "docs", "sub", "a.md"), "12 tools\n");
      writeFileSync(path.join(root, "docs", "ignored.txt"), "12 tools\n");
      writeFileSync(path.join(root, "reports", "report.json"), JSON.stringify(REPORT));
      assert.equal(filesToCheck(root).length, 3);
      const found = checkRepo(root).map((v) => `${v.file}:${v.line}`);
      assert.deepEqual(found.sort(), ["PROPOSAL.md:1", "docs/sub/a.md:1"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
