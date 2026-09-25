import { ActionList } from "./components/ActionList";
import { getInboxMode } from "../lib/mode";
import { loadPendingActions } from "../lib/pending";
import { loadReport } from "../lib/report";

// fixtures/pending and reports/report.json can change between requests
// (mock mode is meant to be re-run locally), so this is never statically
// prerendered at build.
export const dynamic = "force-dynamic";

export default function HomePage() {
  const mode = getInboxMode();
  const actions = loadPendingActions();
  const report = loadReport();

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-8">
      <div>
        <h1 className="text-2xl font-semibold">tool-reversibility inbox</h1>
        <p className="text-sm text-gray-500">mode: {mode}</p>
      </div>

      {report.stub && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Showing the bundled stub report ({report.note ?? "no real audit run yet"}). Run the
          audit pipeline (issue #5) to replace it with a real one.
        </p>
      )}

      <ActionList actions={actions} report={report} />
    </main>
  );
}
