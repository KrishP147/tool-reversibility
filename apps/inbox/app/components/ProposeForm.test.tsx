// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProposeForm } from "./ProposeForm";

describe("ProposeForm", () => {
  it("invalid JSON in args shows an error and never calls propose", () => {
    const propose = vi.fn();
    render(<ProposeForm propose={propose} />);

    fireEvent.change(screen.getByPlaceholderText("GMAIL_SEND_EMAIL"), {
      target: { value: "GMAIL_SEND_EMAIL" },
    });
    fireEvent.change(screen.getByLabelText("Args (JSON)"), {
      target: { value: "{ not valid json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose" }));

    expect(screen.getByRole("alert").textContent).toMatch(/invalid json/i);
    expect(propose).not.toHaveBeenCalled();
  });

  it("missing tool slug shows an error and never calls propose", () => {
    const propose = vi.fn();
    render(<ProposeForm propose={propose} />);

    fireEvent.click(screen.getByRole("button", { name: "Propose" }));

    expect(screen.getByRole("alert").textContent).toMatch(/tool slug is required/i);
    expect(propose).not.toHaveBeenCalled();
  });

  it("valid input calls propose with the parsed payload and shows the confirmation", async () => {
    const propose = vi.fn().mockResolvedValue({ id: "live-abc" });
    render(<ProposeForm propose={propose} />);

    fireEvent.change(screen.getByPlaceholderText("GMAIL_SEND_EMAIL"), {
      target: { value: "GMAIL_SEND_EMAIL" },
    });
    fireEvent.change(screen.getByPlaceholderText("gmail"), { target: { value: "gmail" } });
    fireEvent.change(screen.getByLabelText("Args (JSON)"), {
      target: { value: '{"to":"a@b.com"}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose" }));

    const confirmation = await screen.findByTestId("propose-confirmation");
    expect(propose).toHaveBeenCalledWith({
      slug: "GMAIL_SEND_EMAIL",
      toolkitSlug: "gmail",
      payload: { to: "a@b.com" },
    });
    expect(confirmation.textContent).toContain("live-abc");
  });

  it("surfaces a server-action failure as an error", async () => {
    const propose = vi.fn().mockRejectedValue(new Error("Propose is only available in live mode."));
    render(<ProposeForm propose={propose} />);

    fireEvent.change(screen.getByPlaceholderText("GMAIL_SEND_EMAIL"), {
      target: { value: "GMAIL_SEND_EMAIL" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/only available in live mode/i);
  });
});
