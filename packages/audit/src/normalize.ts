/**
 * Normalize tools/toolkits from either source (SDK `getRawComposioTools`,
 * camelCase; or the REST list via `composio.getClient()`, snake_case) into
 * one snapshot shape. Public catalog metadata only (plan §4).
 */

export interface SnapshotTool {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  inputParameters: unknown;
  toolkit: { slug: string; name: string };
  version: string | null;
  isDeprecated: boolean;
  scopes: string[];
}

export interface ToolkitSummary {
  slug: string;
  name: string;
  /** `meta.tools_count` — counts non-deprecated tools only (D18). */
  toolsCount: number | null;
  categories: string[];
  isLocalToolkit: boolean;
}

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Accepts an SDK `Tool` (camelCase) or a REST tool item (snake_case). */
export function normalizeTool(raw: unknown, fallbackToolkit?: string): SnapshotTool {
  if (!isRec(raw)) throw new Error("normalizeTool: expected an object");
  const slug = str(raw.slug);
  if (!slug) throw new Error("normalizeTool: tool has no slug");

  const tk = isRec(raw.toolkit) ? raw.toolkit : {};
  const toolkitSlug = str(tk.slug) ?? fallbackToolkit ?? "unknown";
  const deprecated = isRec(raw.deprecated) ? raw.deprecated : {};
  const isDeprecated =
    raw.isDeprecated === true || raw.is_deprecated === true || deprecated.is_deprecated === true;

  return {
    slug,
    name: str(raw.name) ?? slug,
    description: str(raw.description) ?? "",
    tags: strArray(raw.tags),
    inputParameters: raw.inputParameters ?? raw.input_parameters ?? null,
    toolkit: { slug: toolkitSlug, name: str(tk.name) ?? toolkitSlug },
    version: str(raw.version),
    isDeprecated,
    scopes: strArray(raw.scopes),
  };
}

/** Accepts a REST toolkit list item (snake_case) or SDK toolkit (camelCase). */
export function normalizeToolkit(raw: unknown): ToolkitSummary {
  if (!isRec(raw)) throw new Error("normalizeToolkit: expected an object");
  const slug = str(raw.slug);
  if (!slug) throw new Error("normalizeToolkit: toolkit has no slug");
  const meta = isRec(raw.meta) ? raw.meta : {};
  const categories = Array.isArray(meta.categories)
    ? meta.categories
        .map((c) => (isRec(c) ? (str(c.id) ?? str(c.slug) ?? str(c.name)) : null))
        .filter((c): c is string => c !== null)
    : [];
  return {
    slug,
    name: str(raw.name) ?? slug,
    toolsCount: num(meta.tools_count) ?? num(meta.toolsCount),
    categories,
    isLocalToolkit: raw.is_local_toolkit === true || raw.isLocalToolkit === true,
  };
}

/** Stable ordering so snapshots diff cleanly across runs. */
export function sortTools(tools: SnapshotTool[]): SnapshotTool[] {
  return [...tools].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}
