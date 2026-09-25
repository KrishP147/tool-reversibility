/** "If a compensating tool exists, show it" (plan.md §3b). Renders nothing
 * when the report has no compensating tool for this slug. */
export function CompensatingTool({ compensatingTool }: { compensatingTool?: string }) {
  if (!compensatingTool) return null;

  return (
    <p data-testid="compensating-tool" className="text-sm text-gray-700">
      Compensating tool: <span className="font-mono">{compensatingTool}</span>
    </p>
  );
}
