import { notFound } from "next/navigation";
import { getGapDetail } from "../../../lib/gaps";
import { GapDetail } from "./GapDetail";

// See app/gaps/page.tsx: reports/report.json is read at request time.
export const dynamic = "force-dynamic";

export default async function GapDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = getGapDetail(slug);

  if (result.status === "not-found") {
    notFound();
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <a href="/gaps" className="text-sm text-blue-600 hover:underline">
        &larr; Back to gaps
      </a>

      {result.status === "no-report" ? (
        <p
          data-testid="gaps-no-report"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          No report yet — run the audit pipeline (issue #5) to produce one.
        </p>
      ) : (
        <GapDetail detail={result.detail} />
      )}
    </main>
  );
}
