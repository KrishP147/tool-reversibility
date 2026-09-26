import type { Composio as ComposioClass } from "@composio/core";

/**
 * Live mode's Composio integration (plan.md §3b / §6 item 7, issue #7).
 *
 * `@composio/core` is imported dynamically (never at module load) so that
 * `INBOX_MODE=mock` (the default) never pulls it into the build/test graph
 * — see lib/live.test.ts "INBOX_MODE unset -> live code never imported" and
 * lib/mode.test.ts. Only the type is imported statically; TypeScript erases
 * type-only imports, so they run no code.
 *
 * Pinned to exactly 0.21.0 (apps/inbox/package.json) because the shape this
 * file depends on is UNVERIFIED in Composio's published docs and was
 * confirmed only by reading the 0.21.0 dist:
 *   - `session.tools({ beforeExecute, ... })` (the "modifiers" argument to
 *     `ToolRouterSession.tools()`) runs `beforeExecute({ toolSlug,
 *     toolkitSlug, sessionId, params })` BEFORE Composio executes the call;
 *     throwing from it blocks the call from ever reaching Composio.
 *   - `session.execute(slug, args)` has no modifiers parameter at all — it
 *     always skips them. That is what makes a two-step "approve" flow work:
 *     `executeApproved` below calls `session.execute` directly, deliberately
 *     bypassing the same guard that would otherwise re-block it.
 * Do not bump this version without re-reading the dist for the same shapes.
 */

export class ApprovalRequiredError extends Error {
  constructor(
    public readonly toolSlug: string,
    public readonly pendingId: string,
  ) {
    super(`Approval required for ${toolSlug} (queued as ${pendingId})`);
    this.name = "ApprovalRequiredError";
  }
}

export interface LiveSessionHandle {
  composio: ComposioClass;
  session: {
    execute: (slug: string, args: Record<string, unknown>) => Promise<unknown>;
  };
}

let sessionPromise: Promise<LiveSessionHandle> | null = null;

/**
 * Lazily creates (and caches for the life of the server process) a Composio
 * session for live mode. Throws if `COMPOSIO_API_KEY` is unset — callers
 * (executeApproved, any future agent wiring) must treat that as a live
 * failure to show as a banner, never as an unhandled crash (plan.md
 * "live mode must never block the demo").
 */
export async function getLiveSession(
  userId: string = process.env.INBOX_USER ?? "inbox-user",
): Promise<LiveSessionHandle> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const apiKey = process.env.COMPOSIO_API_KEY;
      if (!apiKey) {
        throw new Error("COMPOSIO_API_KEY is required for INBOX_MODE=live");
      }

      const { Composio } = await import("@composio/core");
      const composio = new Composio({ apiKey }) as ComposioClass;
      // No `tags`/`toolkits` filter: this session only needs a sessionId to
      // execute() explicitly-approved tool calls, not to expose a curated
      // tool list to an agent (this demo has no agent — see approvalGuard).
      const session = (await composio.create(userId, {})) as LiveSessionHandle["session"];

      return { composio, session };
    })();
  }

  return sessionPromise;
}

/** Test-only: drop the cached session so each test starts clean. */
export function __resetLiveSessionForTests(): void {
  sessionPromise = null;
}

export interface BeforeExecuteContext {
  toolSlug: string;
  toolkitSlug: string;
  sessionId: string;
  params: Record<string, unknown>;
}

/**
 * The `beforeExecute` modifier meant for `session.tools({ beforeExecute:
 * approvalGuard })` (plan.md's "intercept before execute"). There is no
 * agent driving `session.tools()` in this build (deliberate — see
 * apps/inbox/README.md and the root README's Limitations bullet on the
 * intercept being a client-side hook, not a server-side gate); this
 * function is exported and tested so the intercept itself is exercised,
 * and so it's ready to wire up the moment an agent calls tools through this
 * session. It never lets a call through: it enqueues a pending row in the
 * live store and always throws.
 */
export async function approvalGuard(context: BeforeExecuteContext): Promise<never> {
  const { insertPending } = await import("./store");

  const id = insertPending({
    slug: context.toolSlug,
    toolkitSlug: context.toolkitSlug,
    payload: context.params,
  });

  throw new ApprovalRequiredError(context.toolSlug, id);
}

export interface ExecuteApprovedResult {
  ok: boolean;
  error?: string;
  payloadHash: string;
}

/**
 * Runs an already-approved pending action for real, via `session.execute`
 * (which — per the intercept finding above — never re-triggers
 * approvalGuard), and records the outcome as one live audit-log entry.
 * Never throws: a Composio failure is recorded and returned as `{ ok:
 * false, error }` so the caller (the decide server action) can surface it
 * without crashing the page.
 */
export async function executeApproved(id: string): Promise<ExecuteApprovedResult> {
  const { getPending, insertAudit, markPendingStatus } = await import("./store");

  const row = getPending(id);
  if (!row) {
    throw new Error(`Unknown live pending action: ${id}`);
  }

  try {
    const { session } = await getLiveSession();
    const result = await session.execute(row.slug, row.payload);

    markPendingStatus(id, "approved");
    const entry = insertAudit({
      actionId: id,
      slug: row.slug,
      decision: "approve",
      payload: row.payload,
      result: safeStringify(result),
    });

    return { ok: true, payloadHash: entry.payloadHash };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const entry = insertAudit({
      actionId: id,
      slug: row.slug,
      decision: "approve",
      payload: row.payload,
      result: `error: ${message}`,
    });

    return { ok: false, error: message, payloadHash: entry.payloadHash };
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
