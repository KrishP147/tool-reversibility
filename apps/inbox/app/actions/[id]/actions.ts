"use server";

import { type AuditDecision, recordDecision } from "../../../lib/audit";
import { getInboxMode } from "../../../lib/mode";
import { getPendingAction } from "../../../lib/pending";

const DECISIONS: readonly AuditDecision[] = ["approve", "reject", "edit"];

export interface DecideActionResult {
  payloadHash: string;
  /** Set only for a live "approve" whose Composio execution failed
   * (lib/live.ts's executeApproved never throws for that case) — the
   * decision is still audited, but the UI must show this as a live error,
   * not a silent success (issue #7 acceptance: "never crash"). */
  error?: string;
}

function asPayloadObject(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

/**
 * Server action backing DecisionPanel on the detail page. Bound to the
 * action id (`decideOnAction.bind(null, action.id)`) before it's passed
 * down to the client component, so the client only ever supplies the
 * decision and the payload actually approved.
 *
 * Fixture actions (mock mode, or a fixture id in live mode) keep the
 * original JSONL audit path unchanged. A live-mode id not found in
 * fixtures falls through to the live SQLite store (dynamic import, issue
 * #7): approve executes for real via lib/live.ts's executeApproved, reject
 * marks the row rejected and audits, edit persists the new payload and
 * audits without ever executing anything.
 */
export async function decideOnAction(
  id: string,
  decision: AuditDecision,
  payload: unknown,
): Promise<DecideActionResult> {
  if (!DECISIONS.includes(decision)) {
    throw new Error(`Unknown decision: ${String(decision)}`);
  }

  const action = getPendingAction(id);
  if (action) {
    const entry = recordDecision({
      actionId: action.id,
      slug: action.slug,
      decision,
      // Only "edit" may change the payload; approve/reject hash the
      // fixture's own payload so a client can't log a hash for something
      // else.
      payload: decision === "edit" ? payload : action.payload,
    });

    return { payloadHash: entry.payloadHash };
  }

  if (getInboxMode() !== "live") {
    throw new Error(`Unknown pending action: ${id}`);
  }

  const { getPending, insertAudit, markPendingStatus, updatePendingPayload } =
    await import("../../../lib/store");
  const row = getPending(id);
  if (!row) {
    throw new Error(`Unknown pending action: ${id}`);
  }

  if (decision === "approve") {
    const { executeApproved } = await import("../../../lib/live");
    const result = await executeApproved(id);
    return { payloadHash: result.payloadHash, error: result.ok ? undefined : result.error };
  }

  if (decision === "reject") {
    const entry = insertAudit({
      actionId: id,
      slug: row.slug,
      decision: "reject",
      payload: row.payload,
    });
    markPendingStatus(id, "rejected");
    return { payloadHash: entry.payloadHash };
  }

  // decision === "edit": persist the new payload, audit it, but never
  // execute anything (plan.md §3b: Edit only logs).
  const editedPayload = asPayloadObject(payload);
  updatePendingPayload(id, editedPayload);
  const entry = insertAudit({
    actionId: id,
    slug: row.slug,
    decision: "edit",
    payload: editedPayload,
  });
  return { payloadHash: entry.payloadHash };
}
