import { CLASS_BADGE_STYLES, CLASS_LABELS, resolveDisplayClass } from "../../lib/classify";
import type { ToolReport } from "../../lib/report";

/**
 * The reversibility badge shown in the list and detail views (plan.md §3b:
 * "irreversible red, compensable amber, reversible green"). `unknown` (gray)
 * covers tools with no report entry.
 */
export function ReversibilityBadge({ tool }: { tool: ToolReport | undefined }) {
  const displayClass = resolveDisplayClass(tool);

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${CLASS_BADGE_STYLES[displayClass]}`}
    >
      {CLASS_LABELS[displayClass]}
    </span>
  );
}
