/**
 * Rendered preview for `kind: "send"` actions (plan.md §3b: "a rendered
 * preview for sends"). Payloads are either an email (Composio
 * GMAIL_SEND_EMAIL: recipient_email/subject/body; legacy `to` accepted) or a
 * channel message (SLACK_SEND_MESSAGE: channel/markdown_text; legacy `text`
 * accepted); anything else falls back to raw JSON so the preview never hides
 * an unrecognized shape.
 */
export function SendPreview({ payload }: { payload: Record<string, unknown> }) {
  const recipient = payload.recipient_email ?? payload.to;
  const message = payload.markdown_text ?? payload.text;
  if (typeof recipient === "string") {
    return (
      <dl data-testid="send-preview-email" className="space-y-2 text-sm">
        <div>
          <dt className="text-xs uppercase text-gray-500">To</dt>
          <dd>{recipient}</dd>
        </div>
        {typeof payload.subject === "string" && (
          <div>
            <dt className="text-xs uppercase text-gray-500">Subject</dt>
            <dd className="font-medium">{payload.subject}</dd>
          </div>
        )}
        {typeof payload.body === "string" && (
          <div>
            <dt className="text-xs uppercase text-gray-500">Body</dt>
            <dd className="whitespace-pre-wrap">{payload.body}</dd>
          </div>
        )}
      </dl>
    );
  }

  if (typeof payload.channel === "string") {
    return (
      <dl data-testid="send-preview-channel" className="space-y-2 text-sm">
        <div>
          <dt className="text-xs uppercase text-gray-500">Channel</dt>
          <dd>{payload.channel}</dd>
        </div>
        {typeof message === "string" && (
          <div>
            <dt className="text-xs uppercase text-gray-500">Message</dt>
            <dd className="whitespace-pre-wrap">{message}</dd>
          </div>
        )}
      </dl>
    );
  }

  return (
    <pre data-testid="send-preview-raw" className="whitespace-pre-wrap text-sm">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}
