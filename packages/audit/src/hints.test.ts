import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deriveHints, deriveTier, KNOWN_HINT_TAGS } from "./hints.js";
import { findRepoRoot } from "./paths.js";
import type { SnapshotTool } from "./normalize.js";

function loadFixtureTools(toolkit: string): SnapshotTool[] {
  const repoRoot = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
  const file = path.join(repoRoot, "fixtures", "catalog", "trimmed", `${toolkit}.json`);
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { tools: SnapshotTool[] };
  return parsed.tools;
}

function findTool(tools: SnapshotTool[], slug: string): SnapshotTool {
  const t = tools.find((x) => x.slug === slug);
  if (!t) throw new Error(`fixture missing ${slug}`);
  return t;
}

describe("deriveHints", () => {
  it("maps all 7 known tags to true and leaves nothing in otherTags", () => {
    const hints = deriveHints([...KNOWN_HINT_TAGS]);
    expect(hints).toEqual({
      readOnlyHint: true,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
      createHint: true,
      updateHint: true,
      important: true,
      otherTags: [],
    });
  });

  it("defaults every hint to false on an empty tag list", () => {
    const hints = deriveHints([]);
    expect(hints.readOnlyHint).toBe(false);
    expect(hints.destructiveHint).toBe(false);
    expect(hints.idempotentHint).toBe(false);
    expect(hints.openWorldHint).toBe(false);
    expect(hints.createHint).toBe(false);
    expect(hints.updateHint).toBe(false);
    expect(hints.important).toBe(false);
    expect(hints.otherTags).toEqual([]);
  });

  it("keeps unknown tags raw, in order, including ones not in the trimmed fixture (deleteHint)", () => {
    const hints = deriveHints(["deleteHint", "messages", "GraphQL", "createHint"]);
    expect(hints.createHint).toBe(true);
    expect(hints.otherTags).toEqual(["deleteHint", "messages", "GraphQL"]);
  });

  it("D23: GMAIL_SEND_EMAIL carries important, openWorldHint, createHint — no destructiveHint", () => {
    const tool = findTool(loadFixtureTools("gmail"), "GMAIL_SEND_EMAIL");
    const hints = deriveHints(tool.tags);
    expect(hints.important).toBe(true);
    expect(hints.openWorldHint).toBe(true);
    expect(hints.createHint).toBe(true);
    expect(hints.destructiveHint).toBe(false);
    expect(hints.readOnlyHint).toBe(false);
  });

  it("matches real fixture tags for GMAIL_DELETE_LABEL (destructiveHint, openWorldHint)", () => {
    const tool = findTool(loadFixtureTools("gmail"), "GMAIL_DELETE_LABEL");
    const hints = deriveHints(tool.tags);
    expect(hints.destructiveHint).toBe(true);
    expect(hints.openWorldHint).toBe(true);
    expect(hints.readOnlyHint).toBe(false);
  });
});

describe("deriveTier", () => {
  it("is always labelled derived (D6/D22)", () => {
    expect(deriveTier({ destructiveHint: false, readOnlyHint: false }).source).toBe("derived");
    expect(deriveTier({ destructiveHint: true, readOnlyHint: false }).source).toBe("derived");
    expect(deriveTier({ destructiveHint: false, readOnlyHint: true }).source).toBe("derived");
  });

  it("destructiveHint -> Destructive, even when readOnlyHint is also set", () => {
    expect(deriveTier({ destructiveHint: true, readOnlyHint: false }).tier).toBe("Destructive");
    expect(deriveTier({ destructiveHint: true, readOnlyHint: true }).tier).toBe("Destructive");
  });

  it("readOnlyHint (no destructiveHint) -> Read", () => {
    expect(deriveTier({ destructiveHint: false, readOnlyHint: true }).tier).toBe("Read");
  });

  it("neither hint -> Write", () => {
    expect(deriveTier({ destructiveHint: false, readOnlyHint: false }).tier).toBe("Write");
  });

  it("GMAIL_SEND_EMAIL derives to Write (no destructiveHint, no readOnlyHint)", () => {
    const tool = findTool(loadFixtureTools("gmail"), "GMAIL_SEND_EMAIL");
    const hints = deriveHints(tool.tags);
    expect(deriveTier(hints)).toEqual({ tier: "Write", source: "derived" });
  });

  it("GMAIL_DELETE_LABEL derives to Destructive", () => {
    const tool = findTool(loadFixtureTools("gmail"), "GMAIL_DELETE_LABEL");
    const hints = deriveHints(tool.tags);
    expect(deriveTier(hints).tier).toBe("Destructive");
  });

  it("GMAIL_LIST_MESSAGES derives to Read", () => {
    const tool = findTool(loadFixtureTools("gmail"), "GMAIL_LIST_MESSAGES");
    const hints = deriveHints(tool.tags);
    expect(deriveTier(hints).tier).toBe("Read");
  });
});
