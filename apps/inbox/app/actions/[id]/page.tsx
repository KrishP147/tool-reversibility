import { notFound } from "next/navigation";
import { CompensatingTool } from "../../components/CompensatingTool";
import { DecisionPanel } from "../../components/DecisionPanel";
import { PayloadDiff } from "../../components/PayloadDiff";
import { ReversibilityBadge } from "../../components/ReversibilityBadge";
import { SendPreview } from "../../components/SendPreview";
import { getPendingActionAny } from "../../../lib/livePending";
import { findToolReport, loadReport } from "../../../lib/report";
import { decideOnAction } from "./actions";

// Reads fixtures/pending, reports/report.json, the audit log and (in live
// mode) the live store at request time, so this route is never statically
// prerendered at build.
export const dynamic = "force-dynamic";

export default async function ActionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await getPendingActionAny(id);
  if (!found) notFound();
  const { action } = found;

  const report = loadReport();
  const tool = findToolReport(report, action.slug);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <a href="/" className="text-sm text-blue-600 hover:underline">
        &larr; Back to inbox
      </a>

      <div className="flex items-center justify-between gap-4">
        <h1 className="font-mono text-lg">{action.slug}</h1>
        <ReversibilityBadge tool={tool} />
      </div>
      <p className="text-sm text-gray-500">
        {action.toolkit} &middot; {action.kind}
        {tool && ` · tier ${tool.tier} (${tool.tierSource})`}
      </p>

      {action.kind === "update" ? (
        <PayloadDiff before={action.before} proposed={action.payload} />
      ) : action.kind === "send" ? (
        <SendPreview payload={action.payload} />
      ) : (
        <pre className="whitespace-pre-wrap rounded bg-gray-50 p-3 text-xs">
          {JSON.stringify(action.payload, null, 2)}
        </pre>
      )}

      {tool && tool.reasons.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-gray-600">
          {tool.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      <CompensatingTool compensatingTool={tool?.compensatingTool} />

      <DecisionPanel payload={action.payload} decide={decideOnAction.bind(null, action.id)} />
    </main>
  );
}
