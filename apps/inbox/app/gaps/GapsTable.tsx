import type { GapsTableRow } from "../../lib/gaps";

/**
 * Top-50 single-classifier gaps table (issue #35): slug, toolkit, rule
 * class, confidence, hints, derived tier and reasons. Each slug links to
 * its `/gaps/[slug]` detail view.
 */
export function GapsTable({ rows }: { rows: GapsTableRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">No single-classifier gaps in this report.</p>;
  }

  return (
    <table data-testid="gaps-table" className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs uppercase text-gray-500">
          <th className="pr-4 py-1">Slug</th>
          <th className="pr-4 py-1">Toolkit</th>
          <th className="pr-4 py-1">Rule class</th>
          <th className="pr-4 py-1">Confidence</th>
          <th className="pr-4 py-1">Hints</th>
          <th className="pr-4 py-1">Tier</th>
          <th className="py-1">Reasons</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.slug} className="border-t border-gray-100 align-top">
            <td className="pr-4 py-2 font-mono">
              <a href={`/gaps/${row.slug}`} className="text-blue-600 hover:underline">
                {row.slug}
              </a>
            </td>
            <td className="pr-4 py-2">{row.toolkit}</td>
            <td className="pr-4 py-2">{row.ruleClass}</td>
            <td className="pr-4 py-2">{Number(row.confidence.toFixed(2))}</td>
            <td className="pr-4 py-2 text-xs text-gray-600">
              {row.hints.length > 0 ? row.hints.join(", ") : "(none)"}
            </td>
            <td className="pr-4 py-2">
              {row.tier !== null ? (
                <>
                  {row.tier} <span className="text-xs text-gray-500">({row.tierSource})</span>
                </>
              ) : (
                <span title="Not in report's tools[] slice">&mdash;</span>
              )}
            </td>
            <td className="py-2 text-xs text-gray-600">{row.reasons.join("; ")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
