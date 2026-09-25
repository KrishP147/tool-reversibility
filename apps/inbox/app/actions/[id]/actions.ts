"use server";

import { type AuditDecision, recordDecision } from "../../../lib/audit";
import { getPendingAction } from "../../../lib/pending";

const DECISIONS: readonly AuditDecision[] = ["approve", "reject", "edit"];

export interface DecideActionResult {
  payloadHash: string;
}

/**
 * Server action backing DecisionPanel on the detail page. Bound to the
 * action id (`decideOnAction.bind(null, action.id)`) before it's passed
 * down to the client component, so the client only ever supplies the
 * decision and the payload actually approved.
 */
export async function decideOnAction(
  id: string,
  decision: AuditDecision,
  payload: unknown,
): Promise<DecideActionResult> {
  const action = getPendingAction(id);
  if (!action) {
    throw new Error(`Unknown pending action: ${id}`);
  }
  if (!DECISIONS.includes(decision)) {
    throw new Error(`Unknown decision: ${String(decision)}`);
  }

  const entry = recordDecision({
    actionId: action.id,
    slug: action.slug,
    decision,
    // Only "edit" may change the payload; approve/reject hash the fixture's
    // own payload so a client can't log a hash for something else.
    payload: decision === "edit" ? payload : action.payload,
  });

  return { payloadHash: entry.payloadHash };
}
