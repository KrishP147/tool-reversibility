// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ToolkitSummaryRow } from "../../lib/gaps";
import { ToolkitSummaryTable } from "./ToolkitSummaryTable";

describe("ToolkitSummaryTable", () => {
  it("renders one row per toolkit with tools/irreversible/gap counts", () => {
    const rows: ToolkitSummaryRow[] = [
      { toolkit: "gmail", tools: 60, irreversible: 10, gap: 3 },
      { toolkit: "slack", tools: 0, irreversible: 0, gap: 0 },
    ];
    render(<ToolkitSummaryTable rows={rows} />);

    expect(screen.getByText("gmail")).toBeTruthy();
    expect(screen.getByText("60")).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("slack")).toBeTruthy();
  });
});
