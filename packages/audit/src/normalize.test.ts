import { describe, expect, it } from "vitest";
import { normalizeTool, normalizeToolkit, sortTools } from "./normalize.js";
import { trimTools } from "./snapshot.js";

describe("normalizeTool", () => {
  it("maps an SDK (camelCase) tool", () => {
    const t = normalizeTool({
      slug: "GMAIL_SEND_EMAIL",
      name: "Send Email",
      description: "Sends",
      tags: ["important", "openWorldHint", "createHint", 7],
      inputParameters: { type: "object" },
      toolkit: { slug: "gmail", name: "Gmail" },
      version: "20260915_00",
      isDeprecated: false,
      scopes: ["https://mail.google.com/"],
      isNoAuth: false,
    });
    expect(t).toEqual({
      slug: "GMAIL_SEND_EMAIL",
      name: "Send Email",
      description: "Sends",
      tags: ["important", "openWorldHint", "createHint"],
      inputParameters: { type: "object" },
      toolkit: { slug: "gmail", name: "Gmail" },
      version: "20260915_00",
      isDeprecated: false,
      scopes: ["https://mail.google.com/"],
    });
  });

  it("maps a REST (snake_case) tool, incl. nested deprecated flag", () => {
    const t = normalizeTool({
      slug: "SLACK_OLD",
      input_parameters: { a: 1 },
      deprecated: { is_deprecated: true },
      toolkit: { slug: "slack" },
    });
    expect(t.inputParameters).toEqual({ a: 1 });
    expect(t.isDeprecated).toBe(true);
    expect(t.name).toBe("SLACK_OLD");
    expect(t.description).toBe("");
    expect(t.tags).toEqual([]);
    expect(t.version).toBeNull();
    expect(t.toolkit).toEqual({ slug: "slack", name: "slack" });
  });

  it("uses the fallback toolkit slug and rejects junk", () => {
    expect(normalizeTool({ slug: "X_Y" }, "x").toolkit.slug).toBe("x");
    expect(() => normalizeTool(null)).toThrow();
    expect(() => normalizeTool({ name: "no slug" })).toThrow();
  });
});

describe("normalizeToolkit", () => {
  it("maps a REST list item", () => {
    expect(
      normalizeToolkit({
        slug: "gmail",
        name: "Gmail",
        is_local_toolkit: false,
        meta: { tools_count: 60, categories: [{ id: "email", name: "Email" }] },
      }),
    ).toEqual({
      slug: "gmail",
      name: "Gmail",
      toolsCount: 60,
      categories: ["email"],
      isLocalToolkit: false,
    });
  });

  it("maps an SDK toolkit (camelCase meta)", () => {
    const tk = normalizeToolkit({
      slug: "gmail",
      name: "gmail",
      isLocalToolkit: false,
      meta: { toolsCount: 60, categories: [{ slug: "email", name: "Email" }] },
    });
    expect(tk.toolsCount).toBe(60);
    expect(tk.categories).toEqual(["email"]);
  });

  it("tolerates missing meta", () => {
    expect(normalizeToolkit({ slug: "x" }).toolsCount).toBeNull();
  });
});

describe("sortTools / trimTools", () => {
  const mk = (slug: string) => normalizeTool({ slug, toolkit: { slug: "g" } });

  it("sorts by slug", () => {
    expect(sortTools([mk("B"), mk("A")]).map((t) => t.slug)).toEqual(["A", "B"]);
  });

  it("keeps pinned tools, stays sorted and hits the budget", () => {
    const all = sortTools([
      ...Array.from({ length: 40 }, (_, i) => mk(`GMAIL_FOO_${String(i).padStart(2, "0")}`)),
      mk("GMAIL_SEND_DRAFT"),
      mk("GMAIL_SEND_EMAIL"),
      mk("GMAIL_DELETE_MESSAGE"),
      mk("GMAIL_LIST_LABELS"),
    ]);
    const kept = trimTools(all, 8);
    const slugs = kept.map((t) => t.slug);
    expect(kept).toHaveLength(8);
    expect(slugs).toEqual([...slugs].sort());
    expect(slugs).toContain("GMAIL_SEND_EMAIL");
    expect(slugs).toContain("GMAIL_DELETE_MESSAGE");
    expect(slugs).toContain("GMAIL_LIST_LABELS");
  });

  it("is a no-op under budget", () => {
    const all = [mk("A"), mk("B")];
    expect(trimTools(all, 5)).toBe(all);
  });
});
