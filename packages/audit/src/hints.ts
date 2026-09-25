/**
 * Map a tool's raw `tags[]` (Composio's MCP-style behaviour hints, plan §3a)
 * into 7 known booleans, keeping every other tag raw. Also derives the
 * Enhanced Controls tier from those hints, since the SDK does not expose it
 * (D20/D22): the tier column is always labelled "derived".
 */

export const KNOWN_HINT_TAGS = [
  "readOnlyHint",
  "destructiveHint",
  "idempotentHint",
  "openWorldHint",
  "createHint",
  "updateHint",
  "important",
] as const;

type KnownHintTag = (typeof KNOWN_HINT_TAGS)[number];

const KNOWN_HINT_TAG_SET: ReadonlySet<string> = new Set(KNOWN_HINT_TAGS);

export interface ToolHints {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
  createHint: boolean;
  updateHint: boolean;
  important: boolean;
  /** Every tag that isn't one of the 7 known hints, kept raw (e.g. `deleteHint`, `messages`, `GraphQL`). */
  otherTags: string[];
}

function has(tags: readonly string[], tag: KnownHintTag): boolean {
  return tags.includes(tag);
}

/** Map `tags[]` to the 7 known booleans; every other tag is kept raw in `otherTags`. */
export function deriveHints(tags: readonly string[]): ToolHints {
  return {
    readOnlyHint: has(tags, "readOnlyHint"),
    destructiveHint: has(tags, "destructiveHint"),
    idempotentHint: has(tags, "idempotentHint"),
    openWorldHint: has(tags, "openWorldHint"),
    createHint: has(tags, "createHint"),
    updateHint: has(tags, "updateHint"),
    important: has(tags, "important"),
    otherTags: tags.filter((t) => !KNOWN_HINT_TAG_SET.has(t)),
  };
}

export type DerivedTier = "Read" | "Write" | "Destructive";

/** Tier is never sourced from the SDK (D20/D22) — always "derived", never "real". */
export type TierSource = "derived";

export interface TierResult {
  tier: DerivedTier;
  source: TierSource;
}

/**
 * Effective tier, since Composio's SDK does not expose the Enhanced Controls
 * tier on any tool or toolkit shape (D6/D22): destructiveHint -> Destructive,
 * else readOnlyHint -> Read, else Write. Always labelled "derived".
 */
export function deriveTier(hints: Pick<ToolHints, "destructiveHint" | "readOnlyHint">): TierResult {
  if (hints.destructiveHint) return { tier: "Destructive", source: "derived" };
  if (hints.readOnlyHint) return { tier: "Read", source: "derived" };
  return { tier: "Write", source: "derived" };
}
