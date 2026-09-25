// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ToolReport } from "../../lib/report";
import { ReversibilityBadge } from "./ReversibilityBadge";

function tool(overrides: Partial<ToolReport>): ToolReport {
  return {
    slug: "X",
    toolkit: "x",
    ruleClass: "reversible",
    llmClass: "reversible",
    agree: true,
    hints: {},
    tier: "Read",
    tierSource: "real",
    reasons: [],
    ...overrides,
  };
}

describe("ReversibilityBadge", () => {
  it("renders red for irreversible", () => {
    render(
      <ReversibilityBadge tool={tool({ ruleClass: "irreversible", llmClass: "irreversible" })} />,
    );
    const badge = screen.getByText("Irreversible");
    expect(badge.className).toContain("bg-red-100");
  });

  it("renders amber for compensable", () => {
    render(
      <ReversibilityBadge tool={tool({ ruleClass: "compensable", llmClass: "compensable" })} />,
    );
    expect(screen.getByText("Compensable").className).toContain("bg-amber-100");
  });

  it("renders green for reversible", () => {
    render(<ReversibilityBadge tool={tool({ ruleClass: "reversible", llmClass: "reversible" })} />);
    expect(screen.getByText("Reversible").className).toContain("bg-green-100");
  });

  it("renders gray for unknown / missing report entry", () => {
    render(<ReversibilityBadge tool={undefined} />);
    expect(screen.getByText("Unknown").className).toContain("bg-gray-100");
  });

  it("most-caution-wins: disagreement between reversible and irreversible shows red", () => {
    render(
      <ReversibilityBadge
        tool={tool({ ruleClass: "reversible", llmClass: "irreversible", agree: false })}
      />,
    );
    expect(screen.getByText("Irreversible").className).toContain("bg-red-100");
  });
});
