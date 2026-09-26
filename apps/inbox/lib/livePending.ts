import { getInboxMode } from "./mode";
import { getPendingAction, type PendingAction } from "./pending";
import type { LivePendingRow } from "./store";

/**
 * Adapts live-mode SQLite pending rows to the same `PendingAction` shape
 * the mock-mode UI already renders (ActionList, the detail page,
 * ReversibilityBadge, ...), so issue #6's components need no changes.
 *
 * This file is safe to import statically from anywhere (page.tsx,
 * actions.ts): it only reaches `lib/store.ts` — and, through it,
 * `node:sqlite` — via a dynamic `await import("./store")`, and only after
 * checking `getInboxMode() === "live"`. When INBOX_MODE is unset/mock, none
 * of the exported functions here ever call that import.
 */

function rowToPendingAction(row: LivePendingRow): PendingAction {
  return {
    id: row.id,
    slug: row.slug,
    toolkit: row.toolkitSlug,
    kind: row.kind,
    payload: row.payload,
    illustrative: false,
    note: "Proposed through the live inbox's propose form; awaiting a decision.",
    createdAt: row.createdAt,
  };
}

export interface LivePendingResult {
  actions: PendingAction[];
  /** Set when live mode is on but loading pending rows failed (e.g. no
   * COMPOSIO_API_KEY, or the store couldn't open) — the page shows this as
   * a banner and falls back to fixtures only; it never throws. */
  error?: string;
}

/** Every live pending row still awaiting a decision, adapted for the UI.
 * Returns `{ actions: [] }` with no error when mode is mock. */
export async function loadLivePendingActions(): Promise<LivePendingResult> {
  if (getInboxMode() !== "live") return { actions: [] };

  try {
    const { listPending } = await import("./store");
    const actions = listPending()
      .filter((row) => row.status === "pending")
      .map(rowToPendingAction);
    return { actions };
  } catch (err) {
    return { actions: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export interface FoundPendingAction {
  action: PendingAction;
  source: "fixture" | "live";
}

/** Looks up a pending action by id in fixtures first, then (in live mode
 * only) the live store. Never throws — a live lookup failure is treated the
 * same as "not found" and left for the caller to 404 on. */
export async function getPendingActionAny(id: string): Promise<FoundPendingAction | undefined> {
  const fixture = getPendingAction(id);
  if (fixture) return { action: fixture, source: "fixture" };

  if (getInboxMode() !== "live") return undefined;

  try {
    const { getPending } = await import("./store");
    const row = getPending(id);
    return row ? { action: rowToPendingAction(row), source: "live" } : undefined;
  } catch {
    return undefined;
  }
}
