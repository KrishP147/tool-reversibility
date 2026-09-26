import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalRequiredError, makeApprovalGuard } from "./live";
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
  // Plain path, no `.data/live.db` suffix (issue #31: any path works).
  dbPath = path.join(tmp, "demo.db");
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
    expect(error.params).toEqual(DEMO_PARAMS);

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

  it("accepts a plain db path with no .data/live.db suffix", async () => {
    const { row } = await runDemo({ dbPath: path.join(tmp, "any.db") });
    expect(row.status).toBe("pending");
  });
});

describe("makeApprovalGuard dbPath (issue #31, D49)", () => {
  it("writes the pending row to dbPath, not to the default store path", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmp);
    try {
      const customDbPath = path.join(tmp, "custom.db");
      const defaultDbPath = path.join(tmp, ".data", "live.db");
      const guard = makeApprovalGuard({ dbPath: customDbPath });

      await expect(
        guard({
          toolSlug: DEMO_TOOL_SLUG,
          toolkitSlug: DEMO_TOOLKIT_SLUG,
          sessionId: "s-1",
          params: { a: 1 },
        }),
      ).rejects.toBeInstanceOf(ApprovalRequiredError);

      expect(listPending(customDbPath)).toHaveLength(1);
      expect(listPending(defaultDbPath)).toHaveLength(0);
    } finally {
      cwdSpy.mockRestore();
    }
  });
});
