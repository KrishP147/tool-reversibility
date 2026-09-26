// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GapsTableRow } from "../../lib/gaps";
import { GapsTable } from "./GapsTable";

const row: GapsTableRow = {
  slug: "GMAIL_SEND_EMAIL",
  toolkit: "gmail",
  ruleClass: "irreversible",
  confidence: 1,
  hints: ["openWorldHint", "createHint"],
  tier: "Write",
  tierSource: "derived",
  reasons: ["verb:SEND"],
};

describe("GapsTable", () => {
  it("renders slug, toolkit, rule class, confidence, hints, tier and reasons", () => {
    render(<GapsTable rows={[row]} />);

    const link = screen.getByText("GMAIL_SEND_EMAIL");
    expect(link.closest("a")?.getAttribute("href")).toBe("/gaps/GMAIL_SEND_EMAIL");
    expect(screen.getByText("gmail")).toBeTruthy();
    expect(screen.getByText("irreversible")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("openWorldHint, createHint")).toBeTruthy();
    expect(screen.getByText(/Write/)).toBeTruthy();
    expect(screen.getByText("verb:SEND")).toBeTruthy();
  });

  it("renders an empty state with no rows", () => {
    render(<GapsTable rows={[]} />);
    expect(screen.getByText(/No single-classifier gaps/)).toBeTruthy();
  });

  it("shows (none) when a row has no hints", () => {
    render(<GapsTable rows={[{ ...row, hints: [] }]} />);
    expect(screen.getByText("(none)")).toBeTruthy();
  });

  it("shows a dash, not a tierSource, when tier is null", () => {
    render(<GapsTable rows={[{ ...row, tier: null, tierSource: null }]} />);
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText(/derived/)).toBeNull();
  });
});
