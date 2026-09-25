import type { PendingAction } from "../../lib/pending";
import { findToolReport, type Report } from "../../lib/report";
import { ReversibilityBadge } from "./ReversibilityBadge";

/**
 * List view (plan.md §3b: "toolkit logo, slug, reversibility badge, tier,
 * and the reasons from the report"). Plain <a> tags rather than next/link:
 * this is a full navigation to the detail page, not a client transition,
 * and it keeps the component renderable in RTL with no router context.
 */
export function ActionList({ actions, report }: { actions: PendingAction[]; report: Report }) {
  if (actions.length === 0) {
    return <p className="text-sm text-gray-500">No pending actions.</p>;
  }

  return (
    <ul className="divide-y divide-gray-200">
      {actions.map((action) => {
        const tool = findToolReport(report, action.slug);

        return (
          <li key={action.id}>
            <a href={`/actions/${action.id}`} className="block py-4 hover:bg-gray-50">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-mono text-sm">{action.slug}</p>
                  <p className="text-xs text-gray-500">{action.toolkit}</p>
                </div>
                <ReversibilityBadge tool={tool} />
              </div>
              {tool && (
                <p className="mt-1 text-xs text-gray-500">
                  Tier: {tool.tier} ({tool.tierSource})
                </p>
              )}
              {tool && tool.reasons.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-xs text-gray-600">
                  {tool.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
