export type DiffStatus = "added" | "removed" | "changed" | "unchanged";

export interface DiffRow {
  key: string;
  status: DiffStatus;
  before?: unknown;
  after?: unknown;
}

/** Per-key added/removed/changed diff of a fixture's "before" object against
 * its proposed payload (plan.md §3b: "a payload diff of fixture 'before' vs
 * proposed for updates"). */
export function diffPayload(
  before: Record<string, unknown> | undefined,
  proposed: Record<string, unknown>,
): DiffRow[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(proposed)]);

  return [...keys].sort().map((key) => {
    const hasBefore = !!before && Object.hasOwn(before, key);
    const hasAfter = Object.hasOwn(proposed, key);

    if (hasBefore && !hasAfter) {
      return { key, status: "removed", before: before?.[key] };
    }
    if (!hasBefore && hasAfter) {
      return { key, status: "added", after: proposed[key] };
    }

    const beforeValue = before?.[key];
    const afterValue = proposed[key];
    const changed = JSON.stringify(beforeValue) !== JSON.stringify(afterValue);
    return {
      key,
      status: changed ? "changed" : "unchanged",
      before: beforeValue,
      after: afterValue,
    };
  });
}

const STATUS_STYLES: Record<DiffStatus, string> = {
  added: "bg-green-50 text-green-800",
  removed: "bg-red-50 text-red-800",
  changed: "bg-amber-50 text-amber-800",
  unchanged: "text-gray-500",
};

function formatValue(value: unknown): string {
  if (value === undefined) return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function PayloadDiff({
  before,
  proposed,
}: {
  before?: Record<string, unknown>;
  proposed: Record<string, unknown>;
}) {
  const rows = diffPayload(before, proposed);

  return (
    <table data-testid="payload-diff" className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase text-gray-500">
          <th className="pr-4">Field</th>
          <th className="pr-4">Before</th>
          <th className="pr-4">Proposed</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} data-status={row.status} className={STATUS_STYLES[row.status]}>
            <td className="pr-4 font-mono">{row.key}</td>
            <td className="pr-4">{formatValue(row.before)}</td>
            <td className="pr-4">{formatValue(row.after)}</td>
            <td className="capitalize">{row.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
