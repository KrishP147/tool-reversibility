import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hashPayload } from "./audit";
import type { ActionKind } from "./pending";

/**
 * Live-mode storage (plan.md §7 D9: "SQLite (better-sqlite3) in live mode
 * only"). **Deviation from D9** (recorded in the issue #7 handoff): this
 * uses Node's built-in `node:sqlite` (`DatabaseSync`) instead of
 * better-sqlite3. `better-sqlite3` needs a native build step (node-gyp) that
 * is exactly the "native build painful on Windows" case the plan
 * anticipated as an acceptable fallback; `node:sqlite` ships with Node 22.5+
 * (stable in this repo's Node 22 baseline, `.nvmrc`) with zero native
 * compilation and needs no extra dependency or `pnpm.onlyBuiltDependencies`
 * entry. It is still marked experimental by Node itself (a one-line stderr
 * warning on first use) — acceptable for a live-mode-only, opt-in demo path
 * that never runs in CI or the mock build.
 *
 * This module is live-only: it must only ever be reached via a dynamic
 * `await import("./store")` gated on `getInboxMode() === "live"`, never a
 * static top-level import, so mock mode never touches `node:sqlite` (see
 * lib/live.test.ts's "never imported" test).
 */

export type LivePendingStatus = "pending" | "approved" | "rejected";

export interface LivePendingRow {
  id: string;
  slug: string;
  toolkitSlug: string;
  kind: ActionKind;
  payload: Record<string, unknown>;
  status: LivePendingStatus;
  createdAt: string;
}

export type LiveAuditDecision = "approve" | "reject" | "edit";

export interface LiveAuditRow {
  id: number;
  actionId: string;
  slug: string;
  decision: LiveAuditDecision;
  who: string;
  when: string;
  payloadHash: string;
  result?: string;
}

export interface InsertPendingInput {
  slug: string;
  toolkitSlug: string;
  payload: Record<string, unknown>;
  kind?: ActionKind;
}

export interface InsertAuditInput {
  actionId: string;
  slug: string;
  decision: LiveAuditDecision;
  payload: unknown;
  who?: string;
  when?: string;
  result?: string;
}

let db: DatabaseSync | null = null;
let dbAtPath: string | null = null;

export function defaultStorePath(): string {
  return path.join(process.cwd(), ".data", "live.db");
}

/** Opens (creating tables on first use) the live SQLite database. Cached
 * per path for the life of the process; callers passing a different path
 * (tests, mainly) transparently get a fresh handle. */
export function getDb(dbPath: string = defaultStorePath()): DatabaseSync {
  if (db && dbAtPath === dbPath) return db;

  db?.close();

  const dir = path.dirname(dbPath);
  if (dbPath !== ":memory:" && !existsSync(dir)) mkdirSync(dir, { recursive: true });

  const opened = new DatabaseSync(dbPath);
  opened.exec(`
    CREATE TABLE IF NOT EXISTS pending (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      toolkitSlug TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actionId TEXT NOT NULL,
      slug TEXT NOT NULL,
      decision TEXT NOT NULL,
      who TEXT NOT NULL,
      "when" TEXT NOT NULL,
      payloadHash TEXT NOT NULL,
      result TEXT
    );
  `);

  db = opened;
  dbAtPath = dbPath;
  return opened;
}

/** Test-only: closes and forgets the cached handle so a temp-file test can
 * clean up its db file afterwards. */
export function __closeDbForTests(): void {
  db?.close();
  db = null;
  dbAtPath = null;
}

interface PendingRowRaw {
  id: string;
  slug: string;
  toolkitSlug: string;
  kind: string;
  payload: string;
  status: string;
  createdAt: string;
}

function toPendingRow(raw: PendingRowRaw): LivePendingRow {
  return {
    id: raw.id,
    slug: raw.slug,
    toolkitSlug: raw.toolkitSlug,
    kind: raw.kind as ActionKind,
    payload: JSON.parse(raw.payload) as Record<string, unknown>,
    status: raw.status as LivePendingStatus,
    createdAt: raw.createdAt,
  };
}

/** Inserts a new live pending row (status "pending") and returns its id. */
export function insertPending(input: InsertPendingInput, dbPath?: string): string {
  const id = `live-${randomUUID()}`;
  const row: LivePendingRow = {
    id,
    slug: input.slug,
    toolkitSlug: input.toolkitSlug,
    kind: input.kind ?? "other",
    payload: input.payload,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  getDb(dbPath)
    .prepare(
      `INSERT INTO pending (id, slug, toolkitSlug, kind, payload, status, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.slug, row.toolkitSlug, row.kind, JSON.stringify(row.payload), row.status, row.createdAt);

  return id;
}

/** All pending rows, oldest first. */
export function listPending(dbPath?: string): LivePendingRow[] {
  const rows = getDb(dbPath)
    .prepare(`SELECT * FROM pending ORDER BY createdAt ASC`)
    .all() as unknown as PendingRowRaw[];
  return rows.map(toPendingRow);
}

export function getPending(id: string, dbPath?: string): LivePendingRow | undefined {
  const row = getDb(dbPath).prepare(`SELECT * FROM pending WHERE id = ?`).get(id) as
    | PendingRowRaw
    | undefined;
  return row ? toPendingRow(row) : undefined;
}

export function markPendingStatus(id: string, status: LivePendingStatus, dbPath?: string): void {
  getDb(dbPath).prepare(`UPDATE pending SET status = ? WHERE id = ?`).run(status, id);
}

export function updatePendingPayload(
  id: string,
  payload: Record<string, unknown>,
  dbPath?: string,
): void {
  getDb(dbPath)
    .prepare(`UPDATE pending SET payload = ? WHERE id = ?`)
    .run(JSON.stringify(payload), id);
}

/** Appends one entry to the live audit table. Mirrors lib/audit.ts's JSONL
 * entry shape (who/when/payloadHash) so both modes are easy to reason about
 * together; `result` is live-only (the SDK's execute response, or an error
 * string). */
export function insertAudit(input: InsertAuditInput, dbPath?: string): LiveAuditRow {
  const who = input.who ?? process.env.INBOX_USER ?? "live-user";
  const when = input.when ?? new Date().toISOString();
  const payloadHash = hashPayload(input.payload);

  const result = getDb(dbPath)
    .prepare(
      `INSERT INTO audit (actionId, slug, decision, who, "when", payloadHash, result)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.actionId, input.slug, input.decision, who, when, payloadHash, input.result ?? null);

  return {
    id: Number(result.lastInsertRowid),
    actionId: input.actionId,
    slug: input.slug,
    decision: input.decision,
    who,
    when,
    payloadHash,
    result: input.result,
  };
}

export function listAudit(dbPath?: string): LiveAuditRow[] {
  const rows = getDb(dbPath).prepare(`SELECT * FROM audit ORDER BY id ASC`).all() as unknown as Array<{
    id: number;
    actionId: string;
    slug: string;
    decision: string;
    who: string;
    when: string;
    payloadHash: string;
    result: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    actionId: row.actionId,
    slug: row.slug,
    decision: row.decision as LiveAuditDecision,
    who: row.who,
    when: row.when,
    payloadHash: row.payloadHash,
    result: row.result ?? undefined,
  }));
}
