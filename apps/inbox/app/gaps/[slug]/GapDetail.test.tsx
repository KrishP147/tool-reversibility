// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GapDetail as GapDetailData } from "../../../lib/gaps";
import { GapDetail } from "./GapDetail";

const detail: GapDetailData = {
  slug: "GMAIL_SEND_EMAIL",
  toolkit: "gmail",
  ruleClass: "irreversible",
  ruleConfidence: 1,
  reasons: ["verb:SEND"],
  hints: { destructiveHint: false, openWorldHint: true },
  tier: "Write",
  tierSource: "derived",
  llmClass: "unknown",
  llmStatus: "recorded",
  llmStatusLabel: "rules-only — LLM pending",
  agree: false,
  compensatingTool: undefined,
  singleGap: true,
  gap: false,
  spotcheck: null,
};

describe("GapDetail", () => {
  it("renders toolkit, hints, tier, rule class/confidence/reasons, LLM status and gap flags", () => {
    render(<GapDetail detail={detail} />);

    expect(screen.getByText("GMAIL_SEND_EMAIL")).toBeTruthy();
    expect(screen.getByText("gmail")).toBeTruthy();
    expect(screen.getByText("destructiveHint: no")).toBeTruthy();
    expect(screen.getByText("openWorldHint: yes")).toBeTruthy();
    expect(screen.getByText(/Write/)).toBeTruthy();
    expect(screen.getByText(/class: irreversible/)).toBeTruthy();
    expect(screen.getByText(/confidence: 1/)).toBeTruthy();
    expect(screen.getByText("verb:SEND")).toBeTruthy();
    expect(screen.getByText(/status: rules-only — LLM pending/)).toBeTruthy();
    expect(screen.getByText(/class: unknown/)).toBeTruthy();

    const gapFlags = screen.getByTestId("gap-flags");
    expect(gapFlags.textContent).toMatch(/GAP.*no/);
    expect(gapFlags.textContent).toMatch(/single-gap.*yes/);

    expect(screen.queryByTestId("compensating-tool")).toBeNull();
    expect(screen.queryByTestId("spotcheck")).toBeNull();
  });

  it("renders a compensating tool and spot-check label when present", () => {
    render(
      <GapDetail
        detail={{
          ...detail,
          compensatingTool: "GMAIL_UNTRASH_MESSAGE",
          spotcheck: { label: "irreversible", rationale: "Delivers to external recipients." },
        }}
      />,
    );

    expect(screen.getByTestId("compensating-tool").textContent).toContain("GMAIL_UNTRASH_MESSAGE");
    const spotcheck = screen.getByTestId("spotcheck");
    expect(spotcheck.textContent).toContain("irreversible");
    expect(spotcheck.textContent).toContain("Delivers to external recipients.");
  });

  it("renders (none) when there are no hints", () => {
    render(<GapDetail detail={{ ...detail, hints: {} }} />);
    expect(screen.getByText("(none)")).toBeTruthy();
  });

  it("renders a partial note and the tier fallback for a slug not in tools[]", () => {
    render(
      <GapDetail
        detail={{
          ...detail,
          tier: null,
          tierSource: null,
          partial: true,
        }}
      />,
    );

    expect(screen.getByTestId("gaps-partial-note")).toBeTruthy();
    expect(screen.getByText("— (not in report's tools[] slice)")).toBeTruthy();
  });

  it("renders no partial note when partial is not set", () => {
    render(<GapDetail detail={detail} />);
    expect(screen.queryByTestId("gaps-partial-note")).toBeNull();
  });
});
