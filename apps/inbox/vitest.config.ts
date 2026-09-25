import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Default environment stays "node" so the existing fs-based lib tests
 * (report/pending/repoRoot/mode) keep running fast with no DOM. Component
 * tests opt into jsdom per-file with a `// @vitest-environment jsdom`
 * docblock at the top of the test file (plan.md §3b UI work, issue #6).
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});
