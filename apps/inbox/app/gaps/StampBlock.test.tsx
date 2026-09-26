// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GapsStamp } from "../../lib/gaps";
import { StampBlock } from "./StampBlock";

const stamp: GapsStamp = {
  date: "2026-09-24",
  commit: "a9d50c00eb877ffeb7c670fc17383f5aa78b1cb3",
  llmStatus: "recorded",
  model: "pending",
};

describe("StampBlock", () => {
  it("renders the date, a shortened commit and the LLM status label", () => {
    render(<StampBlock stamp={stamp} llmStatusLabel="rules-only — LLM pending" />);
    expect(screen.getByText("2026-09-24")).toBeTruthy();
    expect(screen.getByText("a9d50c0")).toBeTruthy();
    expect(screen.getByText("rules-only — LLM pending")).toBeTruthy();
  });
});
