import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allCommand, type AllReportDeps } from "./allCommand.js";
import { parseArgs } from "./program.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "audit-all-"));
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: []\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const ok = (output: string) => async () => ({ output, exitCode: 0 });
const fail = (output: string, exitCode: number) => async () => ({ output, exitCode });

describe("allCommand", () => {
  it("never calls fetch/classify/report and exits 2 for --live", async () => {
    const calls: string[] = [];
    const res = await allCommand(parseArgs(["all", "--live"]), {
      repoRoot: root,
      runFetch: async () => {
        calls.push("fetch");
        return { output: "fetch", exitCode: 0 };
      },
      runClassify: async () => {
        calls.push("classify");
        return { output: "classify", exitCode: 0 };
      },
      runReport: async () => {
        calls.push("report");
        return { output: "report", exitCode: 0 };
      },
      log: () => {},
    });
    expect(res.exitCode).toBe(2);
    expect(calls).toEqual([]);
  });

  it("never calls fetch/classify/report and exits 2 for --llm", async () => {
    const calls: string[] = [];
    const res = await allCommand(parseArgs(["all", "--llm"]), {
      repoRoot: root,
      runFetch: async () => {
        calls.push("fetch");
        return { output: "fetch", exitCode: 0 };
      },
      runClassify: async () => {
        calls.push("classify");
        return { output: "classify", exitCode: 0 };
      },
      runReport: async () => {
        calls.push("report");
        return { output: "report", exitCode: 0 };
      },
      log: () => {},
    });
    expect(res.exitCode).toBe(2);
    expect(calls).toEqual([]);
  });

  it("runs fetch -> classify --rules -> report in order, online", async () => {
    const calls: string[] = [];
    let classifyArgs: ReturnType<typeof parseArgs> | null = null;
    const res = await allCommand(parseArgs(["all"]), {
      repoRoot: root,
      log: () => {},
      runFetch: async () => {
        calls.push("fetch");
        return { output: "FETCH_OK", exitCode: 0 };
      },
      runClassify: async (a) => {
        calls.push("classify");
        classifyArgs = a;
        return { output: "CLASSIFY_OK", exitCode: 0 };
      },
      runReport: async (_a, d) => {
        calls.push("report");
        // online: reportCommand gets no forced outDir/csvFile, so it falls
        // back to its own default (the committed reports/ dir).
        expect(d).toEqual({});
        return { output: "REPORT_OK", exitCode: 0 };
      },
    });
    expect(calls).toEqual(["fetch", "classify", "report"]);
    expect(res.exitCode).toBe(0);
    expect(res.output.indexOf("FETCH_OK")).toBeLessThan(res.output.indexOf("CLASSIFY_OK"));
    expect(res.output.indexOf("CLASSIFY_OK")).toBeLessThan(res.output.indexOf("REPORT_OK"));
    expect(classifyArgs).toMatchObject({
      command: "classify",
      rules: true,
      llm: false,
      live: false,
      snapshot: null,
    });
  });

  it("stops at fetch's non-zero exit and never runs classify or report", async () => {
    const calls: string[] = [];
    const res = await allCommand(parseArgs(["all"]), {
      repoRoot: root,
      log: () => {},
      runFetch: fail("FETCH_FAILED", 2),
      runClassify: async () => {
        calls.push("classify");
        return { output: "", exitCode: 0 };
      },
      runReport: async () => {
        calls.push("report");
        return { output: "", exitCode: 0 };
      },
    });
    expect(res.exitCode).toBe(2);
    expect(res.output).toContain("FETCH_FAILED");
    expect(calls).toEqual([]);
  });

  it("stops at classify's non-zero exit and never runs report", async () => {
    const calls: string[] = [];
    const res = await allCommand(parseArgs(["all"]), {
      repoRoot: root,
      log: () => {},
      runFetch: ok("FETCH_OK"),
      runClassify: async () => {
        calls.push("classify");
        return { output: "CLASSIFY_FAILED", exitCode: 1 };
      },
      runReport: async () => {
        calls.push("report");
        return { output: "", exitCode: 0 };
      },
    });
    expect(res.exitCode).toBe(1);
    expect(res.output).toContain("FETCH_OK");
    expect(res.output).toContain("CLASSIFY_FAILED");
    expect(calls).toEqual(["classify"]);
  });

  it("propagates report's non-zero exit as the final result", async () => {
    const res = await allCommand(parseArgs(["all"]), {
      repoRoot: root,
      log: () => {},
      runFetch: ok("FETCH_OK"),
      runClassify: ok("CLASSIFY_OK"),
      runReport: fail("REPORT_FAILED", 1),
    });
    expect(res.exitCode).toBe(1);
    expect(res.output).toContain("REPORT_FAILED");
  });

  it("--offline never calls fetch, pins the trimmed snapshot, and writes under reports/offline", async () => {
    let fetchCalled = false;
    let classifyArgs: ReturnType<typeof parseArgs> | null = null;
    let reportDeps: AllReportDeps | null = null;
    const res = await allCommand(parseArgs(["all", "--offline"]), {
      repoRoot: root,
      log: () => {},
      runFetch: async () => {
        fetchCalled = true;
        return { output: "should not run", exitCode: 0 };
      },
      runClassify: async (a) => {
        classifyArgs = a;
        return { output: "CLASSIFY_OK", exitCode: 0 };
      },
      runReport: async (_a, d) => {
        reportDeps = d;
        return { output: "REPORT_OK", exitCode: 0 };
      },
    });
    expect(res.exitCode).toBe(0);
    expect(fetchCalled).toBe(false);
    expect(classifyArgs).toMatchObject({
      rules: true,
      llm: false,
      live: false,
      snapshot: path.join("fixtures", "catalog", "trimmed"),
    });
    const expectedOutDir = path.join(root, "reports", "offline");
    expect(reportDeps).toEqual({
      outDir: expectedOutDir,
      csvFile: path.join(expectedOutDir, "full", "tools.csv"),
    });
  });

  it("--offline --out <dir> writes reports under that dir instead of reports/offline", async () => {
    let reportDeps: AllReportDeps | null = null;
    const res = await allCommand(parseArgs(["all", "--offline", "--out", "tmp/my-out"]), {
      repoRoot: root,
      log: () => {},
      runFetch: async () => ({ output: "should not run", exitCode: 0 }),
      runClassify: ok("CLASSIFY_OK"),
      runReport: async (_a, d) => {
        reportDeps = d;
        return { output: "REPORT_OK", exitCode: 0 };
      },
    });
    expect(res.exitCode).toBe(0);
    const expectedOutDir = path.join(root, "tmp", "my-out");
    expect(reportDeps).toEqual({
      outDir: expectedOutDir,
      csvFile: path.join(expectedOutDir, "full", "tools.csv"),
    });
  });

  it("--offline respects an explicit --snapshot instead of forcing trimmed", async () => {
    let classifyArgs: ReturnType<typeof parseArgs> | null = null;
    await allCommand(parseArgs(["all", "--offline", "--snapshot", "fixtures/catalog/custom"]), {
      repoRoot: root,
      log: () => {},
      runFetch: async () => ({ output: "should not run", exitCode: 0 }),
      runClassify: async (a) => {
        classifyArgs = a;
        return { output: "CLASSIFY_OK", exitCode: 0 };
      },
      runReport: ok("REPORT_OK"),
    });
    expect(classifyArgs).toMatchObject({ snapshot: "fixtures/catalog/custom" });
  });
  it("online --out <dir> points classify and report at the fetched snapshot", async () => {
    const snaps: (string | null)[] = [];
    await allCommand(parseArgs(["all", "--out", "fixtures/catalog/mine"]), {
      repoRoot: root,
      log: () => {},
      runFetch: ok("FETCH_OK"),
      runClassify: async (a) => {
        snaps.push(a.snapshot);
        return { output: "CLASSIFY_OK", exitCode: 0 };
      },
      runReport: async (a, d) => {
        snaps.push(a.snapshot);
        expect(d).toEqual({});
        return { output: "REPORT_OK", exitCode: 0 };
      },
    });
    expect(snaps).toEqual(["fixtures/catalog/mine", "fixtures/catalog/mine"]);
  });
});
