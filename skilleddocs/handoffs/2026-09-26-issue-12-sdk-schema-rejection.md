# Handoff: issue #12, SDK schema rejection side-quest draft (2026-09-26)

## State
Branch `krish/issue-12`, 2 commits on top of `main` (`e21b990`):
- `9255d9f` chore(audit): commit offline sdk-schema-repro script
- `2bc63f9` docs(side-quests): draft issue for SDK schema rejection (#12)

Deliverables, all done:
- `side-quests/sdk-schema-rejection.md`: ready-to-post issue draft for `ComposioHQ/composio`. Confirmed `@composio/core@0.21.0` via `packages/audit/node_modules/@composio/core/package.json`. Re-ran `packages/audit/scripts/sdk-schema-repro.ts` against the read-only snapshot at `C:/Users/User/tool-reversibility/fixtures/catalog/2026-09-24` and it matches the brief's data exactly (8 toolkits, same slugs/paths/messages).
- `side-quests/README.md`: added the new draft as a table row + step 8 (human posts it after a fresh dup check).
- `packages/audit/scripts/sdk-schema-repro.ts`: pre-existing, untouched, now committed.

## Findings worth knowing
- Dup check (`gh search issues --repo ComposioHQ/composio`) found no open duplicate. Closest precedent: #3354 (closed, fixed by #3397) — same `transformToolCases`/`ToolSchema.parse` code path, but for *empty* `outputParameters` on MCP tools. The maintainer's own closing comment on #3354 says non-empty malformed schemas still go through the same strict validator unchanged, which is exactly this issue. Cited in the draft.
- `highlevel_mcp` and `longbridge_mcp` show 0 `inputParameters` failures in the snapshot (confirmed by re-running the script) — the draft says the rejection is presumably in `outputParameters`, which the snapshot doesn't capture, per the brief; not invented further.

## Checks run
- `pnpm -r lint` — pass (2 workspace projects).
- `pnpm check:stamped` — pass (20/20 tests, 3 files checked).
- No full test suite run (memory-constrained, docs-only task, brief didn't require it).

## Not done / out of scope
- Posting the issue to GitHub — human step, per `side-quests/README.md` step 8 and the brief's hard rule (never post).
- No src/test changes were made or needed.

## Suggested skills
- None needed to continue; this task is complete. If a human posts the issue and a maintainer replies, `consult-plan` would be the right way to reconcile any follow-up fix against `skilleddocs/plan.md` D21.

## Board status
- Card: tool-reversibility issue #12. **Complete** — all three deliverables done, checks pass, nothing pushed/posted/merged (per hard rules).
- No deviations from the brief.
- Board update: this worktree has no `gh` project/board wiring visible in-session; if a label `status:in-progress` exists on issue #12, swap it to `status:in-progress` → done is normally `status:in-review`, but per the brief's "no posting to GitHub" hard rule, no GitHub label/comment/board writes were made this session. A human or orchestrator with board access should move the card.
