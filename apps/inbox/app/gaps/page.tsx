import { getGapsSummary } from "../../lib/gaps";
import { GapsTable } from "./GapsTable";
import { StampBlock } from "./StampBlock";
import { ToolkitSummaryTable } from "./ToolkitSummaryTable";

// reports/report.json can change between deploys (a regenerated report is a
// new commit, but the file itself is read at request time like the rest of
// the inbox's server-rendered data), so this is never statically
// prerendered at build -- and it must build with no env either way.
export const dynamic = "force-dynamic";

export default function GapsPage() {
  const summary = getGapsSummary();

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <div>
        <a href="/" className="text-sm text-blue-600 hover:underline">
          &larr; Back to inbox
        </a>
        <h1 className="mt-2 text-2xl font-semibold">Reversibility gaps</h1>
        <p className="text-sm text-gray-500">
          Where the rule/LLM classifiers call a tool irreversible but Composio&apos;s own hints
          would not flag it.
        </p>
      </div>

      {!summary.available ? (
        <p
          data-testid="gaps-no-report"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          {summary.note}
        </p>
      ) : (
        <>
          <StampBlock stamp={summary.stamp} llmStatusLabel={summary.llmStatusLabel} />

          <section>
            <h2 className="text-sm font-medium text-gray-700">Totals</h2>
            <p className="text-sm text-gray-600">
              {summary.totals.tools} tools &middot; {summary.totals.toolkits} toolkits &middot;{" "}
              {summary.totals.deprecatedExcluded} deprecated excluded
            </p>
          </section>

          <section>
            <h2 className="text-sm font-medium text-gray-700">
              Top single-classifier gaps ({summary.topGaps.length})
            </h2>
            <div className="mt-2 overflow-x-auto">
              <GapsTable rows={summary.topGaps} />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-medium text-gray-700">Per-toolkit summary</h2>
            <div className="mt-2 overflow-x-auto">
              <ToolkitSummaryTable rows={summary.perToolkit} />
            </div>
          </section>
        </>
      )}
    </main>
  );
}
