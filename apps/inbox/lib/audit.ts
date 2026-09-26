import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Append-only decision log (plan.md §3b: "Approve / Reject / Edit, with an
 * append-only audit log (who, when, decision, payload hash) kept as JSON in
 * mock mode"). Mock mode uses one JSONL file rather than SQLite (live mode's
 * job, issue #7).
 */
export type AuditDecision = "approve" | "reject" | "edit";

export interface AuditEntry {
  actionId: string;
  slug: string;
  decision: AuditDecision;
  who: string;
  /** ISO 8601 timestamp. */
  when: string;
  /** sha256 (hex) of the canonical JSON of the payload actually approved
   * (post-edit for decision "edit"). */
  payloadHash: string;
}

export interface RecordDecisionInput {
  actionId: string;
  slug: string;
  decision: AuditDecision;
  /** The payload actually approved: the fixture payload for approve/reject,
   * the edited payload for edit. */
  payload: unknown;
  who?: string;
  when?: string;
}

/** Deep-sorts object keys so two objects with the same data but different
 * key order hash identically. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      sorted[key] = canonicalize(input[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

/** apps/inbox/.data — the Next.js process's cwd is apps/inbox itself
 * (repoRoot.ts), so this needs no repo-root walk. Callers (and tests) may
 * inject a different directory. INBOX_AUDIT_DIR overrides this (used by
 * scripts/screenshots.ts to isolate its audit writes to a temp dir instead
 * of apps/inbox/.data). */
export function defaultAuditDir(): string {
  return process.env.INBOX_AUDIT_DIR ?? path.join(process.cwd(), ".data");
}

function auditLogPath(auditDir: string): string {
  return path.join(auditDir, "audit.jsonl");
}

/**
 * Appends one decision to the audit log, creating `<auditDir>/audit.jsonl`
 * (and the directory) lazily on first write. Never truncates: each call
 * appends a single JSONL line.
 */
export function recordDecision(
  input: RecordDecisionInput,
  auditDir: string = defaultAuditDir(),
): AuditEntry {
  const entry: AuditEntry = {
    actionId: input.actionId,
    slug: input.slug,
    decision: input.decision,
    who: input.who ?? process.env.INBOX_USER ?? "mock-user",
    when: input.when ?? new Date().toISOString(),
    payloadHash: hashPayload(input.payload),
  };

  if (!existsSync(auditDir)) mkdirSync(auditDir, { recursive: true });
  appendFileSync(auditLogPath(auditDir), `${JSON.stringify(entry)}\n`, "utf-8");

  return entry;
}

/** Reads every recorded entry, oldest first. Returns [] if the log doesn't
 * exist yet (build/start must not require it). */
export function readAuditLog(auditDir: string = defaultAuditDir()): AuditEntry[] {
  const file = auditLogPath(auditDir);
  if (!existsSync(file)) return [];

  return readFileSync(file, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AuditEntry);
}
