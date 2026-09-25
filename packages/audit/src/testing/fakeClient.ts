import type { CatalogClient, Page } from "../client.js";

export interface FakeToolkit {
  slug: string;
  toolsCount?: number;
  tools: string[];
  deprecated?: string[];
}

export interface FakeOptions {
  /** Max tools the SDK call returns (simulates truncation). */
  sdkCap?: number;
  /** Calls to fail before succeeding, keyed by method name. */
  failures?: Partial<Record<keyof CatalogClient, unknown[]>>;
}

export function restTool(slug: string, toolkit: string, deprecated = false) {
  return {
    slug,
    name: slug,
    description: `${slug} description`,
    tags: ["important"],
    input_parameters: { type: "object" },
    toolkit: { slug: toolkit, name: toolkit },
    version: "20260915_00",
    is_deprecated: deprecated,
    scopes: [],
  };
}

function sdkTool(slug: string, toolkit: string, deprecated = false) {
  return {
    slug,
    name: slug,
    description: `${slug} description`,
    tags: ["important"],
    inputParameters: { type: "object" },
    toolkit: { slug: toolkit, name: toolkit },
    version: "20260915_00",
    isDeprecated: deprecated,
    scopes: [],
  };
}

/** In-memory CatalogClient with call counters and scripted failures. */
export function fakeClient(toolkits: FakeToolkit[], opts: FakeOptions = {}) {
  const calls: Record<keyof CatalogClient, number> = {
    listToolkits: 0,
    getToolkit: 0,
    getRawTools: 0,
    listToolsPage: 0,
  };
  const failures = { ...opts.failures };
  const maybeFail = (m: keyof CatalogClient) => {
    calls[m] += 1;
    const queue = failures[m];
    if (queue && queue.length > 0) throw queue.shift();
  };
  const byslug = new Map(toolkits.map((t) => [t.slug, t]));
  const meta = (t: FakeToolkit) => ({
    slug: t.slug,
    name: t.slug,
    meta: { tools_count: t.toolsCount ?? null, categories: [{ slug: "x" }] },
  });
  const get = (slug: string) => {
    const tk = byslug.get(slug);
    if (!tk) throw Object.assign(new Error(`no toolkit ${slug}`), { status: 404 });
    return tk;
  };
  const paginate = <T>(all: T[], cursor: string | undefined, limit: number): Page => {
    const start = cursor ? Number(cursor) : 0;
    const items = all.slice(start, start + limit);
    const next = start + limit < all.length ? String(start + limit) : null;
    return { items, nextCursor: next, totalItems: all.length };
  };
  const client: CatalogClient = {
    async listToolkits({ cursor, limit }) {
      maybeFail("listToolkits");
      return paginate(toolkits.map(meta), cursor, limit);
    },
    async getToolkit(slug) {
      maybeFail("getToolkit");
      return meta(get(slug));
    },
    async getRawTools(slug, limit) {
      maybeFail("getRawTools");
      const tk = get(slug);
      const cap = Math.min(limit, opts.sdkCap ?? Infinity);
      return tk.tools
        .slice(0, cap)
        .map((s) => sdkTool(s, slug, tk.deprecated?.includes(s) ?? false));
    },
    async listToolsPage({ toolkit, cursor, limit }) {
      maybeFail("listToolsPage");
      const tk = get(toolkit);
      const all = tk.tools.map((s) => restTool(s, toolkit, tk.deprecated?.includes(s) ?? false));
      return paginate(all, cursor, limit);
    },
  };
  return { client, calls };
}

export const noSleep = async () => {};
