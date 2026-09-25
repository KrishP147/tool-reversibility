/**
 * Pure, table-tested rule-based reversibility classifier (plan §3a/D1).
 * No network, no LLM: slug verb + description + input schema only.
 */
import type { ClassifierResult, ReversibilityClass } from "./classification.js";
import { deriveHints } from "./hints.js";
import type { SnapshotTool } from "./normalize.js";

const IRREVERSIBLE_VERBS: ReadonlySet<string> = new Set([
  "SEND",
  "POST",
  "PUBLISH",
  "PAY",
  "CHARGE",
  "TRANSFER",
  "NOTIFY",
  "INVITE",
  "REPLY",
  "FORWARD",
  "MERGE",
  "DEPLOY",
  "EXECUTE",
]);

/** DELETE/PURGE/EMPTY_TRASH are irreversible only when no restore is documented. */
const DELETE_LIKE_VERBS: ReadonlySet<string> = new Set(["DELETE", "PURGE"]);

const COMPENSABLE_VERBS: ReadonlySet<string> = new Set([
  "CREATE",
  "ADD",
  "INSERT",
  "UPDATE",
  "PATCH",
  "MOVE",
  "ARCHIVE",
  "LABEL",
]);

const READ_VERBS: ReadonlySet<string> = new Set([
  "GET",
  "LIST",
  "SEARCH",
  "FETCH",
  "READ",
  "FIND",
  "DESCRIBE",
]);

interface DescKeyword {
  /** Lowercase stem to search for (catches e.g. both "irreversible" and "irreversibly"). */
  stem: string;
  /** Canonical text used in the reason string. */
  label: string;
}

/**
 * Evidence a description documents the action can be walked back. Deliberately
 * literal per plan §3a ("no trash/restore/undo mention"): a tool whose own verb
 * is EMPTY_TRASH will usually mention "trash" too and so read as compensable
 * unless its description avoids that word — a known trade-off of the heuristic.
 */
const RESTORE_KEYWORDS: DescKeyword[] = [
  { stem: "restore", label: "restore" },
  { stem: "unarchive", label: "restore" },
  { stem: "trash", label: "trash" },
  { stem: "undo", label: "undo" },
  { stem: "recycle bin", label: "trash" },
];

/** Evidence a description states the action can't be walked back. */
const IRREVERSIBLE_KEYWORDS: DescKeyword[] = [
  { stem: "irreversib", label: "irreversible" },
  { stem: "cannot be undone", label: "cannot be undone" },
  { stem: "permanently", label: "permanently" },
  { stem: "no undo", label: "no undo" },
];

function findDescKeyword(description: string, keywords: DescKeyword[]): string | null {
  const lower = description.toLowerCase();
  for (const { stem, label } of keywords) {
    if (lower.includes(stem)) return label;
  }
  return null;
}

/**
 * `slug` with `${toolkit.slug.toUpperCase()}_` stripped, split on `_`
 * (GOOGLECALENDAR_CALENDAR_LIST_DELETE -> CALENDAR, LIST, DELETE: DELETE is
 * the verb, scanned across every token, not just the first).
 */
export function tokensFromSlug(slug: string, toolkitSlug: string): string[] {
  const prefix = `${toolkitSlug.toUpperCase()}_`;
  const rest = slug.startsWith(prefix) ? slug.slice(prefix.length) : slug;
  return rest.split("_").filter(Boolean);
}

/** True when tokens contain the two-token verb EMPTY_TRASH anywhere. */
function hasEmptyTrash(tokens: string[]): boolean {
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    if (tokens[i] === "EMPTY" && tokens[i + 1] === "TRASH") return true;
  }
  return false;
}

