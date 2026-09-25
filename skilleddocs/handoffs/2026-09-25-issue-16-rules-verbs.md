# Handoff: issue #16 — Rules: add missing verbs + reduce noun-as-verb noise

Date: 2026-09-25 · Branch: `krish/issue-16` (base `6514548`, worktree already at that commit —
branch was handed to me pre-created, not created by me) · Repo: `KrishP147/tool-reversibility`

## Status: complete

All acceptance criteria in the kickoff brief are met. Green gate is fully green, no exceptions.

## What was built

Own-only scope, both files touched (`packages/audit/src/rules.ts`, `rules.test.ts`); `hints.ts`
did not need changes. One commit: `298d9cd`.

### `rules.ts`

- **New verb table entries** (D27 from `skilleddocs/plan.md` §7/§11):
  - `WATCH`, `DUPLICATE`, `SET`, `UNARCHIVE` added flatly to `COMPENSABLE_VERBS` — each has a
    plain inverse (unwatch, discard the copy, re-set the old value, re-archive), no description
    check needed.
  - `REMOVE_REVOKE_VERBS` (new tier 2c, between the DELETE-family branch and the compensable-verb
    loop): default `compensable` (an add/grant inverse exists), unless the description matches
    the existing `IRREVERSIBLE_KEYWORDS` list (reused as-is, per the brief) — then `irreversible`.
  - `ABORT_CANCEL_VERBS` (new tier 2d): default `compensable` (nothing external happened yet);
    `irreversible` when the description matches either `IRREVERSIBLE_KEYWORDS` or a new
    `INFLIGHT_KEYWORDS` list ("in progress", "in-flight", "ongoing", "already running",
    "underway", "cannot/can't be resumed") — the migration-abort example from the brief.
- **Noun-as-verb masking** (`maskNounSendPost`, applied to tokens before all tiers run in
  `classifyTool`): a `SEND`/`POST` token is masked to a non-matching sentinel when it follows a
  `PATCH`/`UPDATE`/`GET`/`LIST`/`CREATE` token anywhere earlier in the slug
  (`GMAIL_PATCH_SEND_AS` → `PATCH` wins → compensable). `SEND` specifically is also masked
  whenever the slug contains `UPLOAD`, regardless of position — this is the documented,
  deliberately narrow fix for `NOTION_SEND_FILE_UPLOAD`: it "sends" bytes to a file-upload object
  created by an earlier call, so masking `SEND` lets it fall through to the existing
  `updateHint`+id-param compensable rule (tier 3b) instead of being read as a communication verb.
  The rationale and its narrow scope (SEND-only, not a blanket `*_UPLOAD` rule) are documented in
  a code comment directly above `maskNounSendPost`.
- Precedence order is now: `readOnlyHint` → irreversible verbs → DELETE-family (conditional) →
  REMOVE/REVOKE (conditional) → ABORT/CANCEL (conditional) → compensable verbs → updateHint+id →
  read verbs → unknown. D26 (explicit no-way-back text beats restore keywords) is untouched.
  `classification.ts` types are untouched.

### `rules.test.ts`

36 new test cases across 5 new `describe` blocks (all table-driven `it.each` plus a few
reason-string assertions), well over the ≥15 bar:
1. `issue #16 — missing verbs resolve fixture unknowns (D27)` — 11 fixture cases (the 9 originally
   unknown tools + `GMAIL_PATCH_SEND_AS` + `NOTION_SEND_FILE_UPLOAD` reclassified from
   irreversible) plus 4 reason-string checks plus the `GOOGLECALENDAR_CALENDAR_LIST_WATCH` test
   below.
2. `GOOGLECALENDAR_CALENDAR_LIST_WATCH is compensable (WATCH), not reversible (LIST)` — documents
   a deliberate side-effect reclassification (see below).
3. `REMOVE/REVOKE default compensable, override on keyword` — 4 synthetic cases.
4. `WATCH/DUPLICATE/SET/UNARCHIVE are flat compensable` — 4 synthetic cases.
5. `ABORT/CANCEL depend on in-flight description` — 4 synthetic cases + 1 reason check.
6. `noun-as-verb masking for SEND/POST` — 5 synthetic cases + 2 regression/scope-boundary checks
   (`POST` still fires when not preceded by a qualifying verb; the UPLOAD-paired mask is scoped to
   `SEND` only, not `POST`).

Every existing test still passes unmodified — no existing assertion needed updating.
`rulesCommand.test.ts` was not touched (it doesn't pin an exact table snapshot, only structural
assertions — header text, row counts, specific-slug substring checks — none of which changed).

## Trimmed-fixture (125 tools) class counts

| class | before (baseline given in brief) | after |
|---|---|---|
| unknown | 9 | **0** |
| compensable | 44 | **53** |
| reversible | 53 | **52** |
| irreversible | 19 | **20** |

