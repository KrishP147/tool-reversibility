import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SnapshotTool, ToolkitSummary } from "./normalize.js";

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const MANIFEST_FILE = "manifest.json";

/** How a toolkit's tools were obtained (D18). */
export type ToolSource = "sdk" | "rest-cursor";

export interface ToolkitFile {
  schemaVersion: number;
  toolkit: ToolkitSummary;
  source: ToolSource;
  fetchedAt: string;
  /** Tools in `tools`. */
  toolCount: number;
  /** Full toolkit size before `--max-tools` trimming; equals toolCount when untrimmed. */
  fullToolCount: number;
  tools: SnapshotTool[];
}

export interface ManifestToolkitEntry {
  tools: number;
  /** Full toolkit size (differs from `tools` only in a trimmed fixture). */
  fullTools: number;
  deprecated: number;
  metaToolsCount: number | null;
  source: ToolSource;
}

export interface Manifest {
  schemaVersion: number;
  sdk: { package: "@composio/core"; version: string };
  date: string;
  generatedAt: string;
  command: string;
  counts: {
    toolkits: number;
    tools: number;
    fullTools: number;
    deprecatedTools: number;
    restFallbacks: number;
  };
  failures: { slug: string; error: string }[];
  toolkits: Record<string, ManifestToolkitEntry>;
}

export function toolkitFilePath(dir: string, slug: string): string {
  return path.join(dir, `${slug}.json`);
}

export function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

function isToolkitFile(v: unknown): v is ToolkitFile {
  if (typeof v !== "object" || v === null) return false;
  const f = v as Partial<ToolkitFile>;
  return (
    f.schemaVersion === SNAPSHOT_SCHEMA_VERSION &&
    typeof f.toolkit?.slug === "string" &&
    typeof f.fullToolCount === "number" &&
    Array.isArray(f.tools)
  );
}

/** Returns null when the file is missing, unreadable or not a valid snapshot. */
export function readToolkitFile(dir: string, slug: string): ToolkitFile | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(toolkitFilePath(dir, slug), "utf8"));
    return isToolkitFile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeToolkitFile(dir: string, file: ToolkitFile): void {
  writeJsonAtomic(toolkitFilePath(dir, file.toolkit.slug), file);
}

/** Toolkit slugs that already have a snapshot file in `dir`. */
export function listSnapshotSlugs(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".json") && n !== MANIFEST_FILE && !n.startsWith("_"))
    .map((n) => n.slice(0, -".json".length))
    .sort();
}

export interface ManifestInput {
  sdkVersion: string;
  date: string;
  command: string;
  failures: { slug: string; error: string }[];
  now?: Date;
}

/** Scan every valid toolkit file in `dir` (resumed runs included) into a manifest. */
export function buildManifest(dir: string, input: ManifestInput): Manifest {
  const toolkits: Record<string, ManifestToolkitEntry> = {};
  let tools = 0;
  let fullTools = 0;
  let deprecatedTools = 0;
  let restFallbacks = 0;
  for (const slug of listSnapshotSlugs(dir)) {
    const file = readToolkitFile(dir, slug);
    if (!file) continue;
    const deprecated = file.tools.filter((t) => t.isDeprecated).length;
    toolkits[slug] = {
      tools: file.tools.length,
      fullTools: file.fullToolCount,
      deprecated,
      metaToolsCount: file.toolkit.toolsCount,
      source: file.source,
    };
    tools += file.tools.length;
    fullTools += file.fullToolCount;
    deprecatedTools += deprecated;
    if (file.source === "rest-cursor") restFallbacks += 1;
  }
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    sdk: { package: "@composio/core", version: input.sdkVersion },
    date: input.date,
    generatedAt: (input.now ?? new Date()).toISOString(),
    command: input.command,
    counts: {
      toolkits: Object.keys(toolkits).length,
      tools,
      fullTools,
      deprecatedTools,
      restFallbacks,
    },
    failures: input.failures,
    toolkits,
  };
}

export function writeManifest(dir: string, manifest: Manifest): void {
  writeJsonAtomic(path.join(dir, MANIFEST_FILE), manifest);
}

/** Slugs always kept in a trimmed fixture (the headline example, plan §1). */
const PINNED_SLUGS = new Set(["GMAIL_SEND_EMAIL"]);
/** Slug verbs always kept in a trimmed fixture (issue 3 tests need them). */
const PINNED_VERB =
  /_(SEND|DELETE|LIST|POST|CREATE|UPDATE|GET|MERGE|REPLY|FORWARD|ARCHIVE|INVITE)(_|$)/;

/**
 * Deterministically cut `tools` (already slug-sorted) to at most `max`: up to
 * half the budget goes to one tool per pinned verb, the rest is an even
 * stride over the remainder. Output stays slug-sorted.
 */
export function trimTools(tools: SnapshotTool[], max: number): SnapshotTool[] {
  if (max <= 0 || tools.length <= max) return tools;
  const keep = new Set<number>();
  const seenVerb = new Set<string>();
  const pinBudget = Math.floor(max / 2);
  tools.forEach((t, i) => {
    if (PINNED_SLUGS.has(t.slug)) keep.add(i);
  });
  tools.forEach((t, i) => {
    const m = PINNED_VERB.exec(t.slug);
    if (m && m[1] && !seenVerb.has(m[1]) && keep.size < pinBudget) {
      seenVerb.add(m[1]);
      keep.add(i);
    }
  });
  const rest = tools.map((_, i) => i).filter((i) => !keep.has(i));
  const need = max - keep.size;
  for (let k = 0; k < need; k += 1) {
    const idx = rest[Math.floor((k * rest.length) / need)];
    if (idx !== undefined) keep.add(idx);
  }
  return tools.filter((_, i) => keep.has(i));
}
