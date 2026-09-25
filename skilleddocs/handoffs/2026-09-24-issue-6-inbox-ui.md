# Handoff: issue #6 — Inbox UI (round 2)

Branch: `krish/issue-6` (worktree `C:\Users\User\_worktrees\tool-reversibility-issue-6`), base `main` @ 23aecde.
Prior round's WIP: commit `c4f1357` (lib/report.ts, lib/pending.ts, lib/classify.ts, lib/repoRoot.ts, stub report,
fixtures/pending/*, plus base scaffolding `7da577d`). This round picks up from there.

## What this session did

All 5 REMAINING items from the round-2 brief are done, one small commit per item (see `git log --oneline` on
this branch, `40ccbff..c099e85`):

1. `apps/inbox/vitest.config.ts` + `apps/inbox/vitest.setup.ts` — `@vitejs/plugin-react`, default environment
   `node` (so the existing fs-based lib tests keep running with no DOM), jsdom opted in per-file via
   `// @vitest-environment jsdom` docblock on component test files. The setup file adds an `afterEach(cleanup)`
   guarded on `typeof document !== "undefined"` — without it, RTL doesn't unmount between tests and
   `getByText` starts failing with "multiple elements found" once more than one jsdom test file runs.
2. `apps/inbox/lib/audit.ts` (+ `lib/audit.test.ts`) — append-only JSONL log at `<cwd>/.data/audit.jsonl`
   (default `defaultAuditDir()`, injectable for tests), created lazily on first `recordDecision()` call.
   `payloadHash` is sha256 of a deep-key-sorted canonical JSON of the payload actually approved (post-edit for
   `decision: "edit"`). `who` = `INBOX_USER` env or `"mock-user"`. One line added to root `.gitignore`:
   `apps/inbox/.data/`.
3. Six components under `apps/inbox/app/components/`, each with an RTL test:
   `ReversibilityBadge`, `ActionList`, `PayloadDiff` (+ exported `diffPayload()` pure function),
   `SendPreview` (email shape via `to`/`subject`/`body`, channel shape via `channel`/`text`, raw JSON fallback
   for anything else), `CompensatingTool`, `DecisionPanel` (client component; Edit opens a JSON textarea seeded
   with the current payload, invalid JSON is caught client-side before any `decide()` call — see its test
   "invalid edit JSON shows an error and never calls decide").
   `ActionList` uses plain `<a href>` rather than `next/link`, deliberately — full navigation to the detail
   page (not a client transition), and it keeps the component trivially renderable in RTL with no router
   context to mock.
4. Pages: `app/page.tsx` (list, uses `ActionList` + stub banner when `report.stub`) and
   `app/actions/[id]/page.tsx` (detail; Next 15 `params` is a `Promise`, awaited; `notFound()` on a missing id;
   diff for `kind: "update"`, `SendPreview` for `kind: "send"`, raw `<pre>` JSON otherwise). Decisions go
   through `app/actions/[id]/actions.ts` (`"use server"`, `decideOnAction(id, decision, payload)`), bound to the
   action id with `.bind(null, action.id)` before being passed down as `DecisionPanel`'s `decide` prop — this is
   the documented pattern for passing a server action reference with a pre-bound argument into a client
   component. Both pages export `dynamic = "force-dynamic"` (fixtures/report/audit log can change between
   requests; this also means `next build` never tries to prerender them statically).
5. `apps/inbox/README.md` — run commands, mock-mode-is-default, stub-report note (and that issue #5 must
   conform to or update `lib/report.ts`'s `Report`/`ToolReport` shape), audit log location/shape,
   fixtures-are-illustrative note.

Edit (the stretch-risk item) is fully implemented, not slipped.

## Verified

From the repo root, in order: `pnpm i --frozen-lockfile` (no lockfile drift), `pnpm -r lint` (clean, both
packages), `pnpm -r test` (packages/audit 7 tests + apps/inbox 39 tests, all green), `pnpm -r build` (both
packages build; inbox route table shows `/` and `/actions/[id]` both `ƒ` dynamic as intended, `/_not-found`
static). Also manually booted `pnpm dev` in the background and curled all three paths: `/` → 200 (stub banner
+ badges visible in the HTML), `/actions/002-github-update-issue` → 200 (this fixture's slug,
`GITHUB_UPDATE_ISSUE`, is the one stub entry with a `compensatingTool`, so it's a good manual smoke path for
the diff view + CompensatingTool block together), `/actions/does-not-exist` → 404. Dev server log had no
errors. Killed the dev server and removed `.next`/`.data` before finishing; working tree is clean.

One pre-existing warning, not introduced this session and out of scope to fix here: `next build` prints
"The Next.js plugin was not detected in your ESLint configuration" — `eslint.config.mjs` is a root flat config
shared across the workspace and doesn't include `@next/eslint-plugin-next`. `pnpm -r lint` (the repo's actual
lint gate, `eslint .`) is unaffected and clean.

## Not done / explicitly out of scope this round

- Live mode (`INBOX_MODE=live`), SQLite audit log, `.replit`/Dockerfile — issue #7.
- `fixtures/catalog/**`, `packages/audit` real report generation — issue #5 (still unmerged; inbox reads the
  bundled stub until then, per `loadReport()`'s fallback in `lib/report.ts`).
- No `tailwind.config.js` was added (not needed; Tailwind v4 config is `apps/inbox/app/globals.css`'s
  `@import "tailwindcss"` + `postcss.config.mjs`, already in place from round 1).

## Board status

Issue #6 (Inbox UI, mock mode) — this session completed all remaining scope from the round-2 brief. Status:
**complete**, ready for review/merge (not merged by this session — worktree rules forbid push/merge).

- Card/labels: this repo has no Projects v2 board attached to issue #6 (`projectItems` query returns empty)
  and no `status:*` labels in its label set at all (`gh label list` — only `bug`, `documentation`, `sonnet`,
  `opus`, etc.). Nothing to move. Posted an issue comment instead
  (https://github.com/KrishP147/tool-reversibility/issues/6#issuecomment-5825484037) summarizing completion and
  pointing at this handoff, per session-handoff's board-error fallback ("note it in the handoff, carry on").
  No deviations from the issue's acceptance criteria — list, detail, diff/preview, badge, approve/reject/edit
  and the audit log all work with zero keys, component tests exist, and the app builds. Deps on issue #5
  handled via the pre-existing stub fallback (round 1's work), as the issue anticipated.
- No scope creep: stayed inside `apps/inbox/**`, `fixtures/pending/*.json` (untouched — round 1 already wrote
  them), `.gitignore` (one line), `pnpm-lock.yaml` (untouched — no new deps were needed beyond what round 1
  already added).
- Innovation/idea not in the issue: using `next/link`-free plain `<a href>` for list→detail navigation (see
  above) and binding the server action with `.bind(null, action.id)` rather than threading the id through
  `DecisionPanel`'s props — both small implementation choices, not blocking, noted here so a reviewer knows
  they were deliberate.



- `next` — to see what's next on the board after this closes out.
- `code-review` (medium) if a reviewer wants a second pass on `app/actions/[id]/actions.ts`'s trust boundary
  (it re-validates the action exists server-side via `getPendingAction`, but doesn't validate the *shape* of an
  edited payload against anything — that's a deliberate scope call for a mock-mode demo, worth flagging).
- `consult-plan` if issue #5's real `Report` shape ends up disagreeing with `lib/report.ts`'s `ToolReport`
  type — the README calls this out as a "whichever lands second reconciles" situation.
