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

/** WATCH/DUPLICATE/SET/UNARCHIVE added for #16/D27: each has a plain inverse
 * (unwatch/discard the copy/re-set the old value/re-archive), so all four are
 * flat compensable, no description check needed. */
const COMPENSABLE_VERBS: ReadonlySet<string> = new Set([
  "CREATE",
  "ADD",
  "INSERT",
  "UPDATE",
  "PATCH",
  "MOVE",
  "ARCHIVE",
  "LABEL",
  "WATCH",
  "DUPLICATE",
  "SET",
  "UNARCHIVE",
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

/**
 * REMOVE/REVOKE (#16/D27): default compensable (an add/grant inverse exists,
 * e.g. re-add the member, re-share the link), unless the description states
 * the removal itself is permanent/irreversible (reuses IRREVERSIBLE_KEYWORDS,
 * e.g. SLACK_REVOKE_FILE_PUBLIC_SHARING). D35: a documented re-add/restore
 * path beats that keyword (D1: an inverse exists), e.g.
 * GITHUB_REMOVE_TEAM_MEMBERSHIP: "irreversible — ... re-added ... to restore".
 * Opposite of D26 on purpose: DELETE loses data, REMOVE/REVOKE loses a link.
 */
const REMOVE_REVOKE_VERBS: ReadonlySet<string> = new Set(["REMOVE", "REVOKE"]);

/**
 * Re-add/restore evidence for REMOVE/REVOKE (D35). Narrower than
 * RESTORE_KEYWORDS and positive-only: no "undo"/"trash", and "to restore" not
 * bare "restore", so "cannot be undone"/"cannot be restored" never count.
 */
const REGRANT_KEYWORDS: DescKeyword[] = [
  { stem: "to restore", label: "restore" },
  { stem: "re-add", label: "re-add" },
  { stem: "re-grant", label: "re-grant" },
  { stem: "re-share", label: "re-share" },
];

/**
 * ABORT/CANCEL (#16/D27): stopping something not yet started is compensable
 * (nothing external happened yet — just retry it later); stopping something
 * already in flight is irreversible when it can't be resumed (e.g.
 * GITHUB_ABORT_REPOSITORY_MIGRATION: "queued or in progress" / "ongoing
 * migration operation" — the migration can't be picked back up). Decided via
 * the description; default (no in-flight signal found) is compensable.
 */
const ABORT_CANCEL_VERBS: ReadonlySet<string> = new Set(["ABORT", "CANCEL"]);

/** Evidence a description shows the stopped operation was already in flight. */
const INFLIGHT_KEYWORDS: DescKeyword[] = [
  { stem: "in progress", label: "in progress" },
  { stem: "in-flight", label: "in-flight" },
  { stem: "ongoing", label: "ongoing" },
  { stem: "already running", label: "already running" },
  { stem: "underway", label: "underway" },
  { stem: "cannot be resumed", label: "cannot be resumed" },
  { stem: "can't be resumed", label: "cannot be resumed" },
];

/**
 * Tokens after which a later SEND/POST token is a noun, not a verb (#16/D27):
 * GMAIL_PATCH_SEND_AS patches a "send-as" alias, it doesn't send anything;
 * the real verb is the one before it. Scoped to SEND/POST only — those are
 * the two irreversible verbs that also double as common noun phrases
 * ("send-as", "post message" as a resource) in these slugs.
 */
const NOUN_PRECEDING_VERBS: ReadonlySet<string> = new Set([
  "PATCH",
  "UPDATE",
  "GET",
  "LIST",
  "CREATE",
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
  { stem: "no recovery", label: "no recovery" },
  { stem: "bypassing trash", label: "bypassing trash" },
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

/**
 * Mask SEND/POST tokens that are really nouns (#16/D27), so later tiers can
 * find the real verb instead: a SEND/POST that follows a NOUN_PRECEDING_VERBS
 * token anywhere earlier in the slug is masked (GMAIL_PATCH_SEND_AS -> PATCH
 * wins). SEND specifically is also masked whenever the slug contains UPLOAD,
 * regardless of position: NOTION_SEND_FILE_UPLOAD "sends" bytes to a file
 * upload object created by an earlier call and deletable/replaceable
 * afterward — it finishes a create/upload flow rather than delivering a
 * message externally, so it's routed to the updateHint+id-param compensable
 * rule (tier 3b) instead of the SEND verb. This is deliberately narrow (SEND
 * only, paired with UPLOAD only) rather than a blanket "*_UPLOAD" rule, since
 * NOTION_SEND_FILE_UPLOAD is the only tool in the fixture shaped like this;
 * see the matching test in rules.test.ts.
 */
function maskNounSendPost(tokens: string[]): string[] {
  let sawPrecedingVerb = false;
  const hasUpload = tokens.includes("UPLOAD");
  return tokens.map((t) => {
    if (NOUN_PRECEDING_VERBS.has(t)) sawPrecedingVerb = true;
    if ((t === "SEND" || t === "POST") && (sawPrecedingVerb || (t === "SEND" && hasUpload))) {
      return `${t}#noun`;
    }
    return t;
  });
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
 * irreversible verb (incl. conditional DELETE/PURGE/EMPTY_TRASH); then
 * REMOVE/REVOKE (conditional) and ABORT/CANCEL (conditional, #16/D27); then a
 * compensable verb (or update+id-param); then a read verb; else unknown.
 */
export function classifyTool(tool: SnapshotTool): ClassifierResult {
  const hints = deriveHints(tool.tags);
  const tokens = maskNounSendPost(tokensFromSlug(tool.slug, tool.toolkit.slug));
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
    // An explicit no-way-back statement beats a restore keyword ("cannot be undone"
    // contains "undo"; "bypassing Trash with no recovery" contains "trash").
    const irreversibleHit = findDescKeyword(description, IRREVERSIBLE_KEYWORDS);
    const restoreHit = irreversibleHit ? null : findDescKeyword(description, RESTORE_KEYWORDS);
    if (restoreHit) {
      return {
        class: "compensable",
        confidence: 0.7,
        reasons: [`verb:${verbLabel}`, `desc:"${restoreHit}"`],
      };
    }
    const reasons = [`verb:${verbLabel}`, "desc:no-restore-documented"];
    let confidence = 0.85;
    if (irreversibleHit) {
      reasons.push(`desc:"${irreversibleHit}"`);
      confidence = clamp01(confidence + 0.05);
    }
    if (hints.createHint && hints.openWorldHint) {
      reasons.push("hint:createHint+openWorldHint");
      confidence = clamp01(confidence + 0.05);
    }
    return { class: "irreversible", confidence, reasons };
  }

  // 2c. REMOVE/REVOKE: compensable by default (an add/grant inverse exists),
  // unless the description states the removal is permanent/irreversible.
  for (const t of tokens) {
    if (REMOVE_REVOKE_VERBS.has(t)) {
      const irreversibleHit = findDescKeyword(description, IRREVERSIBLE_KEYWORDS);
      const regrantHit = findDescKeyword(description, REGRANT_KEYWORDS);
      if (irreversibleHit && !regrantHit) {
        return {
          class: "irreversible",
          confidence: 0.85,
          reasons: [`verb:${t}`, `desc:"${irreversibleHit}"`],
        };
      }
      if (regrantHit) {
        // D35: documented re-add/restore path wins over "irreversible" text.
        return {
          class: "compensable",
          confidence: irreversibleHit ? 0.6 : 0.75,
          reasons: [`verb:${t}`, `desc:"${regrantHit}"`],
        };
      }
      return { class: "compensable", confidence: 0.75, reasons: [`verb:${t}`] };
    }
  }

  // 2d. ABORT/CANCEL: irreversible only when the description shows the
  // stopped operation was already in flight and can't be resumed; otherwise
  // compensable (nothing external happened yet).
  for (const t of tokens) {
    if (ABORT_CANCEL_VERBS.has(t)) {
      const irreversibleHit = findDescKeyword(description, IRREVERSIBLE_KEYWORDS);
      const inflightHit = irreversibleHit ? null : findDescKeyword(description, INFLIGHT_KEYWORDS);
      const hit = irreversibleHit ?? inflightHit;
      if (hit) {
        return {
          class: "irreversible",
          confidence: 0.8,
          reasons: [`verb:${t}`, `desc:"${hit}"`],
        };
      }
      return {
        class: "compensable",
        confidence: 0.6,
        reasons: [`verb:${t}`, "desc:no-inflight-signal"],
      };
    }
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
