// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { diffPayload, PayloadDiff } from "./PayloadDiff";

describe("diffPayload", () => {
  it("marks changed, added and removed keys", () => {
    const rows = diffPayload(
      { title: "old", state: "open", labels: ["bug"] },
      { title: "old", state: "closed", extra: true },
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.status]));
    expect(byKey.title).toBe("unchanged");
    expect(byKey.state).toBe("changed");
    expect(byKey.labels).toBe("removed");
    expect(byKey.extra).toBe("added");
  });

  it("treats every key as added when there's no before", () => {
    const rows = diffPayload(undefined, { to: "a@b.com" });
    expect(rows).toEqual([{ key: "to", status: "added", after: "a@b.com" }]);
  });
});

describe("PayloadDiff", () => {
  it("renders a row per key with the changed status shown", () => {
    render(
      <PayloadDiff
        before={{ title: "Login button misaligned", state: "open" }}
        proposed={{ title: "Login button misaligned", state: "closed" }}
      />,
    );

    const stateRow = screen.getByText("state").closest("tr");
    expect(stateRow?.getAttribute("data-status")).toBe("changed");
    expect(stateRow?.textContent).toContain("open");
    expect(stateRow?.textContent).toContain("closed");

    const titleRow = screen.getByText("title").closest("tr");
    expect(titleRow?.getAttribute("data-status")).toBe("unchanged");
  });
});
