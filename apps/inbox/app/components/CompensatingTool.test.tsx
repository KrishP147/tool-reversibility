// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CompensatingTool } from "./CompensatingTool";

describe("CompensatingTool", () => {
  it("renders the compensating tool slug when present", () => {
    render(<CompensatingTool compensatingTool="GMAIL_DELETE_DRAFT" />);
    expect(screen.getByText("GMAIL_DELETE_DRAFT")).toBeTruthy();
  });

  it("renders nothing when there is no compensating tool", () => {
    const { container } = render(<CompensatingTool compensatingTool={undefined} />);
    expect(container.textContent).toBe("");
  });
});
