import { getInboxMode } from "../lib/mode";

export default function HomePage() {
  const mode = getInboxMode();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8">
      <h1 className="text-2xl font-semibold">tool-reversibility inbox (mock mode)</h1>
      <p className="text-sm text-gray-500">mode: {mode}</p>
    </main>
  );
}
