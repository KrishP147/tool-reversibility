import type { CatalogClient } from "./client.js";
import {
  normalizeTool,
  normalizeToolkit,
  sortTools,
  type SnapshotTool,
  type ToolkitSummary,
} from "./normalize.js";
import {
  buildManifest,
  readToolkitFile,
  writeManifest,
  writeToolkitFile,
  type Manifest,
  type ToolSource,
} from "./snapshot.js";

export const MAX_CONCURRENCY = 4;
export const TOOLKIT_PAGE_SIZE = 1000;
/** `getRawComposioTools` limit; a result this long is treated as truncated. */
export const SDK_TOOL_LIMIT = 1000;
export const REST_TOOL_PAGE_SIZE = 200;
const MAX_PAGES = 500;

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  sleep?: Sleep;
  random?: () => number;
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
}

/** Walk an error and its `cause` chain (the SDK wraps APIError in its own errors). */
function* causeChain(err: unknown): Generator<Record<string, unknown>> {
  let cur: unknown = err;
  for (let depth = 0; depth < 6 && typeof cur === "object" && cur !== null; depth += 1) {
    const rec = cur as Record<string, unknown>;
    yield rec;
    cur = rec.cause;
  }
}

/** HTTP status on the error or anywhere in its cause chain. */
export function errorStatus(err: unknown): number | null {
  for (const e of causeChain(err)) {
    if (typeof e.status === "number") return e.status;
  }
  return null;
}

const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
]);
const TRANSIENT_NAMES = new Set(["APIConnectionError", "APIConnectionTimeoutError"]);

export function isRetryable(err: unknown): boolean {
  const status = errorStatus(err);
  if (status !== null) return status === 429 || status === 408 || status >= 500;
  for (const e of causeChain(err)) {
    if (typeof e.code === "string" && TRANSIENT_CODES.has(e.code)) return true;
    if (typeof e.name === "string" && TRANSIENT_NAMES.has(e.name)) return true;
  }
  return false;
}

/** Exponential backoff with jitter on 429/408/5xx and transient network errors. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 6;
  const baseMs = opts.baseMs ?? 1000;
  const maxMs = opts.maxMs ?? 60_000;
  const sleep = opts.sleep ?? realSleep;
  const random = opts.random ?? Math.random;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      const cap = Math.min(maxMs, baseMs * 2 ** attempt);
      const delay = Math.round(cap / 2 + random() * (cap / 2));
      opts.onRetry?.(attempt + 1, delay, err);
      await sleep(delay);
    }
  }
}

/** Run `worker` over `items` with at most `concurrency` in flight. */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const n = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  const lanes = Array.from({ length: n }, async () => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

async function drainPages(
  fetchPage: (
    cursor: string | undefined,
  ) => Promise<{ items: unknown[]; nextCursor: string | null }>,
): Promise<unknown[]> {
  const out: unknown[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await fetchPage(cursor);
    out.push(...res.items);
    if (!res.nextCursor || res.items.length === 0) return out;
    if (seen.has(res.nextCursor)) throw new Error(`pagination loop at cursor ${res.nextCursor}`);
    seen.add(res.nextCursor);
    cursor = res.nextCursor;
  }
  throw new Error(`pagination exceeded ${MAX_PAGES} pages`);
}

/**
 * The SDK call returns one page only. Treat it as truncated when it filled the
 * limit, or when it has fewer non-deprecated tools than `meta.tools_count`
 * (which counts non-deprecated tools only, D18).
 */
export function looksTruncated(
  tools: SnapshotTool[],
  toolkit: ToolkitSummary,
  limit: number,
): boolean {
  if (tools.length >= limit) return true;
  if (toolkit.toolsCount === null) return false;
  return tools.filter((t) => !t.isDeprecated).length < toolkit.toolsCount;
}

export interface FetchOptions {
  client: CatalogClient;
  outDir: string;
  toolkits: string[] | null;
  refresh: boolean;
  concurrency?: number;
  sdkToolLimit?: number;
  restPageSize?: number;
  retry?: RetryOptions;
  log?: (msg: string) => void;
  manifest: { sdkVersion: string; date: string; command: string };
  now?: () => Date;
}

export interface FetchResult {
  listed: number;
  fetched: string[];
  skipped: string[];
  fallbacks: string[];
  failures: { slug: string; error: string }[];
  manifest: Manifest;
}

async function listAllToolkits(
  client: CatalogClient,
  retry: RetryOptions,
): Promise<ToolkitSummary[]> {
  const items = await drainPages((cursor) =>
    withRetry(() => client.listToolkits({ cursor, limit: TOOLKIT_PAGE_SIZE }), retry),
  );
  const bySlug = new Map<string, ToolkitSummary>();
  for (const item of items) {
    const tk = normalizeToolkit(item);
    bySlug.set(tk.slug, tk);
  }
  return [...bySlug.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1));
}

