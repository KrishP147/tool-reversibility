export type InboxMode = "mock" | "live";

/**
 * Pure helper so the "mock by default, live is opt-in" rule (plan.md D7) is
 * unit-testable without booting Next.js.
 */
export function getInboxMode(env: Record<string, string | undefined> = process.env): InboxMode {
  return env.INBOX_MODE === "live" ? "live" : "mock";
}
