"use client";

import { useState } from "react";
import type { AuditDecision } from "../../lib/audit";

export interface DecideResult {
  payloadHash: string;
  /** Set when a live-mode "approve" recorded the decision but the real
   * Composio execution failed (lib/live.ts never throws for this case) —
   * shown alongside the confirmation, not as a silent success. */
  error?: string;
}

export interface DecisionPanelProps {
  /** The payload as currently proposed by the fixture; also the seed text
   * for the edit textarea. */
  payload: Record<string, unknown>;
  /** Records the decision (server action from app/actions/[id]/actions.ts
   * in the real page; a stub in tests). */
  decide: (decision: AuditDecision, payload: unknown) => Promise<DecideResult>;
}

type Mode = "view" | "editing";
type Feedback =
  | { kind: "pending" }
  | { kind: "done"; decision: AuditDecision; hash: string; liveError?: string }
  | { kind: "error"; message: string };

/**
 * Approve / Reject / Edit (plan.md §3b). Edit opens a JSON textarea seeded
 * with the current payload; invalid JSON is rejected client-side before the
 * decision is ever recorded.
 */
export function DecisionPanel({ payload, decide }: DecisionPanelProps) {
  const [mode, setMode] = useState<Mode>("view");
  const [editText, setEditText] = useState(() => JSON.stringify(payload, null, 2));
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function submit(decision: AuditDecision, decidedPayload: unknown) {
    setFeedback({ kind: "pending" });
    try {
      const result = await decide(decision, decidedPayload);
      setFeedback({ kind: "done", decision, hash: result.payloadHash, liveError: result.error });
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to record decision.",
      });
    }
  }

  function submitEdit() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(editText);
    } catch {
      setFeedback({ kind: "error", message: "Invalid JSON: could not parse the edited payload." });
      return;
    }
    void submit("edit", parsed);
  }

  if (feedback?.kind === "done") {
    return (
      <div className="space-y-1">
        <p data-testid="decision-confirmation" className="text-sm text-green-700">
          Recorded: {feedback.decision}. Payload hash:{" "}
          <span className="font-mono">{feedback.hash}</span>
        </p>
        {feedback.liveError && (
          <p data-testid="decision-live-error" role="alert" className="text-sm text-red-700">
            Live execution failed: {feedback.liveError}
          </p>
        )}
      </div>
    );
  }

  const busy = feedback?.kind === "pending";

  return (
    <div className="space-y-3">
      {mode === "view" && (
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void submit("approve", payload)}
          >
            Approve
          </button>
          <button
            type="button"
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void submit("reject", payload)}
          >
            Reject
          </button>
          <button
            type="button"
            className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            disabled={busy}
            onClick={() => setMode("editing")}
          >
            Edit
          </button>
        </div>
      )}

      {mode === "editing" && (
        <div className="space-y-2">
          <textarea
            aria-label="Edited payload JSON"
            className="w-full rounded border border-gray-300 p-2 font-mono text-xs"
            rows={8}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              disabled={busy}
              onClick={submitEdit}
            >
              Submit edit
            </button>
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              disabled={busy}
              onClick={() => {
                setMode("view");
                setFeedback(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {feedback?.kind === "error" && (
        <p role="alert" className="text-sm text-red-700">
          {feedback.message}
        </p>
      )}
    </div>
  );
}
