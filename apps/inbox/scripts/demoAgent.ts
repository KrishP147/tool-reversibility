import path from "node:path";
import { ApprovalRequiredError, makeApprovalGuard, type BeforeExecuteContext } from "../lib/live";
import type { LivePendingRow } from "../lib/store";

/**
 * `pnpm demo:agent` (issue #25): a scripted, no-LLM "agent" that gets its
 * tools from a session with `makeApprovalGuard({ dbPath })` (issue #31,
 * D49) as the `beforeExecute` modifier, then tries to send an email. The
 * guard queues a pending row in the live store and throws
 * `ApprovalRequiredError`, so the send never runs; the row then shows up in
 * `INBOX_MODE=live pnpm --filter inbox dev`.
 *
 * Intercept shape, pinned to @composio/core 0.21.0 (read from
 * node_modules/@composio/core/dist/index.mjs; re-read before any bump):
 *   - `ToolRouterSession.tools(modifiers, requestOptions)` (dist L9896):
 *     the modifiers are the FIRST positional argument, flat —
 *     `session.tools({ beforeExecute })`, typed `SessionMetaToolOptions =
 *     ToolOptions & SessionExecuteMetaModifiers` (index.d.mts L591). A nested
 *     `session.tools({ modifiers: { beforeExecute } })` is silently ignored
 *     (no `beforeExecute` key at the top level), so the guard would never run.
 *   - It ends in `wrapToolsForToolRouter` (L1769) ->
 *     `createExecuteToolFnForToolRouter(sessionId, rawTools, modifiers)`
 *     (L1805-1813), whose execute fn calls `executeSessionTool(toolSlug,
 *     { sessionId, arguments: input }, modifiers, tool)` for ANY slug.
 *   - `executeSessionTool` (L1974-2011) calls
 *     `await modifiers.beforeExecute({ toolSlug, toolkitSlug, sessionId,
 *     params })` (L1984-1989; `toolkitSlug = tool?.toolkit?.slug ??
 *     "composio"`, `params` = the call's arguments) BEFORE the network
 *     execute (L1996); a throw there means Composio never sees the call.
 *   - That execute fn only reaches the caller through an AGENTIC provider's
 *     `wrapTools(tools, executeToolFn)` (L1771). The default
 *     `ComposioProvider` is non-agentic and drops it (L11032-11034), and
 *     non-agentic providers execute via `session.execute()`, which skips
 *     modifiers (live.ts header). So `--live` builds its own client with a
 *     minimal agentic provider instead of reusing `getLiveSession()` (whose
 *     client uses the default provider and is meant for `session.execute`).
 *
 * The default (mock) session below mirrors exactly that path with a fake
 * execute; `--live` is implemented but must only be run by a human with a
 * test account (it needs COMPOSIO_API_KEY; nothing is sent while the guard
 * is in place, but it does create a real Composio session).
 */

export const DEMO_TOOL_SLUG = "GMAIL_SEND_EMAIL";
export const DEMO_TOOLKIT_SLUG = "gmail";
/** Fixed payload; placeholder address (RFC 2606 reserved domain). */
export const DEMO_PARAMS: Record<string, unknown> = {
  recipient_email: "someone@example.com",
  subject: "Quarterly numbers",
  body: "Hi, the Q3 numbers are attached. (Sent by the tool-reversibility demo agent.)",
};

export type BeforeExecute = (context: BeforeExecuteContext) => Promise<Record<string, unknown>>;

export interface DemoTool {
  slug: string;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

/** The slice of `ToolRouterSession` this demo uses. */
export interface DemoSession {
  tools: (modifiers: { beforeExecute?: BeforeExecute }) => Promise<DemoTool[]>;
}

export type FakeExecute = (slug: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Mock session mirroring 0.21.0's `session.tools(modifiers)` ->
 * `executeSessionTool` order: `beforeExecute({ toolSlug, toolkitSlug,
 * sessionId, params })` runs first, its return value becomes the arguments,
 * and only then is `fakeExecute` (standing in for the network call at dist
 * L1996) invoked. No network, no key.
 */
export function createMockSession(
  fakeExecute: FakeExecute = async () => ({ data: {}, error: null, successful: true }),
  sessionId = "mock-session",
): DemoSession {
  return {
    async tools(modifiers) {
      const toolkitSlug = DEMO_TOOLKIT_SLUG;
      return [
        {
          slug: DEMO_TOOL_SLUG,
          async execute(args) {
            let params = args;
            if (modifiers?.beforeExecute) {
              params = await modifiers.beforeExecute({
                toolSlug: DEMO_TOOL_SLUG,
                toolkitSlug,
                sessionId,
                params,
              });
            }
            return fakeExecute(DEMO_TOOL_SLUG, params);
          },
        },
      ];
    },
  };
}

/**
 * Real Composio session for `--live`. `@composio/core` is imported
 * dynamically so nothing in the Next build graph or the mock path loads it.
 * NEVER run by agents/CI (costs nothing while the guard throws, but it talks
 * to Composio with a real key).
 */
export async function createLiveSession(
  userId: string = process.env.INBOX_USER ?? "inbox-user",
): Promise<DemoSession> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) throw new Error("COMPOSIO_API_KEY is required for --live");

