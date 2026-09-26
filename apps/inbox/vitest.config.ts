import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// "vite" itself isn't a direct dependency here (only transitive, via
// vitest/@vitejs/plugin-react), so its types aren't resolvable from this
// package under pnpm's strict layout — hence no `import type { Plugin }
// from "vite"`. defineConfig's own plugins array accepts this shape
// structurally.

/**
 * node:sqlite (lib/store.ts) is still experimental in Node 22, so it's
 * missing from node:module's builtinModules list Vite's own resolver
 * consults to decide what's a Node built-in — without this plugin, Vite
 * strips the "node:" prefix, tries to resolve+transform the bare specifier
 * "sqlite" as an npm package, and fails ("Failed to load url sqlite").
 * Marking it `external: true` from `resolveId` isn't enough (vite-node's
 * module runner still runs it through `loadAndTransform`), so instead this
 * rewrites the import to a tiny virtual module that reaches node:sqlite via
 * a runtime `createRequire` — a specifier Vite never tries to bundle.
 */
const VIRTUAL_NODE_SQLITE = "\0virtual:node-sqlite";
const nodeSqliteExternal = {
  name: "external-node-sqlite",
  enforce: "pre" as const,
  resolveId(source: string) {
    if (source === "node:sqlite" || source === "sqlite") return VIRTUAL_NODE_SQLITE;
    return null;
  },
  load(id: string) {
    if (id === VIRTUAL_NODE_SQLITE) {
      return (
        `import { createRequire } from "node:module";\n` +
        `const sqlite = createRequire(import.meta.url)("node:sqlite");\n` +
        `export const DatabaseSync = sqlite.DatabaseSync;\n` +
        `export const StatementSync = sqlite.StatementSync;\n` +
        `export default sqlite;\n`
      );
    }
    return null;
  },
};

/**
 * Default environment stays "node" so the existing fs-based lib tests
 * (report/pending/repoRoot/mode) keep running fast with no DOM. Component
 * tests opt into jsdom per-file with a `// @vitest-environment jsdom`
 * docblock at the top of the test file (plan.md §3b UI work, issue #6).
 */
export default defineConfig({
  plugins: [nodeSqliteExternal, react()],
  ssr: {
    external: ["node:sqlite"],
  },
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});
