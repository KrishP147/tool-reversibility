import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findRepoRoot } from "./repoRoot";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("findRepoRoot", () => {
  it("finds the repo root from apps/inbox itself", () => {
    const root = findRepoRoot(here);
    expect(existsSync(path.join(root, "pnpm-workspace.yaml"))).toBe(true);
    expect(path.basename(root)).not.toBe("inbox");
  });

  it("walks up through nested subdirectories", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "inbox-reporoot-"));
    try {
      writeFileSync(path.join(dir, "pnpm-workspace.yaml"), "packages: []\n");
      const nested = path.join(dir, "a", "b", "c");
      const root = findRepoRoot(nested);
      expect(root).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when no pnpm-workspace.yaml exists up the chain", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "inbox-reporoot-none-"));
    try {
      expect(() => findRepoRoot(dir)).toThrow(/no pnpm-workspace.yaml/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
