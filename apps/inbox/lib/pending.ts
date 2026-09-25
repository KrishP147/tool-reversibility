import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { findRepoRoot } from "./repoRoot";

export type ActionKind = "send" | "update" | "delete" | "list" | "other";

export interface PendingAction {
  id: string;
  slug: string;
  toolkit: string;
  kind: ActionKind;
  /** The payload that would be sent to Composio if approved. */
  payload: Record<string, unknown>;
  /** Prior state, for update actions that support a before/after diff. */
  before?: Record<string, unknown>;
  /** Always true: these are hand-written illustrative fixtures, not a
   * trimmed catalog snapshot (fixtures/catalog/ doesn't exist yet, issue #2
   * is unmerged). */
  illustrative: true;
  note: string;
  createdAt: string;
}

function pendingDir(repoRoot: string): string {
  return path.join(repoRoot, "fixtures", "pending");
}

/** Loads every fixtures/pending/*.json action, sorted by id for a stable
 * list order. Returns [] if the directory doesn't exist yet. */
export function loadPendingActions(
  repoRoot: string = findRepoRoot(),
): PendingAction[] {
  const dir = pendingDir(repoRoot);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf-8")) as PendingAction)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getPendingAction(
  id: string,
  repoRoot: string = findRepoRoot(),
): PendingAction | undefined {
  return loadPendingActions(repoRoot).find((action) => action.id === id);
}