  const { Composio, BaseAgenticProvider } = await import("@composio/core");
  type ExecuteToolFn = (slug: string, input: Record<string, unknown>) => Promise<unknown>;

  // Minimal agentic provider: binds the SDK's execute fn (which runs the
  // modifiers) into each tool. Tool Router sessions mostly expose meta tools,
  // so the demo slug is appended if absent — the execute fn accepts any slug
  // (dist L1805-1813), with toolkitSlug falling back to "composio".
  class DemoAgenticProvider extends BaseAgenticProvider<DemoTool[], DemoTool, unknown> {
    readonly name = "demo-agentic";
    wrapTool(tool: { slug: string }, executeTool: ExecuteToolFn): DemoTool {
      return { slug: tool.slug, execute: (args) => executeTool(tool.slug, args) };
    }
    wrapTools(tools: Array<{ slug: string }>, executeTool: ExecuteToolFn): DemoTool[] {
      const wrapped = tools.map((tool) => this.wrapTool(tool, executeTool));
      if (!wrapped.some((tool) => tool.slug === DEMO_TOOL_SLUG)) {
        wrapped.push(this.wrapTool({ slug: DEMO_TOOL_SLUG }, executeTool));
      }
      return wrapped;
    }
  }

  const composio = new Composio({ apiKey, provider: new DemoAgenticProvider() });
  const session = await composio.create(userId, { toolkits: [DEMO_TOOLKIT_SLUG] });
  return {
    tools: (modifiers) =>
      session.tools(modifiers as Parameters<typeof session.tools>[0]) as Promise<DemoTool[]>,
  };
}

export interface RunDemoOptions {
  /** Live store file, passed straight through to `makeApprovalGuard({
   * dbPath })` (issue #31, D49) — any path works, no cwd coupling. Defaults
   * to `<cwd>/.data/live.db`. */
  dbPath?: string;
  session?: DemoSession;
  /** The modifier under test; defaults to the real approvalGuard. */
  beforeExecute?: BeforeExecute;
  log?: (line: string) => void;
}

export interface RunDemoResult {
  error: ApprovalRequiredError;
  row: LivePendingRow;
  dbPath: string;
}

/** The scripted "agent": get tools with the guard, call the send tool once. */
export async function runDemo(options: RunDemoOptions = {}): Promise<RunDemoResult> {
  const log = options.log ?? (() => {});
  const dbPath = path.resolve(options.dbPath ?? path.join(process.cwd(), ".data", "live.db"));

  const session = options.session ?? createMockSession();
  const beforeExecute = options.beforeExecute ?? (makeApprovalGuard({ dbPath }) as BeforeExecute);

  // 0.21.0 shape: modifiers flat in the first argument (see header).
  const tools = await session.tools({ beforeExecute });
  const tool = tools.find((t) => t.slug === DEMO_TOOL_SLUG);
  if (!tool) throw new Error(`Session exposed no ${DEMO_TOOL_SLUG} tool`);

  log(`agent: calling ${DEMO_TOOL_SLUG} ${JSON.stringify(DEMO_PARAMS)}`);
  try {
    await tool.execute(DEMO_PARAMS);
  } catch (err) {
    if (!(err instanceof ApprovalRequiredError)) throw err;
    const { getPending } = await import("../lib/store");
    const row = getPending(err.pendingId, dbPath);
    if (!row) throw new Error(`Guard threw but no pending row ${err.pendingId} in ${dbPath}`);
    log(`guard: ${err.message}`);
    log(`store: pending row ${row.id} (${row.status}) in ${dbPath}`);
    return { error: err, row, dbPath };
  }
  throw new Error(`${DEMO_TOOL_SLUG} executed without approval — the guard did not run`);
}

function parseArgs(argv: string[]): { live: boolean; db?: string } {
  const live = argv.includes("--live");
  const i = argv.indexOf("--db");
  const db = i >= 0 ? argv[i + 1] : process.env.DEMO_DB || undefined;
  return { live, db };
}

async function main(): Promise<void> {
  const { live, db } = parseArgs(process.argv.slice(2));
  // pnpm runs this in apps/inbox; resolve a user-given path (any path works,
  // issue #31) against where they invoked pnpm (INIT_CWD) so a relative
  // `--db ./x/demo.db` means what it says.
  const dbPath = db ? path.resolve(process.env.INIT_CWD ?? process.cwd(), db) : undefined;
  const session = live ? await createLiveSession() : createMockSession();
  console.log(`demo:agent (${live ? "LIVE Composio session" : "mock session, no network"})`);
  await runDemo({ dbPath, session, log: (line) => console.log(line) });
  console.log("Next: INBOX_MODE=live pnpm --filter inbox dev  -> the proposal is in the list.");
}

if (process.argv[1] && /demoAgent\.[cm]?[tj]s$/.test(process.argv[1])) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
