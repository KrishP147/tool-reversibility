"use server";

import { type AuditDecision, recordDecision } from "../../../lib/audit";
import { getPendingAction } from "../../../lib/pending";

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

  const entry = recordDecision({
    actionId: action.id,
    slug: action.slug,
    decision,
    payload,
  });

  return { payloadHash: entry.payloadHash };
}
