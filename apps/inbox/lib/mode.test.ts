import { describe, expect, it } from "vitest";
import { getInboxMode } from "./mode";

describe("getInboxMode", () => {
  it("defaults to mock when INBOX_MODE is unset", () => {
    expect(getInboxMode({})).toBe("mock");
  });

  it("defaults to mock for any value other than 'live'", () => {
    expect(getInboxMode({ INBOX_MODE: "mock" })).toBe("mock");
    expect(getInboxMode({ INBOX_MODE: "" })).toBe("mock");
  });

  it("returns live when INBOX_MODE=live", () => {
    expect(getInboxMode({ INBOX_MODE: "live" })).toBe("live");
  });
});