Total stays 125. Unknown count goes to zero as required.

Per-tool resolution of the 9 originally-unknown tools:
- → **irreversible** (3): `GITHUB_ABORT_REPOSITORY_MIGRATION` (ABORT, description says
  "queued or in progress" / "ongoing"), `GITHUB_REMOVE_TEAM_MEMBERSHIP` (REMOVE, description
  literally says "This action is irreversible"), `SLACK_REVOKE_FILE_PUBLIC_SHARING` (REVOKE,
  description literally says "is irreversible").
- → **compensable** (6): `GOOGLECALENDAR_ACL_WATCH`, `GOOGLECALENDAR_EVENTS_WATCH`,
  `GOOGLECALENDAR_SETTINGS_WATCH` (WATCH), `NOTION_DUPLICATE_PAGE` (DUPLICATE),
  `SLACK_SET_USER_PRESENCE` (SET), `SLACK_UNARCHIVE_CHANNEL` (UNARCHIVE).

Two additional reclassifications from the noun-noise fix (neither was in the "unknown" list —
both were already, incorrectly, `irreversible` via a spurious `SEND` match):
- `GMAIL_PATCH_SEND_AS`: irreversible → compensable (`PATCH` is the real verb).
- `NOTION_SEND_FILE_UPLOAD`: irreversible → compensable (routes to updateHint+id-param).

One unplanned side effect, verified correct and covered by a dedicated test:
- `GOOGLECALENDAR_CALENDAR_LIST_WATCH`: reversible → compensable. Before this change nothing
  matched except the `LIST` read-verb (misclassifying a tool that registers a push-notification
  channel — a real side effect, undone by stopping the channel — as if it were a no-op read).
  `WATCH` now wins per the same tier-precedence that already lets `DELETE` beat `LIST` in
  `GOOGLECALENDAR_CALENDAR_LIST_DELETE` (issue #3). This is a correctness improvement, not a
  regression, but flagging it explicitly since it wasn't named in the brief's acceptance list.

## Green gate (run from repo root)

All green, no exceptions:
- `pnpm i --frozen-lockfile --offline` — clean.
- `pnpm -r lint` — clean (both workspaces).
- `pnpm -r test` — **audit: 307 passed, 1 skipped** (pre-existing `live.test.ts` skip);
  **inbox: 41 passed**.
- `pnpm -r build` — clean (`tsc --noEmit` for audit, `next build` for inbox).
- `pnpm check:stamped` — ok (3 files, 20/20 sub-tests).
- `npx prettier --check --end-of-line auto packages apps` — clean (had to run
  `prettier --write` once on `rules.test.ts` after adding the new tests; committed already
  formatted).

## Commits on this branch (this session)

1. `298d9cd` feat(audit): add REMOVE/REVOKE/WATCH/DUPLICATE/SET/UNARCHIVE/ABORT/CANCEL verbs, mask
   noun SEND/POST (#16/D27)

No push performed (harness rule). Branch `krish/issue-16` was already at `main`'s tip (`6514548`)
when this session started — I did not create it, so per the brief's rule ("Created the branch
yourself? ... no board: skip") I did not touch board state or post a "Started on branch" comment.

## Deviations from the brief

None in substance. One judgment call worth flagging: the brief's acceptance criteria describe
REMOVE/REVOKE/ABORT/CANCEL behavior in terms of what the *tool actually does*, but the concrete
implementation is mechanical (regex/substring match against `IRREVERSIBLE_KEYWORDS`/
`INFLIGHT_KEYWORDS` in the description). This means `SLACK_REVOKE_FILE_PUBLIC_SHARING` classifies
as `irreversible` because its description happens to say "is irreversible", even though revoking
public sharing could arguably be reversed by re-sharing. I followed the brief literally here
(reuse `IRREVERSIBLE_KEYWORDS`, description wins) rather than second-guessing the tool's own
self-description — same spirit as D26's existing precedence rule. Worth a note for issue #5
(compare/spot-check) if the LLM classifier disagrees.

## Suggested skills for the next session

- `next` — to confirm what's next on the board (issue #4/#5/#6 per `plan.md` §6 ordering).
- `consult-plan` — if a future session wants to relax the "description keyword wins" behavior for
  REVOKE-type tools noted above, grill it against `plan.md` first before changing `rules.ts`.

## Key files (absolute paths)

- `C:\Users\User\_worktrees\tool-reversibility-issue-16\packages\audit\src\rules.ts`
- `C:\Users\User\_worktrees\tool-reversibility-issue-16\packages\audit\src\rules.test.ts`
- Spec: `skilleddocs/plan.md` §3a, §7 (D26), §11 (D27); GitHub issue #16 (dup of the now-closed
  #18); prior handoff `skilleddocs/handoffs/2026-09-24-issue-3-rules.md`.
