import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalRequiredError } from "./live";
import { __closeDbForTests, listPending } from "./store";
import {
  DEMO_PARAMS,
  DEMO_TOOL_SLUG,
  DEMO_TOOLKIT_SLUG,
  createMockSession,
  runDemo,
} from "../scripts/demoAgent";

// No network, no keys: the default mock session only; the real approvalGuard
// and real node:sqlite store, pointed at a temp db.
let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "demo-agent-"));
  dbPath = path.join(tmp, ".data", "live.db");
});

afterEach(() => {
  __closeDbForTests();
  rmSync(tmp, { recursive: true, force: true });
});

describe("runDemo (mock session, real approvalGuard)", () => {
  it("guard blocks the send: fake execute never called, pending row lands in the store", async () => {
    const fakeExecute = vi.fn();
    const cwd = process.cwd();

    const { error, row } = await runDemo({ dbPath, session: createMockSession(fakeExecute) });

    expect(fakeExecute).not.toHaveBeenCalled();
    expect(process.cwd()).toBe(cwd);

    expect(error).toBeInstanceOf(ApprovalRequiredError);
    expect(error.toolSlug).toBe(DEMO_TOOL_SLUG);
    expect(error.pendingId).toBe(row.id);

    expect(row).toMatchObject({
      slug: DEMO_TOOL_SLUG,
      toolkitSlug: DEMO_TOOLKIT_SLUG,
      payload: DEMO_PARAMS,
      status: "pending",
    });
    expect(listPending(dbPath)).toHaveLength(1);
  });

  it("mock session passes the 0.21.0 beforeExecute context shape", async () => {
    const fakeExecute = vi.fn();
    const beforeExecute = vi.fn(async (ctx: { params: Record<string, unknown> }) => ctx.params);
    const tools = await createMockSession(fakeExecute, "s-1").tools({ beforeExecute });
    const tool = tools[0]!;

    await tool.execute({ a: 1 });

    expect(beforeExecute).toHaveBeenCalledWith({
      toolSlug: DEMO_TOOL_SLUG,
      toolkitSlug: DEMO_TOOLKIT_SLUG,
      sessionId: "s-1",
      params: { a: 1 },
    });
    // Without a throwing guard, execute runs after beforeExecute.
    expect(fakeExecute).toHaveBeenCalledWith(DEMO_TOOL_SLUG, { a: 1 });
    expect(beforeExecute.mock.invocationCallOrder[0]!).toBeLessThan(
      fakeExecute.mock.invocationCallOrder[0]!,
    );
  });

  it("fails loudly if the send runs without the guard", async () => {
    await expect(
      runDemo({
        dbPath,
        session: createMockSession(vi.fn()),
        beforeExecute: async (c) => c.params,
      }),
    ).rejects.toThrow(/executed without approval/);
  });

  it("rejects a db path approvalGuard cannot write to", async () => {
    await expect(runDemo({ dbPath: path.join(tmp, "other.db") })).rejects.toThrow(
      /\.data\/live\.db/,
    );
  });
});
