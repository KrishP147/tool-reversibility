import { ActionList } from "./components/ActionList";
import { ProposeForm } from "./components/ProposeForm";
import { proposeAction } from "./actions/propose";
import { getInboxMode } from "../lib/mode";
import { loadLivePendingActions } from "../lib/livePending";
import { loadPendingActions } from "../lib/pending";
import { loadReport } from "../lib/report";

// fixtures/pending, reports/report.json and (in live mode) the live store
// can all change between requests, so this is never statically prerendered
// at build.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const mode = getInboxMode();
  const fixtureActions = loadPendingActions();
  const live = await loadLivePendingActions();
  const actions = [...fixtureActions, ...live.actions];
  const report = loadReport();

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-8">
      <div>
        <h1 className="text-2xl font-semibold">tool-reversibility inbox</h1>
        <p className="text-sm text-gray-500">mode: {mode}</p>
      </div>

      {report.stub && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Showing the bundled stub report ({report.note ?? "no real audit run yet"}). Run the audit
          pipeline (issue #5) to replace it with a real one.
        </p>
      )}

      {live.error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          Live mode failed to load pending actions ({live.error}); showing fixtures only.
        </p>
      )}

      {mode === "live" && <ProposeForm propose={proposeAction} />}

      <ActionList actions={actions} report={report} />
    </main>
  );
}
