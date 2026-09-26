# Handoff: issue #25 `pnpm demo:agent`

Branch `krish/issue-25` (worktree `C:\Users\User\_worktrees\tool-reversibility-issue-25`), off main 47841b8. Not pushed, no PR.

## Done

- `apps/inbox/scripts/demoAgent.ts`: scripted no-LLM agent; `runDemo({ dbPath, session, beforeExecute?, log? })`, `createMockSession(fakeExecute)`, `createLiveSession()` (`--live`, dynamic `@composio/core` import, never run). Header documents the 0.21.0 dist call chain with line numbers.
- `apps/inbox/lib/demoAgent.test.ts` (4 tests, temp db, real guard + real `node:sqlite` store).
- tsx `^4.23.15` inbox devDep; root script `demo:agent` = `pnpm --filter inbox exec tsx scripts/demoAgent.ts`.
- Comments only in `lib/live.ts` and `app/actions/propose.ts`; README + apps/inbox/README have the demo text, and the D42 "unwired" wording is updated.
- Verified: `DEMO_DB=<tmp>/demo/.data/live.db pnpm demo:agent` exit 0, row queued. `pnpm --filter inbox test` 17 files / 69 tests pass; lint clean; `pnpm --filter inbox build` with no env ok; `pnpm check:stamped` ok.

## Deviations (review these)

1. **The brief's call shape is wrong for 0.21.0.** `ToolRouterSession.tools(modifiers, requestOptions)` (dist L9896, d.mts L591, `SessionMetaToolOptions = ToolOptions & SessionExecuteMetaModifiers`) takes the modifiers flat: `session.tools({ beforeExecute })`. The nested `{ modifiers: { beforeExecute } }` form is silently ignored, so the guard never runs. The code uses the flat shape. live.ts's existing header was already right.
2. **`--live` does not reuse `getLiveSession()`.** The modifier only reaches callers through an agentic provider's `wrapTools(tools, executeToolFn)` (L1771). The default `ComposioProvider` is non-agentic and drops that fn (L11032-11034), and non-agentic execution goes through `session.execute`, which skips modifiers. So `createLiveSession` builds its own `Composio` with a small `BaseAgenticProvider` subclass and `create(userId, { toolkits: ["gmail"] })`, and appends a `GMAIL_SEND_EMAIL` wrapper if the router exposes only meta tools. It typechecks but has never run.
3. **The DB override must end in `.data/live.db`.** `approvalGuard` calls `insertPending` with no path, so it writes to `<cwd>/.data/live.db`, and live.ts could not be changed. `runDemo` chdirs to the path's grandparent and restores cwd in `finally`. Relative `--db` resolves against `INIT_CWD`.
4. **`ApprovalRequiredError` has `toolSlug` and `pendingId`, not params.** The test checks the slug and id on the error, and checks params through the stored row's `payload`.

## Not done / next

- Human-only: run `pnpm demo:agent --live` with a test key to confirm the live provider path (the Tool Router may reject a direct `GMAIL_SEND_EMAIL` slug; the guard throws before the network call anyway).
- Next step: push, open the PR, and have the verifier review. Then the backlog order continues with the write-up and screenshots.
- Possible follow-up: give `approvalGuard` an optional `dbPath` so the chdir can go (touches live.ts code).

## Suggested skills

- `verifier` agent / `code-review` on the branch diff; `update-progress` after merge; `consult-plan` for deviations 1-3 (plan.md D42 text says "unit-tested but unwired"; might want a D45).

## Board status

- Issue #25: **complete** (code + tests + docs). There is no project board card (`projectItems: []`) and no status labels, so no card was moved.
- Deviations: 1-4 above. New findings: the flat modifiers shape, and that the guard needs an agentic provider. Both are worth adding to plan.md §13 as a D-entry.
