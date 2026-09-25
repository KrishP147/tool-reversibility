import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ReversibilityClass } from "./classification.js";
import { findRepoRoot } from "./paths.js";
import type { SnapshotTool } from "./normalize.js";
import { classifyTool, classifyTools, tokensFromSlug } from "./rules.js";

const TOOLKITS = ["gmail", "slack", "googlecalendar", "notion", "github"] as const;

function loadAllFixtureTools(): SnapshotTool[] {
  const repoRoot = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
  const tools: SnapshotTool[] = [];
  for (const toolkit of TOOLKITS) {
    const file = path.join(repoRoot, "fixtures", "catalog", "trimmed", `${toolkit}.json`);
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { tools: SnapshotTool[] };
    tools.push(...parsed.tools);
  }
  return tools;
}

const ALL_TOOLS = loadAllFixtureTools();
const BY_SLUG = new Map(ALL_TOOLS.map((t) => [t.slug, t]));

function fixture(slug: string): SnapshotTool {
  const t = BY_SLUG.get(slug);
  if (!t) throw new Error(`fixture missing ${slug} (loaded ${ALL_TOOLS.length} tools)`);
  return t;
}

/** Build a synthetic SnapshotTool for slug/description/tag/schema edge cases not in the fixture. */
function synthTool(overrides: {
  slug: string;
  toolkitSlug: string;
  description?: string;
  tags?: string[];
  inputParameters?: unknown;
}): SnapshotTool {
  return {
    slug: overrides.slug,
    name: overrides.slug,
    description: overrides.description ?? "",
    tags: overrides.tags ?? [],
    inputParameters: overrides.inputParameters ?? null,
    toolkit: { slug: overrides.toolkitSlug, name: overrides.toolkitSlug },
    version: null,
    isDeprecated: false,
    scopes: [],
  };
}

function expectValid(result: { class: ReversibilityClass; confidence: number; reasons: string[] }) {
  expect(["reversible", "compensable", "irreversible", "unknown"]).toContain(result.class);
  expect(result.confidence).toBeGreaterThanOrEqual(0);
  expect(result.confidence).toBeLessThanOrEqual(1);
  expect(result.reasons.length).toBeGreaterThanOrEqual(1);
}

describe("tokensFromSlug", () => {
  it("strips the TOOLKIT_ prefix and splits on _", () => {
    expect(tokensFromSlug("GMAIL_SEND_EMAIL", "gmail")).toEqual(["SEND", "EMAIL"]);
  });

  it("scans every token, not just the first (GOOGLECALENDAR_CALENDAR_LIST_DELETE)", () => {
    expect(tokensFromSlug("GOOGLECALENDAR_CALENDAR_LIST_DELETE", "googlecalendar")).toEqual([
      "CALENDAR",
      "LIST",
      "DELETE",
    ]);
  });

  it("falls back to splitting the whole slug when the prefix doesn't match", () => {
    expect(tokensFromSlug("WEIRD_SLUG", "gmail")).toEqual(["WEIRD", "SLUG"]);
  });
});

