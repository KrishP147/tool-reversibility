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
  Slugs and payload field names match the real catalog snapshot (`fixtures/catalog/`, plan.md
  D34); values are made up, so every fixture stays marked `"illustrative": true`.
- `<repoRoot>/reports/report.json` — the stamped classifier report from issue #5's
  `packages/audit` pipeline, if it exists.

`reports/report.json` is committed (rules-only until the live LLM run). If it is missing, the app
falls back to `lib/stub/report.stub.json` (`stub: true`, no invented Composio numbers) and the
list page shows a banner saying so. The shape is `Report`/`ToolReport` in `lib/report.ts`.

Live mode (`INBOX_MODE=live`, a real Composio session): see [Live mode](#live-mode) below and the root README's "Run on Replit" section for how its secrets
are set on a deployment.

## Audit log

Every Approve / Reject / Edit decision is appended to `apps/inbox/.data/audit.jsonl`
(gitignored, created lazily on first decision — `lib/audit.ts`). Each line is one JSON record:

```json
{
  "actionId": "001-gmail-send-email",
  "slug": "GMAIL_SEND_EMAIL",
  "decision": "approve",
  "who": "mock-user",
  "when": "2026-09-24T21:00:00.000Z",
  "payloadHash": "<sha256 of the canonical JSON of the payload actually approved>"
}
```

`who` comes from `INBOX_USER` if set, else `"mock-user"`. The log is append-only (never
truncated or rewritten) and is not required to exist for `build`/`start` to work. Live mode
swaps this for SQLite (plan.md §3b); mock mode stays JSONL.

## Live mode

`INBOX_MODE=live` (default is `mock`; `lib/mode.ts`) swaps the fixture-backed list for a real
Composio session:

- **Flag + key.** Set `INBOX_MODE=live` and `COMPOSIO_API_KEY=<your key>` (`lib/live.ts`'s
  `getLiveSession`; no key -> a live-mode failure banner on the list page, never a crash).
- **Propose form.** There's no LLM agent driving tool calls in this build, so the list page shows
  a "Propose a live action" form (`app/components/ProposeForm.tsx`) instead — tool slug, toolkit
  slug and JSON args, submitted via the `proposeAction` server action
  (`app/actions/propose.ts`), which inserts a pending row directly into the live store.
- **Approve executes for real,** via `session.execute(slug, payload)` (`lib/live.ts`'s
  `executeApproved`), and records one audit row either way; a Composio failure comes back as
  `{ ok: false, error }` and is shown on the page, not thrown.
- **Reject and Edit only log.** Reject marks the row rejected and audits the decision; Edit
  persists the new payload and audits it. Neither ever calls Composio
  (`app/actions/[id]/actions.ts`'s `decideOnAction`).
- **Storage.** Live pending rows and the live audit log live in one SQLite file,
  `apps/inbox/.data/live.db` (gitignored), via Node's built-in `node:sqlite` (`DatabaseSync`,
  `lib/store.ts`) — no native build step, no `better-sqlite3`. Needs Node >=22.13; no
  `--experimental-sqlite` flag required at that version, though Node still prints a one-line
  experimental-feature warning on first use.
- **Undocumented behaviour.** `@composio/core` is pinned to exactly `0.21.0` because the
  `beforeExecute` intercept shape (`session.tools({ beforeExecute })`) and the fact that
  `session.execute()` skips it entirely aren't in Composio's published docs — only confirmed by
  reading that version's dist. See `lib/live.ts`'s header comment before bumping the version.

### Demo agent

Demo: `pnpm demo:agent` (from the repo root) then `INBOX_MODE=live pnpm --filter inbox dev` shows
the proposal.

`scripts/demoAgent.ts` is a scripted, no-LLM agent. It gets its tools via
`session.tools({ beforeExecute: approvalGuard })` and calls `GMAIL_SEND_EMAIL` with a fixed
payload (placeholder address). `lib/live.ts`'s `approvalGuard` throws `ApprovalRequiredError` and
queues a pending row in `.data/live.db`, so the send never runs.

- **Default: mock session.** Mirrors `@composio/core` 0.21.0's `tools()` -> `executeSessionTool`
  path (`beforeExecute` before execute, dist line numbers in the script's header) with a fake
  execute. No key, no network.
- **`--live`.** A real Composio session (needs `COMPOSIO_API_KEY`), using a small agentic
  provider: the default provider drops the execute fn, so the modifier would never fire.
- **Other db.** `DEMO_DB=<dir>/.data/live.db` or `--db <dir>/.data/live.db`. The path must end in
  `.data/live.db` because `approvalGuard` always writes to `<cwd>/.data/live.db`.
- **Then.** The live list needs no key to show the row. Approve without a key shows a banner and
  the row stays pending (plan.md D43); with a key it sends for real.

This is still a client-side hook, not a server-side gate (root README Limitations).

## Pages

- `app/page.tsx` — list view: every pending action with its reversibility badge, tier and
  tier source (`real` from the SDK vs `derived` from hints), and the classifier's reasons.
- `app/actions/[id]/page.tsx` — detail view: a payload diff for `kind: "update"`, a rendered
  preview for `kind: "send"`, raw JSON otherwise, the compensating tool when the report names
  one, and the Approve/Reject/Edit panel. Decisions are recorded via the `"use server"` action
  in `app/actions/[id]/actions.ts`, which calls `lib/audit.ts`.

Both pages are `force-dynamic`: fixtures, the report and the audit log can all change between
requests, so nothing here is baked in at `next build` time.
