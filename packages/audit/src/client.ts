import { Composio } from "@composio/core";

/** One page of a cursor-paginated REST listing. */
export interface Page<T = unknown> {
  items: T[];
  nextCursor: string | null;
  totalItems: number | null;
}

/**
 * The slice of Composio the fetcher needs. Tests inject a fake; production
 * wraps `@composio/core` (see createComposioCatalogClient). Items are left as
 * `unknown` and shaped by normalize.ts.
 */
export interface CatalogClient {
  /** REST `GET /toolkits` via `composio.getClient()` — the SDK's `toolkits.get({})` drops `next_cursor` (D17). */
  listToolkits(opts: { cursor?: string; limit: number }): Promise<Page>;
  /** SDK `composio.toolkits.get(slug)`. */
  getToolkit(slug: string): Promise<unknown>;
  /** SDK `composio.tools.getRawComposioTools({ toolkits: [slug], limit })` — single page, no cursor (D5, D18). */
  getRawTools(slug: string, limit: number): Promise<unknown[]>;
  /** REST `GET /tools?toolkit_slug=` with cursor — fallback when the SDK call truncates (D18). */
  listToolsPage(opts: { toolkit: string; cursor?: string; limit: number }): Promise<Page>;
}

interface RawPage {
  items?: unknown[];
  next_cursor?: string | null;
  total_items?: number | null;
}

/** Narrow view of the `@composio/client` instance returned by `getClient()`. */
interface RawClient {
  toolkits: { list(params: Record<string, unknown>): Promise<RawPage> };
  tools: { list(params: Record<string, unknown>): Promise<RawPage> };
}

function toPage(raw: RawPage): Page {
  return {
    items: raw.items ?? [],
    nextCursor: raw.next_cursor ?? null,
    totalItems: typeof raw.total_items === "number" ? raw.total_items : null,
  };
}

export function createComposioCatalogClient(apiKey: string): CatalogClient {
  const composio = new Composio({ apiKey, allowTracking: false, disableVersionCheck: true });
  const raw = composio.getClient() as unknown as RawClient;
  return {
    async listToolkits({ cursor, limit }) {
      return toPage(await raw.toolkits.list({ limit, ...(cursor ? { cursor } : {}) }));
    },
    async getToolkit(slug) {
      return composio.toolkits.get(slug);
    },
    async getRawTools(slug, limit) {
      // `limit` MUST be set: without it the SDK silently adds important=true
      // for a toolkits-only query and returns a curated subset (D18).
      return composio.tools.getRawComposioTools({ toolkits: [slug], limit });
    },
    async listToolsPage({ toolkit, cursor, limit }) {
      return toPage(
        await raw.tools.list({
          toolkit_slug: toolkit,
          limit,
          toolkit_versions: "latest",
          ...(cursor ? { cursor } : {}),
        }),
      );
    },
  };
}
