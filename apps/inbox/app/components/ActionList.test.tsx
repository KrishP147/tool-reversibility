// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PendingAction } from "../../lib/pending";
import type { Report } from "../../lib/report";
import { ActionList } from "./ActionList";

const action: PendingAction = {
  id: "001-gmail-send-email",
  slug: "GMAIL_SEND_EMAIL",
  toolkit: "gmail",
  kind: "send",
  payload: { to: "finance@example.com" },
  illustrative: true,
  note: "test",
  createdAt: "2026-09-24T09:00:00.000Z",
};

const report: Report = {
  stub: true,
  tools: [
    {
      slug: "GMAIL_SEND_EMAIL",
      toolkit: "gmail",
      ruleClass: "irreversible",
      llmClass: "irreversible",
      agree: true,
      hints: {},
      tier: "Write",
      tierSource: "derived",
      reasons: ["Sends an email; no undo API"],
    },
  ],
};

describe("ActionList", () => {
  it("renders slug, toolkit, badge, tier/tierSource, reasons and a detail link", () => {
    render(<ActionList actions={[action]} report={report} />);

    expect(screen.getByText("GMAIL_SEND_EMAIL")).toBeTruthy();
    expect(screen.getByText("gmail")).toBeTruthy();
    expect(screen.getByText("Irreversible")).toBeTruthy();
    expect(screen.getByText(/Write.*derived/)).toBeTruthy();
    expect(screen.getByText("Sends an email; no undo API")).toBeTruthy();

    const link = screen.getByText("GMAIL_SEND_EMAIL").closest("a");
    expect(link?.getAttribute("href")).toBe("/actions/001-gmail-send-email");
  });

  it("renders an empty state with no actions", () => {
    render(<ActionList actions={[]} report={report} />);
    expect(screen.getByText("No pending actions.")).toBeTruthy();
  });

  it("still renders a row when the tool has no report entry", () => {
    const unknownAction: PendingAction = { ...action, id: "999-x", slug: "NOPE" };
    render(<ActionList actions={[unknownAction]} report={report} />);
    expect(screen.getByText("Unknown")).toBeTruthy();
  });
});
