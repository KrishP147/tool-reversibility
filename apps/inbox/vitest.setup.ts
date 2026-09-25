import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmounts components rendered by RTL between tests. Guarded on `document`
// so this is a no-op for the plain-node fs tests (report/pending/audit/etc.)
// that don't opt into the jsdom environment.
afterEach(() => {
  if (typeof document !== "undefined") {
    cleanup();
  }
});
