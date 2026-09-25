import { existsSync } from "node:fs";
import path from "node:path";

/**
 * The Next.js dev/build/start process runs with cwd = apps/inbox (plan.md
 * §3b, acceptance item 5), but fixtures/ and reports/ live at the repo root.
 * Walk up from a start directory until we find pnpm-workspace.yaml, which
 * marks the repo root in this monorepo.
 */
export function findRepoRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);

  while (true) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `findRepoRoot: no pnpm-workspace.yaml found walking up from ${startDir}`,
      );
    }
    dir = parent;
  }
}
