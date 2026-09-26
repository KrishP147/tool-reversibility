import type { GapDetail as GapDetailData } from "../../../lib/gaps";

function yesNo(b: boolean): string {
  return b ? "yes" : "no";
}

/**
 * `/gaps/[slug]` detail: mirrors the fields `audit:cli explain` prints
 * (plan.md D46) -- toolkit, hints, derived tier, rule class/confidence/
 * reasons, LLM status/class, gap flags -- plus the spot-check label when the
 * slug has one. Reads only report.json + fixtures/labels/spotcheck.json, no
 * CLI call (issue #35).
 */
export function GapDetail({ detail }: { detail: GapDetailData }) {
  const hintEntries = Object.entries(detail.hints);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-lg">{detail.slug}</h1>
        <p className="text-sm text-gray-500">{detail.toolkit}</p>
      </div>

      {detail.partial && (
        <p
          data-testid="gaps-partial-note"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          This slug is in the top-50 gaps table but not in the report&apos;s <code>tools[]</code>{" "}
          slice, so only the fields the gaps table itself carries are shown below.
        </p>
      )}

      <section>
        <h2 className="text-xs font-medium uppercase text-gray-500">Hints</h2>
        {hintEntries.length > 0 ? (
          <ul className="mt-1 grid grid-cols-2 gap-x-4 text-sm sm:grid-cols-3">
            {hintEntries.map(([tag, value]) => (
              <li key={tag}>
                {tag}: {yesNo(value)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">(none)</p>
        )}
      </section>

      <section>
        <h2 className="text-xs font-medium uppercase text-gray-500">Derived tier</h2>
        <p className="text-sm">
          {detail.tier !== null ? (
            <>
              {detail.tier} <span className="text-xs text-gray-500">({detail.tierSource})</span>
            </>
          ) : (
            "— (not in report's tools[] slice)"
          )}
        </p>
      </section>

      <section>
        <h2 className="text-xs font-medium uppercase text-gray-500">Rule classifier</h2>
        <p className="text-sm">
          class: {detail.ruleClass}
          {detail.ruleConfidence !== null && <> &middot; confidence: {detail.ruleConfidence}</>}
        </p>
        {detail.reasons.length > 0 && (
          <ul className="mt-1 list-disc pl-4 text-xs text-gray-600">
            {detail.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-xs font-medium uppercase text-gray-500">LLM</h2>
        <p className="text-sm">
          status: {detail.llmStatusLabel}
          {detail.llmClass !== null && <> &middot; class: {detail.llmClass}</>}
        </p>
      </section>

      <section>
        <h2 className="text-xs font-medium uppercase text-gray-500">Gap flags</h2>
        <p className="text-sm" data-testid="gap-flags">
          GAP (rules + live LLM both irreversible, no destructiveHint): {yesNo(detail.gap)}
          <br />
          single-gap (rules irreversible, no destructiveHint): {yesNo(detail.singleGap)}
        </p>
      </section>

      {detail.compensatingTool && (
        <p data-testid="compensating-tool" className="text-sm text-gray-700">
          Compensating tool: <span className="font-mono">{detail.compensatingTool}</span>
        </p>
      )}

      {detail.spotcheck && (
        <section data-testid="spotcheck">
          <h2 className="text-xs font-medium uppercase text-gray-500">Spot-check label</h2>
          <p className="text-sm">{detail.spotcheck.label}</p>
          <p className="text-xs text-gray-600">{detail.spotcheck.rationale}</p>
        </section>
      )}
    </div>
  );
}