/** True when the input schema has a top-level property that looks like an id (`id`, `*_id`). */
function hasIdParam(inputParameters: unknown): boolean {
  if (typeof inputParameters !== "object" || inputParameters === null) return false;
  const props = (inputParameters as { properties?: unknown }).properties;
  if (typeof props !== "object" || props === null) return false;
  return Object.keys(props).some((k) => /^id$|_id$/i.test(k));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Classify one tool. Precedence: readOnlyHint -> reversible; then an
 * irreversible verb (incl. conditional DELETE/PURGE/EMPTY_TRASH); then a
 * compensable verb (or update+id-param); then a read verb; else unknown.
 */
export function classifyTool(tool: SnapshotTool): ClassifierResult {
  const hints = deriveHints(tool.tags);
  const tokens = tokensFromSlug(tool.slug, tool.toolkit.slug);
  const description = tool.description;

  // 1. readOnlyHint always wins: no external effect, regardless of verb.
  if (hints.readOnlyHint) {
    return { class: "reversible", confidence: 0.9, reasons: ["hint:readOnlyHint"] };
  }

  // 2. Irreversible verbs (D2/plan §3a), scanning every token.
  for (const t of tokens) {
    if (IRREVERSIBLE_VERBS.has(t)) {
      const reasons = [`verb:${t}`];
      let confidence = 0.9;
      const descHit = findDescKeyword(description, IRREVERSIBLE_KEYWORDS);
      if (descHit) {
        reasons.push(`desc:"${descHit}"`);
        confidence = clamp01(confidence + 0.05);
      }
      // D23: createHint + openWorldHint on a send-type verb raises confidence.
      if (hints.createHint && hints.openWorldHint) {
        reasons.push("hint:createHint+openWorldHint");
        confidence = clamp01(confidence + 0.05);
      }
      return { class: "irreversible", confidence, reasons };
    }
  }

  // 2b. DELETE/PURGE/EMPTY_TRASH: irreversible unless the description documents a restore path.
  const deleteVerb = tokens.find((t) => DELETE_LIKE_VERBS.has(t));
  const emptyTrash = hasEmptyTrash(tokens);
  if (deleteVerb || emptyTrash) {
    const verbLabel = deleteVerb ?? "EMPTY_TRASH";
    const restoreHit = findDescKeyword(description, RESTORE_KEYWORDS);
    if (restoreHit) {
      return {
        class: "compensable",
        confidence: 0.7,
        reasons: [`verb:${verbLabel}`, `desc:"${restoreHit}"`],
      };
    }
    const reasons = [`verb:${verbLabel}`, "desc:no-restore-documented"];
    let confidence = 0.85;
    const descHit = findDescKeyword(description, IRREVERSIBLE_KEYWORDS);
    if (descHit) {
      reasons.push(`desc:"${descHit}"`);
      confidence = clamp01(confidence + 0.05);
    }
    if (hints.createHint && hints.openWorldHint) {
      reasons.push("hint:createHint+openWorldHint");
      confidence = clamp01(confidence + 0.05);
    }
    return { class: "irreversible", confidence, reasons };
  }

  // 3. Compensable verbs: an inverse API exists.
  for (const t of tokens) {
    if (COMPENSABLE_VERBS.has(t)) {
      return { class: "compensable", confidence: 0.75, reasons: [`verb:${t}`] };
    }
  }

  // 3b. Update semantics without a verb token (updateHint + an id-shaped param).
  if (hints.updateHint && hasIdParam(tool.inputParameters)) {
    return {
      class: "compensable",
      confidence: 0.6,
      reasons: ["hint:updateHint", "schema:id-param"],
    };
  }

  // 4. Read verbs: no external effect.
  for (const t of tokens) {
    if (READ_VERBS.has(t)) {
      return { class: "reversible", confidence: 0.8, reasons: [`verb:${t}`] };
    }
  }

  // 5. No signal.
  return { class: "unknown", confidence: 0.3, reasons: ["no-verb-or-hint-match"] };
}

export function classifyTools(tools: readonly SnapshotTool[]): Map<string, ClassifierResult> {
  const out = new Map<string, ClassifierResult>();
  for (const tool of tools) out.set(tool.slug, classifyTool(tool));
  return out;
}

export type { ReversibilityClass };