describe("classifyTool: fixture tools with a specified class (plan §3a / issue #3)", () => {
  const cases: [slug: string, expected: ReversibilityClass, why: string][] = [
    ["GMAIL_SEND_EMAIL", "irreversible", "SEND verb; description says irreversible; D23 hints"],
    ["GMAIL_DELETE_LABEL", "irreversible", "DELETE, description documents no restore"],
    ["SLACK_DELETE_CANVAS", "irreversible", "DELETE, description says permanently/irreversibly"],
    ["GOOGLECALENDAR_ACL_DELETE", "irreversible", "DELETE, no restore documented"],
    [
      "GOOGLECALENDAR_CALENDAR_LIST_DELETE",
      "irreversible",
      "DELETE is the verb, despite LIST token",
    ],
    ["GMAIL_LIST_MESSAGES", "reversible", "readOnlyHint + LIST verb"],
    ["SLACK_LIST_ALL_USERS", "reversible", "readOnlyHint + LIST verb"],
    ["SLACK_CHAT_POST_MESSAGE", "irreversible", "POST verb"],
    ["GMAIL_FORWARD_MESSAGE", "irreversible", "FORWARD verb"],
    ["GMAIL_REPLY_TO_THREAD", "irreversible", "REPLY verb"],
    ["GITHUB_MERGE_A_BRANCH", "irreversible", "MERGE verb"],
    ["SLACK_INVITE_USERS_TO_A_SLACK_CHANNEL", "irreversible", "INVITE verb"],
    ["NOTION_ARCHIVE_NOTION_PAGE", "compensable", "ARCHIVE verb"],
    ["GMAIL_ADD_LABEL_TO_EMAIL", "compensable", "ADD verb"],
    ["NOTION_MOVE_PAGE", "compensable", "MOVE verb"],
    ["GOOGLECALENDAR_CREATE_EVENT", "compensable", "CREATE verb"],
    ["NOTION_CREATE_VIEW_QUERY", "reversible", "readOnlyHint overrides the CREATE verb"],
  ];

  it.each(cases)("%s -> %s (%s)", (slug, expected) => {
    const result = classifyTool(fixture(slug));
    expect(result.class).toBe(expected);
    expectValid(result);
  });

  it("GMAIL_SEND_EMAIL cites verb, description and hint evidence, confidence near 1", () => {
    const result = classifyTool(fixture("GMAIL_SEND_EMAIL"));
    expect(result.reasons).toContain("verb:SEND");
    expect(result.reasons).toContain('desc:"irreversible"');
    expect(result.reasons).toContain("hint:createHint+openWorldHint");
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("NOTION_CREATE_VIEW_QUERY's reason names the readOnlyHint evidence", () => {
    const result = classifyTool(fixture("NOTION_CREATE_VIEW_QUERY"));
    expect(result.reasons).toEqual(["hint:readOnlyHint"]);
  });

  it("GOOGLECALENDAR_CALENDAR_LIST_DELETE names DELETE, not LIST, as the verb", () => {
    const result = classifyTool(fixture("GOOGLECALENDAR_CALENDAR_LIST_DELETE"));
    expect(result.reasons.some((r) => r === "verb:DELETE")).toBe(true);
    expect(result.reasons.some((r) => r === "verb:LIST")).toBe(false);
  });

  it("GMAIL_DELETE_LABEL's reason documents the absence of a restore path", () => {
    const result = classifyTool(fixture("GMAIL_DELETE_LABEL"));
    expect(result.reasons).toContain("verb:DELETE");
    expect(result.reasons).toContain("desc:no-restore-documented");
  });
});

describe("classifyTool: synthetic edge cases", () => {
  it("a DELETE tool whose description mentions trash is compensable, not irreversible", () => {
    const tool = synthTool({
      slug: "TESTKIT_DELETE_WIDGET",
      toolkitSlug: "testkit",
      description:
        "Deletes a widget. Deleted widgets are moved to the trash and can be restored within 30 days.",
      tags: ["destructiveHint"],
    });
    const result = classifyTool(tool);
    expect(result.class).toBe("compensable");
    expect(result.reasons.some((r) => r.startsWith("verb:DELETE"))).toBe(true);
    expect(result.reasons.some((r) => r.startsWith('desc:"'))).toBe(true);
    expectValid(result);
  });

  it("a DELETE tool documenting undo is compensable", () => {
    const tool = synthTool({
      slug: "TESTKIT_DELETE_ITEM",
      toolkitSlug: "testkit",
      description: "Deletes an item. This action can be undone within 24 hours.",
    });
    expect(classifyTool(tool).class).toBe("compensable");
  });

  it("PURGE with no restore path is irreversible", () => {
    const tool = synthTool({
      slug: "TESTKIT_PURGE_CACHE",
      toolkitSlug: "testkit",
      description: "Purges the cache.",
    });
    const result = classifyTool(tool);
    expect(result.class).toBe("irreversible");
    expect(result.reasons).toContain("verb:PURGE");
  });

  it("EMPTY_TRASH with no restore path is irreversible", () => {
    const tool = synthTool({
      slug: "GMAIL_EMPTY_TRASH",
      toolkitSlug: "gmail",
      description:
        "Permanently removes every message queued for deletion; there is no way to get them back.",
    });
    const result = classifyTool(tool);
    expect(result.class).toBe("irreversible");
    expect(result.reasons).toContain("verb:EMPTY_TRASH");
  });

  it("a slug with no recognizable verb and no hints is unknown", () => {
    const tool = synthTool({ slug: "TESTKIT_FOO_BAR", toolkitSlug: "testkit" });
    const result = classifyTool(tool);
    expect(result.class).toBe("unknown");
    expectValid(result);
  });

  it("readOnlyHint wins even when a compensable verb is also present", () => {
    const tool = synthTool({
      slug: "TESTKIT_CREATE_REPORT",
      toolkitSlug: "testkit",
      tags: ["readOnlyHint"],
    });
    expect(classifyTool(tool).class).toBe("reversible");
  });

  it("readOnlyHint wins even when an irreversible verb is also present", () => {
    const tool = synthTool({
      slug: "TESTKIT_SEND_PREVIEW",
      toolkitSlug: "testkit",
      tags: ["readOnlyHint"],
    });
    expect(classifyTool(tool).class).toBe("reversible");
  });

  it("updateHint plus an id-shaped schema param is compensable without an UPDATE verb token", () => {
    const tool = synthTool({
      slug: "TESTKIT_TOGGLE_STAR",
      toolkitSlug: "testkit",
      tags: ["updateHint"],
      inputParameters: { type: "object", properties: { message_id: { type: "string" } } },
    });
    const result = classifyTool(tool);
    expect(result.class).toBe("compensable");
    expect(result.reasons).toContain("hint:updateHint");
    expect(result.reasons).toContain("schema:id-param");
  });

  it("updateHint alone, with no id param, does not trigger the schema rule (falls through to unknown)", () => {
    const tool = synthTool({
      slug: "TESTKIT_TOGGLE_STAR",
      toolkitSlug: "testkit",
      tags: ["updateHint"],
      inputParameters: { type: "object", properties: { color: { type: "string" } } },
    });
    expect(classifyTool(tool).class).toBe("unknown");
  });

  it("a read verb with no readOnlyHint tag is still reversible", () => {
    const tool = synthTool({ slug: "TESTKIT_FIND_RECORD", toolkitSlug: "testkit" });
    expect(classifyTool(tool).class).toBe("reversible");
  });

  it("PAY and CHARGE are irreversible verbs", () => {
    expect(
      classifyTool(synthTool({ slug: "TESTKIT_PAY_INVOICE", toolkitSlug: "testkit" })).class,
    ).toBe("irreversible");
    expect(
      classifyTool(synthTool({ slug: "TESTKIT_CHARGE_CARD", toolkitSlug: "testkit" })).class,
    ).toBe("irreversible");
  });

  it("TRANSFER, NOTIFY, PUBLISH, DEPLOY, EXECUTE are irreversible verbs", () => {
    for (const verb of ["TRANSFER", "NOTIFY", "PUBLISH", "DEPLOY", "EXECUTE"]) {
      const result = classifyTool(
        synthTool({ slug: `TESTKIT_${verb}_THING`, toolkitSlug: "testkit" }),
      );
      expect(result.class).toBe("irreversible");
      expect(result.reasons).toContain(`verb:${verb}`);
    }
  });

  it("INSERT and PATCH are compensable verbs", () => {
    expect(
      classifyTool(synthTool({ slug: "TESTKIT_INSERT_ROW", toolkitSlug: "testkit" })).class,
    ).toBe("compensable");
    expect(
      classifyTool(synthTool({ slug: "TESTKIT_PATCH_ROW", toolkitSlug: "testkit" })).class,
    ).toBe("compensable");
  });

  it("LABEL is a compensable verb", () => {
    expect(
      classifyTool(synthTool({ slug: "TESTKIT_LABEL_ITEM", toolkitSlug: "testkit" })).class,
    ).toBe("compensable");
  });

  it("GET, SEARCH, FETCH, READ, DESCRIBE are read verbs", () => {
    for (const verb of ["GET", "SEARCH", "FETCH", "READ", "DESCRIBE"]) {
      const result = classifyTool(
        synthTool({ slug: `TESTKIT_${verb}_THING`, toolkitSlug: "testkit" }),
      );
      expect(result.class).toBe("reversible");
      expect(result.reasons).toContain(`verb:${verb}`);
    }
  });

  it("an irreversible verb still fires when it isn't the first token", () => {
    const result = classifyTool(
      synthTool({ slug: "TESTKIT_BULK_SEND_CAMPAIGN", toolkitSlug: "testkit" }),
    );
    expect(result.class).toBe("irreversible");
    expect(result.reasons).toContain("verb:SEND");
  });

  it("a description that says the action is irreversible boosts confidence on a DELETE-family verb", () => {
    const withoutDesc = classifyTool(
      synthTool({ slug: "TESTKIT_DELETE_A", toolkitSlug: "testkit" }),
    );
    const withDesc = classifyTool(
      synthTool({
        slug: "TESTKIT_DELETE_B",
        toolkitSlug: "testkit",
        description: "This deletes the resource. This action is irreversible.",
      }),
    );
    expect(withDesc.confidence).toBeGreaterThan(withoutDesc.confidence);
  });

  it("createHint+openWorldHint boosts confidence on a send-type verb (D23) over the verb alone", () => {
    const base = classifyTool(synthTool({ slug: "TESTKIT_SEND_A", toolkitSlug: "testkit" }));
    const boosted = classifyTool(
      synthTool({
        slug: "TESTKIT_SEND_B",
        toolkitSlug: "testkit",
        tags: ["createHint", "openWorldHint"],
      }),
    );
    expect(boosted.confidence).toBeGreaterThan(base.confidence);
    expect(boosted.reasons).toContain("hint:createHint+openWorldHint");
  });

  it("never returns a confidence outside [0,1] even when every booster stacks", () => {
    const result = classifyTool(
      synthTool({
        slug: "TESTKIT_SEND_C",
        toolkitSlug: "testkit",
        description: "Sends immediately and is irreversible; cannot be undone.",
        tags: ["createHint", "openWorldHint"],
      }),
    );
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });
});

describe("classifyTool: every trimmed fixture tool (125 across 5 toolkits)", () => {
  it("loaded all 125 tools from the 5-toolkit trimmed fixture", () => {
    expect(ALL_TOOLS.length).toBe(125);
  });

  it.each(ALL_TOOLS.map((t): [string] => [t.slug]))("%s gets a valid classification", (slug) => {
    expectValid(classifyTool(fixture(slug)));
  });

  it("classifyTools batches the whole set and keys results by slug, not position", () => {
    const shuffled = [...ALL_TOOLS].reverse();
    const results = classifyTools(shuffled);
    expect(results.size).toBe(125);
    for (const tool of ALL_TOOLS) {
      expect(results.get(tool.slug)).toEqual(classifyTool(tool));
    }
  });
});