export async function fetchToolkitTools(
  client: CatalogClient,
  toolkit: ToolkitSummary,
  opts: { sdkToolLimit: number; restPageSize: number; retry: RetryOptions },
): Promise<{ tools: SnapshotTool[]; source: ToolSource }> {
  const sdkRaw = await withRetry(
    () => client.getRawTools(toolkit.slug, opts.sdkToolLimit),
    opts.retry,
  );
  const sdkTools = sdkRaw.map((t) => normalizeTool(t, toolkit.slug));
  if (!looksTruncated(sdkTools, toolkit, opts.sdkToolLimit)) {
    return { tools: sortTools(sdkTools), source: "sdk" };
  }
  const restRaw = await drainPages((cursor) =>
    withRetry(
      () => client.listToolsPage({ toolkit: toolkit.slug, cursor, limit: opts.restPageSize }),
      opts.retry,
    ),
  );
  const bySlug = new Map<string, SnapshotTool>();
  for (const t of restRaw) {
    const tool = normalizeTool(t, toolkit.slug);
    bySlug.set(tool.slug, tool);
  }
  return { tools: sortTools([...bySlug.values()]), source: "rest-cursor" };
}

export function errorMessage(err: unknown): string {
  const status = errorStatus(err);
  const base = err instanceof Error ? err.message : String(err);
  return status !== null ? `${status}: ${base}` : base;
}

export async function runFetch(opts: FetchOptions): Promise<FetchResult> {
  const log = opts.log ?? (() => {});
  const retry: RetryOptions = {
    ...opts.retry,
    onRetry: (attempt, delay, err) => {
      log(`  retry ${attempt} in ${delay}ms (${errorMessage(err)})`);
      opts.retry?.onRetry?.(attempt, delay, err);
    },
  };
  const concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, opts.concurrency ?? MAX_CONCURRENCY));
  const sdkToolLimit = opts.sdkToolLimit ?? SDK_TOOL_LIMIT;
  const restPageSize = opts.restPageSize ?? REST_TOOL_PAGE_SIZE;
  const now = opts.now ?? (() => new Date());

  const failures: { slug: string; error: string }[] = [];
  let summaries: ToolkitSummary[];
  if (opts.toolkits && opts.toolkits.length > 0) {
    summaries = [];
    for (const slug of opts.toolkits) {
      try {
        const raw = await withRetry(() => opts.client.getToolkit(slug), retry);
        summaries.push(normalizeToolkit(raw));
      } catch (err) {
        failures.push({ slug, error: errorMessage(err) });
        log(`! ${slug}: ${errorMessage(err)}`);
      }
    }
  } else {
    summaries = await listAllToolkits(opts.client, retry);
  }
  log(`toolkits: ${summaries.length} (concurrency ${concurrency})`);

  const fetched: string[] = [];
  const skipped: string[] = [];
  const fallbacks: string[] = [];
  let done = 0;

  await runPool(summaries, concurrency, async (tk) => {
    if (!opts.refresh && readToolkitFile(opts.outDir, tk.slug)) {
      skipped.push(tk.slug);
      done += 1;
      return;
    }
    try {
      const { tools, source } = await fetchToolkitTools(opts.client, tk, {
        sdkToolLimit,
        restPageSize,
        retry,
      });
      writeToolkitFile(opts.outDir, {
        schemaVersion: 1,
        toolkit: tk,
        source,
        fetchedAt: now().toISOString(),
        toolCount: tools.length,
        tools,
      });
      fetched.push(tk.slug);
      if (source === "rest-cursor") fallbacks.push(tk.slug);
      done += 1;
      log(`[${done}/${summaries.length}] ${tk.slug}: ${tools.length} tools (${source})`);
    } catch (err) {
      done += 1;
      failures.push({ slug: tk.slug, error: errorMessage(err) });
      log(`! [${done}/${summaries.length}] ${tk.slug}: ${errorMessage(err)}`);
    }
  });

  failures.sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const manifest = buildManifest(opts.outDir, { ...opts.manifest, failures, now: now() });
  writeManifest(opts.outDir, manifest);

  return {
    listed: summaries.length,
    fetched: fetched.sort(),
    skipped: skipped.sort(),
    fallbacks: fallbacks.sort(),
    failures,
    manifest,
  };
}
