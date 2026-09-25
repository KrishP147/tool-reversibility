import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findToolReport, loadReport, type Report } from "./report";

describe("loadReport", () => {
  it("falls back to the bundled stub when reports/report.json is absent", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "inbox-report-"));
    try {
      const report = loadReport(dir);
      expect(report.stub).toBe(true);
      expect(report.tools.length).toBeGreaterThan(0);
      expect(report.note).toMatch(/stub/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads a real report.json when present and forces stub: false", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "inbox-report-real-"));
    try {
      mkdirSync(path.join(dir, "reports"), { recursive: true });
      const real: Report = {
        stub: true, // even if the file lies, the loader must not trust it
        tools: [
          {
            slug: "GMAIL_SEND_EMAIL",
            toolkit: "gmail",
            ruleClass: "irreversible",
            llmClass: "irreversible",
            agree: true,
            hints: {},
            tier: "Write",
            tierSource: "real",
            reasons: ["real report"],
          },
        ],
      };
      writeFileSync(
        path.join(dir, "reports", "report.json"),
        JSON.stringify(real),
      );

      const report = loadReport(dir);
      expect(report.stub).toBe(false);
      expect(report.tools).toHaveLength(1);
      expect(findToolReport(report, "GMAIL_SEND_EMAIL")?.tierSource).toBe(
        "real",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("findToolReport", () => {
  it("returns undefined for an unknown slug", () => {
    const report: Report = { stub: true, tools: [] };
    expect(findToolReport(report, "NOPE")).toBeUndefined();
  });
});
