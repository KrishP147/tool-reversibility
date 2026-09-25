# apps/inbox

The approval inbox for "ask" actions (plan.md §3b): a list of pending tool calls, each with a
reversibility badge, a payload diff or send preview, and Approve / Reject / Edit.

## Run

From the repo root (or here with `pnpm --filter inbox <script>`):

```sh
pnpm --filter inbox dev     # http://localhost:3000
pnpm --filter inbox test
pnpm --filter inbox lint
pnpm --filter inbox build && pnpm --filter inbox start
```

## Mock mode (default, zero keys)

`INBOX_MODE` defaults to `mock` (see `lib/mode.ts`) and needs no API keys. In mock mode the
inbox reads:

- `fixtures/pending/*.json` — hand-written, illustrative pending actions (`lib/pending.ts`).
  Every fixture is marked `"illustrative": true`; they are not a real Composio catalog snapshot
  (that lands with issue #2's `fixtures/catalog/`).
- `<repoRoot>/reports/report.json` — the stamped classifier report from issue #5's
  `packages/audit` pipeline, if it exists.

**Until issue #5 ships a real report**, the app falls back to `lib/stub/report.stub.json`
(`stub: true`, no invented Composio numbers) and the list page shows a banner saying so. Issue #5
must either conform to the `Report`/`ToolReport` shape in `lib/report.ts`, or that file gets
updated to match — whichever lands second reconciles with the other.

Live mode (`INBOX_MODE=live`, a real Composio session) is issue #7's job and is out of scope
here.

## Audit log

Every Approve / Reject / Edit decision is appended to `apps/inbox/.data/audit.jsonl`
(gitignored, created lazily on first decision — `lib/audit.ts`). Each line is one JSON record:

```json
{"actionId":"001-gmail-send-email","slug":"GMAIL_SEND_EMAIL","decision":"approve","who":"mock-user","when":"2026-09-24T21:00:00.000Z","payloadHash":"<sha256 of the canonical JSON of the payload actually approved>"}
```

`who` comes from `INBOX_USER` if set, else `"mock-user"`. The log is append-only (never
truncated or rewritten) and is not required to exist for `build`/`start` to work. Live mode
swaps this for SQLite (plan.md §3b); mock mode stays JSONL.

## Pages

- `app/page.tsx` — list view: every pending action with its reversibility badge, tier and
  tier source (`real` from the SDK vs `derived` from hints), and the classifier's reasons.
- `app/actions/[id]/page.tsx` — detail view: a payload diff for `kind: "update"`, a rendered
  preview for `kind: "send"`, raw JSON otherwise, the compensating tool when the report names
  one, and the Approve/Reject/Edit panel. Decisions are recorded via the `"use server"` action
  in `app/actions/[id]/actions.ts`, which calls `lib/audit.ts`.

Both pages are `force-dynamic`: fixtures, the report and the audit log can all change between
requests, so nothing here is baked in at `next build` time.
