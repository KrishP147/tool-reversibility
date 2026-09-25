// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DecisionPanel } from "./DecisionPanel";

const payload = { to: "finance@example.com" };

describe("DecisionPanel", () => {
  it("approve calls decide with the unedited payload and shows the confirmation hash", async () => {
    const decide = vi.fn().mockResolvedValue({ payloadHash: "abc123" });
    render(<DecisionPanel payload={payload} decide={decide} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    const confirmation = await screen.findByTestId("decision-confirmation");
    expect(decide).toHaveBeenCalledWith("approve", payload);
    expect(confirmation.textContent).toContain("abc123");
    expect(confirmation.textContent).toContain("approve");
  });

  it("reject calls decide with decision reject", async () => {
    const decide = vi.fn().mockResolvedValue({ payloadHash: "def456" });
    render(<DecisionPanel payload={payload} decide={decide} />);

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await screen.findByTestId("decision-confirmation");
    expect(decide).toHaveBeenCalledWith("reject", payload);
  });

  it("invalid edit JSON shows an error and never calls decide", () => {
    const decide = vi.fn();
    render(<DecisionPanel payload={payload} decide={decide} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Edited payload JSON"), {
      target: { value: "{ not valid json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit edit" }));

    expect(screen.getByRole("alert").textContent).toMatch(/invalid json/i);
    expect(decide).not.toHaveBeenCalled();
  });

  it("valid edit JSON submits the edited payload, not the original", async () => {
    const decide = vi.fn().mockResolvedValue({ payloadHash: "hash-edited" });
    render(<DecisionPanel payload={payload} decide={decide} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Edited payload JSON"), {
      target: { value: '{"to":"edited@example.com"}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit edit" }));

    await screen.findByTestId("decision-confirmation");
    expect(decide).toHaveBeenCalledWith("edit", { to: "edited@example.com" });
  });
});
