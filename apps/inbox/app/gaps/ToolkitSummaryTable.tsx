import type { ToolkitSummaryRow } from "../../lib/gaps";

/** Per-toolkit summary for the 8 Enhanced Controls apps: tools, irreversible
 * (rule class), gap (single-classifier gap) counts (issue #35). */
export function ToolkitSummaryTable({ rows }: { rows: ToolkitSummaryRow[] }) {
  return (
    <table data-testid="toolkit-summary-table" className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs uppercase text-gray-500">
          <th className="pr-4 py-1">Toolkit</th>
          <th className="pr-4 py-1">Tools</th>
          <th className="pr-4 py-1">Irreversible</th>
          <th className="py-1">Gap</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.toolkit} className="border-t border-gray-100">
            <td className="pr-4 py-2">{row.toolkit}</td>
            <td className="pr-4 py-2">{row.tools}</td>
            <td className="pr-4 py-2">{row.irreversible}</td>
            <td className="py-2">{row.gap}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
