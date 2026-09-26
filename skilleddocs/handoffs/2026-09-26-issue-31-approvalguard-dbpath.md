# Handoff — issue #31: approvalGuard dbPath + ApprovalRequiredError params

Date: 2026-09-26
Branch: `krish/issue-31` (base `7d3ca87`)
Repo: KrishP147/tool-reversibility

## Status: done

All items in the issue (#31, plan.md D49/D50) are implemented, tested, and green.

## What changed

- `apps/inbox/lib/live.ts`: `approvalGuard` is now `makeApprovalGuard({ dbPath }?)`, a factory
  returning the `beforeExecute` modifier; `export const approvalGuard = makeApprovalGuard()` keeps
  the old zero-arg export and its default path (`store.ts`'s `defaultStorePath()`,
  `<cwd>/.data/live.db`) unchanged, so the web app is unaffected.
- `ApprovalRequiredError` gained `toolkitSlug` and `params: Record<string, unknown>` alongside the
  existing `toolSlug`/`pendingId` (constructor arg order:
  `(toolSlug, toolkitSlug, pendingId, params)`). Message text unchanged. No `slug` alias was added
  — not asked for beyond "if trivial", and nothing consumes it.
- `apps/inbox/scripts/demoAgent.ts`: dropped the `.data/live.db` suffix check and the
  `process.chdir`/`mkdirSync(root)` dance in `runDemo`. `runDemo` now resolves `dbPath` (default
  `path.join(process.cwd(), ".data", "live.db")`) and calls `options.beforeExecute ??
  makeApprovalGuard({ dbPath })` directly. `--db`/`DEMO_DB` accept any path (directory creation is
  handled by `store.ts`'s `getDb`, which already `mkdirSync`s the dirname).
- `apps/inbox/README.md` (~line 97): the "Other db" bullet now says any path works instead of
  requiring the `.data/live.db` suffix.
- `propose.ts` untouched — confirmed it never constructs `ApprovalRequiredError` or calls
  `approvalGuard` directly (it calls `store.insertPending` itself), so the signature change didn't
  force any edit there.

## Tests (`apps/inbox/lib/*.test.ts`)

- `live.test.ts`: the existing `approvalGuard` test now asserts `error.toolkitSlug` and
  `error.params` (deep-equal to the call's `params`), plus that `insertPending` is called with a
  second arg of `undefined` (the default-path case). New `describe("makeApprovalGuard")` test
  asserts a custom `dbPath` is threaded through to `insertPending` as the second arg (this file
  mocks `./store` entirely, so it's an interaction test, not a real-file test).
- `demoAgent.test.ts`: `dbPath` fixture changed from `<tmp>/.data/live.db` to `<tmp>/demo.db` (no
  suffix). Removed the old "rejects a db path approvalGuard cannot write to" test (the suffix
  check no longer exists); added "accepts a plain db path with no .data/live.db suffix". New
  `describe("makeApprovalGuard dbPath (issue #31, D49)")`: stubs `process.cwd()` to a temp dir via
  `vi.spyOn`, then calls the guard with a custom `dbPath` and asserts (via the real, unmocked
  `lib/store.ts` + real `node:sqlite`) that `listPending(customDbPath)` has the row and
  `listPending(<tmp>/.data/live.db)` (the "default" path under the stubbed cwd) is empty — this is
  the literal "writes to that file and NOT the default" check the issue asked for, without ever
  touching the repo's real `apps/inbox/.data/`.

Baseline was 69 passing; now **71 passing** (17 test files), all green.

## Checks run (each once, as instructed — never `pnpm -r test`)

- `pnpm --filter inbox test` → 71 passed, 0 failed.
- `pnpm --filter inbox lint` → clean.
- `pnpm --filter inbox build` (no env vars) → `next build` succeeded, 3 routes, no type errors.
- `pnpm check:stamped` → ok (3 files).
- `pnpm exec prettier --check --end-of-line auto apps/inbox` → 2 files needed `--write` (README.md
  wrapping, demoAgent.ts after the refactor); fixed, then re-checked clean. Also manually
  re-wrapped one README line prettier had split awkwardly mid code-span.
- Smoke: `DEMO_DB=<scratch-temp-dir>/any.db pnpm demo:agent` → exit 0, printed the pending-row line
  pointing at that exact path (not `.data/live.db`).

No `@composio/core` bump, no `--live` run, no keys used, no push/merge.

## Commits (branch `krish/issue-31`, on top of `7d3ca87`)

1. `551d78e` feat(inbox): makeApprovalGuard dbPath + params/toolkitSlug on error
2. `656a888` refactor(inbox): drop demo:agent chdir + .data/live.db suffix check
3. `70ac546` test(inbox): cover makeApprovalGuard dbPath + error params/toolkitSlug
4. `c5dac3f` docs(inbox): DEMO_DB/--db take any path (issue #31)

## Deviations from the issue / plan.md D49-D50

None of substance. The issue's "Done when" criteria are all met verbatim. One judgment call: the
issue said "params on ApprovalRequiredError... optional part of #31" — implemented it (also
required by the top-level task brief that spawned this session), since it was cheap and the brief
explicitly asked for it.

## Not touched (per scope)

`packages/audit/**`, `reports/`, `docs/`, root `README.md`, `skilleddocs/plan.md` — none needed
changes for this issue; `plan.md`'s D49/D50 already anticipated this exact follow-up and don't need
updating (D50 says "optional part of #31", which is now done, but editing plan.md was explicitly
out of scope for this session per the task brief — leave that to whoever reconciles the plan next).

## Suggested skills for the next session

- `consult-plan` if anyone wants to reconcile plan.md D49/D50 status now that #31 is closed (that
  edit was explicitly out of scope here).
- `update-progress` to fold this handoff into plan.md/board bookkeeping, since this session was
  told not to touch `skilleddocs/plan.md` itself.

## Board status

No GitHub Projects board is attached to this repo (`gh issue view 31 --json projectItems` →
empty), and the repo's labels have no `status:*` scheme (checked `gh label list`) — only
`enhancement`/`sonnet`. Per the "no board: skip" rule, no board/label transition was made. Issue
#31 remains open with its original labels (`enhancement`, `sonnet`); it is ready to be closed
manually or via the PR that lands this branch. The branch/worktree was handed to this session
already created (not created by this session), so no "Started on branch" comment was posted either
(that step only applies when the session itself creates the branch).

Task is **complete**, not partial: every "Do" bullet and the "Done when" line in issue #31 are
satisfied, all checks pass, nothing was deferred.
