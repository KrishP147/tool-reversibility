# Handoff: issue #3 — hints/tier extraction + rule-based reversibility classifier

Date: 2026-09-24 · Branch: `krish/issue-3` (base `e687a9a`) · Repo: `KrishP147/tool-reversibility`

## Status: complete

All "Done when" boxes on `gh issue view 3` are met. Green gate is green (see below), with one
documented, deliberate exception.

## What was built

Three new files in `packages/audit/src` (own-only scope per the kickoff brief), plus their tests:

- `classification.ts` — **byte-identical** to the issue #3 spec (D1): `ReversibilityClass` union +
  `ClassifierResult` interface, single-line each, exactly as given.
- `hints.ts` — `deriveHints(tags)` maps `tags[]` to the 7 known booleans (`readOnlyHint`,
  `destructiveHint`, `idempotentHint`, `openWorldHint`, `createHint`, `updateHint`, `important`),
  keeping every other tag raw in `otherTags` (verified against the fixture's `deleteHint`, `messages`,
  `GraphQL`, etc.). `deriveTier(hints)` derives Read/Write/Destructive
  (destructiveHint→Destructive, else readOnlyHint→Read, else Write) and always returns
  `source: "derived"` — the SDK never exposes a real tier (D6/D20/D22 in `skilleddocs/plan.md`).
- `rules.ts` — pure `classifyTool(tool): ClassifierResult`. Tokenizes the slug (prefix
  `${toolkit.slug.toUpperCase()}_` stripped, split on `_`), scans **every** token (not just the
  first — `GOOGLECALENDAR_CALENDAR_LIST_DELETE` correctly finds `DELETE`, not `LIST`).
  Precedence: `readOnlyHint` → reversible; irreversible verbs (SEND/POST/PUBLISH/PAY/CHARGE/
  TRANSFER/NOTIFY/INVITE/REPLY/FORWARD/MERGE/DEPLOY/EXECUTE) → irreversible; DELETE/PURGE/
  EMPTY_TRASH → irreversible unless the description mentions restore/trash/undo (then
  compensable); compensable verbs (CREATE/ADD/INSERT/UPDATE/PATCH/MOVE/ARCHIVE/LABEL) or
  `updateHint` + an id-shaped schema property → compensable; read verbs (GET/LIST/SEARCH/FETCH/
  READ/FIND/DESCRIBE) → reversible; else unknown. Every reason names its evidence
  (`verb:SEND`, `hint:readOnlyHint`, `desc:"irreversible"`, `schema:id-param`). D23's
  `createHint`+`openWorldHint` boost on send-type verbs is implemented (confidence bump +
  a named reason). Also exports `tokensFromSlug` and a `classifyTools(tools)` batch helper keyed
  by slug.
- `rulesCommand.ts` — `rulesCommand({ snapshotDir, toolkits }): Promise<CommandResult>`. `null`
  toolkits → every slug via `listSnapshotSlugs`. Prints a table (`slug`, `tier (derived)`, `class`,
  `confidence`, `reasons`) sorted by tool slug. Missing/invalid toolkit(s) → included in the output
  message with a nonzero exit code (1 if some toolkits still resolved, 2 if none did, or if the
  snapshot dir is empty and `toolkits` was `null`). **Not wired to a CLI flag** — that's issue #4's
  job per the brief; `program.ts`/`cli.ts`/`classifyCommand.ts`/`llm*` were not touched.

### Tests (191 total, well over the ≥40 bar)

