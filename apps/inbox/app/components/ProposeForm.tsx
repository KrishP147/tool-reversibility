"use client";

import { useState } from "react";

export interface ProposeResult {
  id: string;
}

export interface ProposeFormProps {
  /** Server action from app/actions/propose.ts in the real page; a stub in
   * tests. Kept as a prop (same pattern as DecisionPanel's `decide`) so this
   * component needs no router/server context to render in RTL. */
  propose: (input: {
    slug: string;
    toolkitSlug: string;
    payload: unknown;
  }) => Promise<ProposeResult>;
}

type Feedback =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "done"; id: string }
  | { kind: "error"; message: string };

/**
 * Live mode's manual pending-item creator (plan.md §7 item 7: "No LLM agent
 * -> manual 'propose action' form creates the pending item"). Rendered only
 * when `getInboxMode() === "live"` (see app/page.tsx). Args are typed as
 * free-form JSON, matching how a tool call's `arguments` actually look.
 */
export function ProposeForm({ propose }: ProposeFormProps) {
  const [slug, setSlug] = useState("");
  const [toolkitSlug, setToolkitSlug] = useState("");
  const [argsText, setArgsText] = useState("{}");
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!slug.trim()) {
      setFeedback({ kind: "error", message: "Tool slug is required." });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(argsText);
    } catch {
      setFeedback({ kind: "error", message: "Invalid JSON in args." });
      return;
    }

    setFeedback({ kind: "pending" });
    try {
      const result = await propose({ slug: slug.trim(), toolkitSlug: toolkitSlug.trim(), payload });
      setFeedback({ kind: "done", id: result.id });
      setSlug("");
      setToolkitSlug("");
      setArgsText("{}");
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to propose the action.",
      });
    }
  }

  const busy = feedback.kind === "pending";

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="space-y-2 rounded border border-blue-200 bg-blue-50 p-3 text-sm"
    >
      <h2 className="font-medium">Propose a live action</h2>
      <p className="text-xs text-gray-600">
        No agent runs here: this form is the pending-item creator for live mode. Approve executes it
        for real, through the Composio session; Reject and Edit only log the decision.
      </p>

      <label className="block">
        <span className="text-xs text-gray-600">Tool slug</span>
        <input
          className="mt-1 w-full rounded border border-gray-300 p-1.5 font-mono text-xs"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="GMAIL_SEND_EMAIL"
          disabled={busy}
        />
      </label>

      <label className="block">
        <span className="text-xs text-gray-600">Toolkit slug</span>
        <input
          className="mt-1 w-full rounded border border-gray-300 p-1.5 font-mono text-xs"
          value={toolkitSlug}
          onChange={(e) => setToolkitSlug(e.target.value)}
          placeholder="gmail"
          disabled={busy}
        />
      </label>

      <label className="block">
        <span className="text-xs text-gray-600">Args (JSON)</span>
        <textarea
          aria-label="Args (JSON)"
          className="mt-1 w-full rounded border border-gray-300 p-1.5 font-mono text-xs"
          rows={4}
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          disabled={busy}
        />
      </label>

      <button
        type="submit"
        className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        disabled={busy}
      >
        Propose
      </button>

      {feedback.kind === "done" && (
        <p data-testid="propose-confirmation" className="text-green-700">
          Queued as <span className="font-mono">{feedback.id}</span>. Refresh to see it in the list.
        </p>
      )}
      {feedback.kind === "error" && (
        <p role="alert" className="text-red-700">
          {feedback.message}
        </p>
      )}
    </form>
  );
}
