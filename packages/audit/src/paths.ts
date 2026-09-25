import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Walk up from `start` until a directory containing `pnpm-workspace.yaml` is
 * found. `pnpm --filter audit start` runs with cwd=packages/audit, so every
 * repo-relative path (.env, fixtures/) must be resolved from here, never cwd.
 */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`pnpm-workspace.yaml not found above ${start}`);
    }
    dir = parent;
  }
}

/** Local-time YYYY-MM-DD (not UTC) — snapshot folders are named by it. */
export function localDate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function catalogRoot(repoRoot: string): string {
  return path.join(repoRoot, "fixtures", "catalog");
}

/**
 * Resolve the snapshot output dir. `out` may be absolute or repo-relative;
 * default is fixtures/catalog/<local date>.
 */
export function snapshotDir(repoRoot: string, out: string | null, date = localDate()): string {
  if (out) return path.isAbsolute(out) ? out : path.join(repoRoot, out);
  return path.join(catalogRoot(repoRoot), date);
}
