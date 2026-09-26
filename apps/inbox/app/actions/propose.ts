"use server";

import { revalidatePath } from "next/cache";
import { getInboxMode } from "../../lib/mode";

export interface ProposeInput {
  slug: string;
  toolkitSlug: string;
  /** Parsed JSON args from the propose form; validated to be a plain object
   * before this is called (ProposeForm parses client-side, this re-checks
   * server-side since a server action is a public endpoint). */
  payload: unknown;
}

export interface ProposeResult {
  id: string;
}

/**
 * Server action backing ProposeForm (plan.md §7 item 7: "No LLM agent ->
 * manual 'propose action' form creates the pending item"). The UI's way to
 * create a live pending row; the other is the scripted demo agent
 * (`pnpm demo:agent`, scripts/demoAgent.ts), which reaches the store via
 * `lib/live.ts`'s `approvalGuard` modifier on `session.tools()`. Inserts
 * directly into the live store; never calls Composio.
 */
export async function proposeAction(input: ProposeInput): Promise<ProposeResult> {
  if (getInboxMode() !== "live") {
    throw new Error("Propose is only available in live mode (INBOX_MODE=live).");
  }

  const slug = input.slug.trim();
  if (!slug) {
    throw new Error("Tool slug is required.");
  }

  const payload =
    input.payload !== null && typeof input.payload === "object" && !Array.isArray(input.payload)
      ? (input.payload as Record<string, unknown>)
      : {};

  const { insertPending } = await import("../../lib/store");
  const id = insertPending({
    slug,
    toolkitSlug: input.toolkitSlug.trim() || "unknown",
    payload,
  });

  revalidatePath("/");
  return { id };
}