- `hints.test.ts` (12 tests): all-known-tags mapping, empty-tags defaults, raw passthrough
  (including `deleteHint`, which isn't in the known set), real fixture checks on
  `GMAIL_SEND_EMAIL` (D23 tags) and `GMAIL_DELETE_LABEL`, and `deriveTier` for all 3 tiers plus
  "always derived".
- `rules.test.ts` (170 tests): `tokensFromSlug` unit tests; an `it.each` table covering every
  slug named in the issue (`GMAIL_SEND_EMAIL`, `GMAIL_DELETE_LABEL`, `SLACK_DELETE_CANVAS`,
  `GOOGLECALENDAR_ACL_DELETE`, `GOOGLECALENDAR_CALENDAR_LIST_DELETE`, `GMAIL_LIST_MESSAGES`,
  `SLACK_LIST_ALL_USERS`, `SLACK_CHAT_POST_MESSAGE`, `GMAIL_FORWARD_MESSAGE`,
  `GMAIL_REPLY_TO_THREAD`, `GITHUB_MERGE_A_BRANCH`, `SLACK_INVITE_USERS_TO_A_SLACK_CHANNEL`,
  `NOTION_ARCHIVE_NOTION_PAGE`, `GMAIL_ADD_LABEL_TO_EMAIL`, `NOTION_MOVE_PAGE`,
  `GOOGLECALENDAR_CREATE_EVENT`, `NOTION_CREATE_VIEW_QUERY`) loaded from the real trimmed fixture
  via `readToolkitFile`-shape JSON parsing rooted at `findRepoRoot()` (never cwd); synthetic edge
  cases (DELETE+trash/undo mention → compensable, PURGE/EMPTY_TRASH with no restore → irreversible,
  no-verb → unknown, readOnlyHint overriding both a compensable and an irreversible verb,
  updateHint+id-param without a verb token, every remaining verb in each of the 4 verb sets,
  confidence-boost checks for D23 and the description-irreversible keyword, and a confidence-clamp
  check); a dedicated `it.each` over **all 125** trimmed-fixture tools asserting a valid class,
  confidence in `[0,1]`, and ≥1 reason; a `classifyTools` batch/keying test.
- `rulesCommand.test.ts` (9 tests): all-toolkits table shape and header text (`tier (derived)`,
  never `(real)`), a specific row assertion for `GMAIL_SEND_EMAIL`, single/multi-toolkit
  filtering, single missing toolkit, mixed valid+missing (exit 1), all-missing (exit 2), and an
  empty snapshot dir with `toolkits: null` (exit 2).

## Deviation from the brief — please read

**`classification.ts` fails `prettier --check`, by design.** The brief requires it to be
byte-identical (including spacing) to a single-line interface body:
```ts
export interface ClassifierResult { class: ReversibilityClass; confidence: number; reasons: string[] }
```
Prettier (project config: `printWidth: 100`) reformats that interface onto 5 lines. The brief's
instructions on this point are two clauses that read as alternatives ("add it to
`.prettierignore` **only if** prettier would reformat it — prefer checking `prettier --check`
first; **if it would reformat, tell me in your handoff rather than editing other files**"). I
took the second, more specific clause as controlling — `.prettierignore` is outside the "own
only" file list for this issue — and did **not** edit `.prettierignore`. Net effect:
- `npx prettier --check --end-of-line auto packages/audit/src` exits 1, citing only
  `classification.ts`.
- Every other file in the diff (including the two other new source files and all three test
  files) is prettier-clean.

**Action needed from you (Krish) or the next session:** decide whether to (a) add
`packages/audit/src/classification.ts` to `.prettierignore`, (b) accept the byte-identical file as
a standing `prettier --check` exception, or (c) relax "byte-identical" and let prettier reformat
it (functionally identical either way — it's a type-only file). I did not make this call myself
since it touches a file outside issue #3's scope.

## Green gate

Run from repo root (`C:\Users\User\_worktrees\tool-reversibility-issue-3`):
- `pnpm i --frozen-lockfile` — clean install, no errors.
- `pnpm -r lint` — clean (both `apps/inbox` and `packages/audit`).
- `pnpm -r test` — **234 passed, 1 skipped** (the pre-existing `live.test.ts` skip), across both
  workspaces; the 191 new tests are all green.
- `pnpm -r build` — clean (`tsc --noEmit` for audit, `next build` for inbox).
- `npx prettier --check --end-of-line auto packages/audit/src` — **fails on
  `classification.ts` only**, as described above (intentional, see Deviation section).

## Commits on this branch (this session)

1. `55b13b3` feat(audit): D1 classification types + hints/tier derivation (D6/D22)
2. `0dd3440` feat(audit): pure rule-based reversibility classifier (rules.ts)
3. `6fab148` feat(audit): rulesCommand table output over toolkit snapshots

No push was performed (per harness rule); branch is local-ahead of `origin/krish/issue-2` only in
the sense that this worktree's `krish/issue-3` branch was pre-created off `e687a9a` before this
session started (I did not create it, so I did not touch any board/label "started" state — see
Board status below).

## Board status

- **Issue:** #3 "Hints/tier extraction + rule-based reversibility classifier (table-tested)",
  label `sonnet`, no `status:*` labels exist in this repo (checked `gh label list`) and no
  GitHub Projects v2 board is attached to `KrishP147/tool-reversibility` (checked
  `gh project list --owner KrishP147`: only `HTN-2026 Board` and `NutriSync` exist, unrelated
  repos). So there is nothing to move — no board/label action was taken, per the "no board: skip"
  rule. I did not post a "Started on branch" comment either, since I was handed an
  already-created branch rather than creating it myself (rule only applies when the implementer
  creates the branch).
- **Completeness:** all three "Done when" checkboxes on the issue are satisfied. I did not check
  the boxes on the issue itself or close it — that's normally the verifier/orchestrator's call,
  and I have no board to move a card on.
- **Deviations from the issue text:** none in substance. The one process deviation is the
  `classification.ts`/prettier situation above, which is a deviation from the *literal* combined
  instruction text I was given (not from the GitHub issue, which doesn't mention prettier).
- **Ideas / things noticed, not in the issue:**
  - The rule for DELETE/PURGE/EMPTY_TRASH ("irreversible unless description mentions
    trash/restore/undo") is deliberately literal per the spec, but it means an `EMPTY_TRASH`-verb
    tool whose description naturally says "trash" (because that's literally what it operates on)
    will read as **compensable** even when there's no real undo path. Documented as a code comment
    above `RESTORE_KEYWORDS` in `rules.ts`, and covered by a test that shows the (correct, but
    maybe-surprising) synthetic-tool behavior. Worth a note in issue #5 (compare/spot-check) if
    the LLM classifier disagrees with rules on any real `*_EMPTY_TRASH`-shaped tool.
  - `rulesCommand`'s table is intentionally plain-text/monospace via `padEnd`, not Markdown —
    issue #5's `report.ts` (REPORT.md generation) may want its own Markdown table formatter rather
    than reusing this one verbatim, since this one isn't GFM-table-shaped.
  - `classifyTools(tools)` (batch helper, slug-keyed) exists in `rules.ts` in case issue #5's
    compare/report step wants to classify a whole toolkit file's `tools[]` in one call rather than
    looping `classifyTool` itself — small convenience, not required by #3.

## Suggested skills for the next session

- `next` — to confirm issue #4 (LLM classifier) or #5 (compare/report) is next per the board/plan
  ordering, and to re-check whether a board exists by then.
- `consult-plan` — if the next session wants to change the DELETE/PURGE/EMPTY_TRASH heuristic
  noted above, or the `.prettierignore` decision, grill it against `skilleddocs/plan.md` first.

## Key files (absolute paths)

- `C:\Users\User\_worktrees\tool-reversibility-issue-3\packages\audit\src\classification.ts`
- `C:\Users\User\_worktrees\tool-reversibility-issue-3\packages\audit\src\hints.ts` /
  `hints.test.ts`
- `C:\Users\User\_worktrees\tool-reversibility-issue-3\packages\audit\src\rules.ts` /
  `rules.test.ts`
- `C:\Users\User\_worktrees\tool-reversibility-issue-3\packages\audit\src\rulesCommand.ts` /
  `rulesCommand.test.ts`
- Spec: `skilleddocs/plan.md` §3a (Hints/Rules), §7 (D1/D2/D6), §10 (D22/D23)
- Fixtures used: `fixtures/catalog/trimmed/{gmail,slack,googlecalendar,notion,github}.json`
