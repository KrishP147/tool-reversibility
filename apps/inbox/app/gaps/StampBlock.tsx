import type { GapsStamp } from "../../lib/gaps";

/** Report provenance stamp: date, commit, LLM status (issue #35, plan.md
 * D36/D37 -- every Composio number needs a reproducible stamp). */
export function StampBlock({
  stamp,
  llmStatusLabel,
}: {
  stamp: GapsStamp;
  llmStatusLabel: string;
}) {
  return (
    <dl data-testid="gaps-stamp" className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
      <div>
        <dt className="inline font-medium text-gray-700">Date: </dt>
        <dd className="inline">{stamp.date}</dd>
      </div>
      <div>
        <dt className="inline font-medium text-gray-700">Commit: </dt>
        <dd className="inline font-mono">{stamp.commit.slice(0, 7)}</dd>
      </div>
      <div>
        <dt className="inline font-medium text-gray-700">LLM status: </dt>
        <dd className="inline">{llmStatusLabel}</dd>
      </div>
    </dl>
  );
}
