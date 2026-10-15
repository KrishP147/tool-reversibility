# Catalog snapshot 2026-09-24

The one snapshot docs may cite with a `[snapshot ...]` marker (`KNOWN_SNAPSHOTS` in
`scripts/check-stamped.mjs`, convention in [stamping.md](stamping.md)). It is a full fetch of
Composio's public catalog metadata with `@composio/core` 0.21.0, run with `pnpm audit:cli fetch`.
The full snapshot (~169 MB) is gitignored; `fixtures/catalog/trimmed/` is the committed subset.

## Counts

- 1,562 toolkits and 56,216 tools, 659 of them deprecated [snapshot 2026-09-24, @composio/core 0.21.0].
- 0 failures and 0 truncation fallbacks; SDK payload rejections fell back to the raw REST list for 8 toolkits [snapshot 2026-09-24, @composio/core 0.21.0].
- Trimmed fixture: `--toolkits gmail,slack,github,googlecalendar,notion --max-tools 25` keeps 125 of 1,233 tools [snapshot 2026-09-24, @composio/core 0.21.0].

## Facts the docs rely on

- **`GMAIL_SEND_EMAIL` tags:** `important`, `openWorldHint`, `createHint`, and no `destructiveHint`
  (SDK and raw REST agree) [snapshot 2026-09-24, @composio/core 0.21.0].
- **Tier is not exposed.** Neither the SDK `Tool`, the raw REST tool, nor the toolkit object
  carries a Read/Write/Destructive tier, so the tier column is derived from hints
  (`destructiveHint` gives Destructive, `readOnlyHint` gives Read, else Write).
- **Toolkit pagination.** The SDK `toolkits.get({ limit })` returns a bare array and drops the
  cursor, so the fetch pages the raw client's `toolkits.list` and drains `next_cursor`.
- **Per-toolkit tools.** `getRawComposioTools({ toolkits: [slug], limit })` returns every latest
  tool, deprecated included. `limit` must always be passed: without it the SDK adds
  `important=true` and returns a curated subset. A guard re-fetches through the raw REST list
  when a result looks truncated; it never fired in this run.
- **SDK payload rejection.** For some toolkits the SDK's zod schema rejects the tool list (for
  example a boolean JSON-schema node in `inputParameters`). Errors with no HTTP status fall back
  to the raw REST list and are recorded as `source: "rest-cursor", fallbackReason: "sdk-error"`.
  Offline repro: `packages/audit/scripts/sdk-schema-repro.ts`.
