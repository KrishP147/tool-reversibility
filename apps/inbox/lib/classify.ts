import type { ToolClass, ToolReport } from "./report";

/**
 * Most-cautious-wins ordering used to pick a single badge class when the
 * rule and LLM classifiers disagree (plan.md §7 D2 treats "both say
 * irreversible" as the interesting gap; for display we never want to look
 * more permissive than either classifier thinks the tool is).
 */
const CAUTION_ORDER: ToolClass[] = [
  "irreversible",
  "compensable",
  "reversible",
  "unknown",
];

/**
 * Resolves the single reversibility class shown on a badge. Returns
 * "unknown" when there is no report entry for the tool at all.
 */
export function resolveDisplayClass(tool: ToolReport | undefined): ToolClass {
  if (!tool) return "unknown";
  if (tool.ruleClass === tool.llmClass) return tool.ruleClass;
  return (
    CAUTION_ORDER.find((c) => c === tool.ruleClass || c === tool.llmClass) ??
    "unknown"
  );
}

export const CLASS_LABELS: Record<ToolClass, string> = {
  irreversible: "Irreversible",
  compensable: "Compensable",
  reversible: "Reversible",
  unknown: "Unknown",
};

/** Tailwind classes for the reversibility badge (acceptance item 3: irreversible
 * red / compensable amber / reversible green / unknown gray). */
export const CLASS_BADGE_STYLES: Record<ToolClass, string> = {
  irreversible: "bg-red-100 text-red-800 ring-red-600/20",
  compensable: "bg-amber-100 text-amber-800 ring-amber-600/20",
  reversible: "bg-green-100 text-green-800 ring-green-600/20",
  unknown: "bg-gray-100 text-gray-800 ring-gray-600/20",
};
