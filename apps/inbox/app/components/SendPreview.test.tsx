// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SendPreview } from "./SendPreview";

describe("SendPreview", () => {
  it("shows recipient and subject for an email-shaped payload", () => {
    render(
      <SendPreview
        payload={{ to: "finance@example.com", subject: "Invoice #4821 approved", body: "Hi team" }}
      />,
    );
    expect(screen.getByText("finance@example.com")).toBeTruthy();
    expect(screen.getByText("Invoice #4821 approved")).toBeTruthy();
    expect(screen.getByTestId("send-preview-email")).toBeTruthy();
  });

  it("shows channel and text for a channel-shaped payload", () => {
    render(<SendPreview payload={{ channel: "#eng-alerts", text: "Deploy finished" }} />);
    expect(screen.getByText("#eng-alerts")).toBeTruthy();
    expect(screen.getByText("Deploy finished")).toBeTruthy();
    expect(screen.getByTestId("send-preview-channel")).toBeTruthy();
  });

  it("reads Composio GMAIL_SEND_EMAIL field names (recipient_email)", () => {
    render(<SendPreview payload={{ recipient_email: "ops@example.com", subject: "Hi" }} />);
    expect(screen.getByText("ops@example.com")).toBeTruthy();
    expect(screen.getByTestId("send-preview-email")).toBeTruthy();
  });

  it("reads Composio SLACK_SEND_MESSAGE field names (markdown_text)", () => {
    render(<SendPreview payload={{ channel: "#ops", markdown_text: "Shipped" }} />);
    expect(screen.getByText("Shipped")).toBeTruthy();
  });

  it("falls back to raw JSON for an unrecognized shape", () => {
    render(<SendPreview payload={{ weird: "shape" }} />);
    expect(screen.getByTestId("send-preview-raw").textContent).toContain("weird");
  });
});
