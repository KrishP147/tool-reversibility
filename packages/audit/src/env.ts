import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Load <repoRoot>/.env into process.env if present. Existing env vars win
 * (Node's loadEnvFile does not override). Values are never logged.
 */
export function loadRepoEnv(repoRoot: string): void {
  const file = path.join(repoRoot, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

export function composioApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.COMPOSIO_API_KEY?.trim();
  return key ? key : null;
}

export function anthropicApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.ANTHROPIC_API_KEY?.trim();
  return key ? key : null;
}

export function classifierModel(env: NodeJS.ProcessEnv = process.env): string | null {
  const m = env.CLASSIFIER_MODEL?.trim();
  return m ? m : null;
}
