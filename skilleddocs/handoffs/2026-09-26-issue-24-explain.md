# Handoff: issue #24, `audit:cli explain <slug>` (2026-09-26)

## State
Branch `krish/issue-24`, worktree `C:\Users\User\_worktrees\tool-reversibility-issue-24`, 3 commits on top of `main` (`d1b90cb`):
- `4107d19` feat(audit): wire explain command into program/cli (#24)
- `ae8cbcb` feat(audit): explain command (#24)
- `aa43f5c` docs(readme): explain command row + example (#24)

All acceptance items from the issue are done:
1. `packages/audit/src/explainCommand.ts` (new): `explainCommand(args, deps)` prints, per tool slug:
   toolkit; raw `tags[]` -> the 7 known hints via `deriveHints` (plus `otherTags`); derived tier via
   `deriveTier` (always "derived", D20/D22); rule classifier class/confidence/reasons via
   `classifyTool`; the LLM cache state for the current model (`--model`, else `CLASSIFIER_MODEL`,
   else `DEFAULT_CLASSIFIER_MODEL`) + `PROMPT_VERSION`, looked up on disk only via
   `cacheKey`/`readCache` (never the API) — `live` (shows class + rationale), `recorded` (labelled
   `recorded-synthetic — NOT a model verdict`, its class shown as "recorded class (synthetic, not
   the LLM's verdict)", never presented as the live verdict, per D31), or `miss`; GAP (`isGap` from
   `compare.ts`, which already requires a non-null `llm` — I only pass the LLM result through when
   `provenance === "live"`, so a recorded hit can never satisfy GAP) and single-gap
   (`isSingleGapRules`, rules+hints only, independent of LLM state); and the spot-check label +
   rationale when the slug is in `fixtures/labels/spotcheck.json`.
2. Unknown slug -> exit 2, message lists the 5 closest slugs by plain Levenshtein edit distance
   (`levenshtein`/`closestSlugs`, both exported), ties broken alphabetically — deterministic, no
   RNG, no external deps.
3. Default snapshot resolution reuses `resolveSnapshotDir` from `classifyCommand.js` (same as
   `classify`/`report`); `--snapshot` overrides it, same semantics as every other command.
4. Plain-text output is an aligned block (`renderPlain`, exported); `--json` (new `ParsedArgs.json`
   flag, parsed in `program.ts`) emits `JSON.stringify(result, null, 2)` of the exact same
   `ExplainResult` object `renderPlain` consumes — no separate JSON-only code path to drift.
5. `packages/audit/src/explainCommand.test.ts` (new, 11 cases), all pinned to `--snapshot
   fixtures/catalog/trimmed` (D33), zero network/API/keys:
   - `GMAIL_SEND_EMAIL` against the real committed `fixtures/llm-cache` (a `recorded` hit there):
     asserts toolkit/hints/tier/rule verdict, the "recorded-synthetic" labelling and that its class
     is never shown as `state: live`, single-gap `yes`, GAP `no (LLM not live for this model)`, and
     the spot-check label/rationale from the real `fixtures/labels/spotcheck.json`.
   - A miss: same slug, `--model claude-does-not-exist` (no cache dir for that model exists) ->
     `state: miss`.
   - A live hit: a temp `cacheRoot` (via `writeCache`) holding one hand-built `provenance: "live"`
     entry keyed by the real `cacheKey(tool)` for `GMAIL_SEND_EMAIL` -> `state: live`, its
     class/rationale shown as the verdict, and GAP flips to `yes` (rules + this live LLM agree,
     no `destructiveHint`).
   - Unknown slug (`GMAIL_SEND_EMALL`, a typo) -> exit 2, exactly 5 comma-separated suggestions
     including `GMAIL_SEND_EMAIL`, and the same call twice produces byte-identical output
     (determinism check).
   - `--json` -> `JSON.parse`d and field-checked, plus a cross-check that `renderPlain(data)` (the
     same function the command itself calls) still reproduces the plain-text block.
   - Missing slug argument -> exit 2, "missing <slug>" usage message.
   - `levenshtein`/`closestSlugs` unit tests (identity, simple edits, deterministic tie-break).
6. `program.ts`: `COMMANDS` gains `"explain"`; `ParsedArgs` gains `slug: string | null` (explain's
   only positional, captured in the parse loop only when `command === "explain"` — other commands'
   stray positionals are still silently ignored, unchanged) and `json: boolean`; `helpText()`
   documents `explain` and `--json`, and extends the `--model`/`--snapshot` option lines to mention
   `explain` alongside `classify`/`report`. `program.test.ts`: updated the `buildProgram()` command
   list assertion to include `"explain"`, and added 3 new `parseArgs` cases (positional slug +
   flags together, slug left `null` with no positional, other commands' stray positionals still
   ignored) plus a `helpText` assertion that it mentions `"explain"`.
7. `cli.ts`: imports `explainCommand` and wires `explain: (a) => explainCommand(a)` into
   `buildProgram`'s handlers, same pattern as `all`.
8. `README.md`: new "**4. Explain one tool.**" section right before the "Current CLI state" table,
   with a `pnpm audit:cli explain GMAIL_SEND_EMAIL --snapshot fixtures/catalog/trimmed` example and
   a prose description of every DONE-WHEN behaviour; new `explain <slug>` row in the CLI status
   table. No new Composio numbers were added (`pnpm check:stamped` passes unchanged, 3 files).

Checks run (memory-critical machine, ran `pnpm --filter audit ...` not `pnpm -r ...`, each once at
the end):
- `pnpm i --frozen-lockfile` (node_modules was missing in this fresh worktree; normal frozen
  install, 294 packages, all satisfied from the pnpm store).
- `pnpm --filter audit test` — **346 passed, 1 skipped** (pre-existing `live.test.ts` skip,
  unrelated), 14 test files (up from 13; `explainCommand.test.ts` added 10 cases +
  `buildExplainResult` describe block = 11 total, plus the 3 new `program.test.ts` cases).
- `pnpm --filter audit lint` — clean.
- `pnpm --filter audit build` (`tsc --noEmit`) — one real type error surfaced and fixed: the new
  positional-capture branch in `program.ts`'s parse loop called `arg.startsWith("--")` where `arg`
  is `rest[i]`, typed `string | undefined` under this tsconfig's strict indexed-access checking;
  added an explicit `arg !== undefined &&` guard. Clean after that.
- `pnpm check:stamped` — 20/20 pass, 3 files scanned.
- `pnpm exec prettier --check --end-of-line auto <every touched/new file>` — `explainCommand.ts`
  and `explainCommand.test.ts` needed one `--write` pass (self-authored, expected); everything
  else (including README.md) was already clean.
- Manually ran the built CLI directly (`pnpm exec tsx src/cli.ts explain ...` from
  `packages/audit`) for a live sanity check of the plain-text block, the unknown-slug suggestion
  list, `--json` output, and `--help`'s new `explain` section — all matched what the automated
  tests assert.

## Deviations from the brief
None substantive. Judgment calls, all within the brief's spirit:
- The brief said "recorded ... do not present its class as the LLM verdict" — I still surface the
  recorded fixture's class and rationale (labelled unambiguously as "recorded class (synthetic, not
  the LLM's verdict)"/"recorded rationale"), rather than hiding it entirely, since the fixture data
  is genuinely useful context and D31's concern is being mistaken for a live verdict, not being
  invisible. The `state:` line and both field labels make the distinction explicit in both plain
  text and JSON (`llm.state` must be checked before trusting `llm.class`/`llm.rationale` as a real
  verdict).
- Explain works on deprecated tools too (not excluded from `loadSnapshotTools`), showing
  `deprecated: true`/`(deprecated)` in the header — the issue didn't say either way; excluding them
  seemed like an arbitrary restriction on a single-tool lookup command, unlike the aggregate
  `report`/`classify --llm` paths that deliberately exclude them from population stats (D28, which
  is about not skewing aggregate stats — not applicable to a per-tool lookup).
- Missing-slug handling (`audit explain` with no positional) exits 2 with a usage message; not in
  the DONE-WHEN list but a natural extension of "unknown slug -> exit 2", covered by one test.

## Findings / ideas not in the issue
- Every one of the 125 tools in the committed `fixtures/catalog/trimmed` fixture has a `recorded`
  (never `live`) cache entry under `fixtures/llm-cache/claude-sonnet-5/` — there is no `live` entry
  anywhere in the repo yet (grep for `"provenance": "live"` across `fixtures/llm-cache/` returns
  nothing). This means `explain` (and `report`) can only demonstrate a real `live` GAP end-to-end
  once an actual `--live` Batches run happens; the `explainCommand.test.ts` "live" case has to
  fabricate one via a temp `cacheRoot` + `writeCache`, which is by design (D11: no agent calls the
  paid API) but worth remembering if a future demo wants to show `explain` printing a *real* live
  GAP against the committed fixture — it can't, today.
- `program.test.ts`'s `buildProgram()` "not implemented" stub test now iterates 5 `COMMANDS`
  including `"explain"` — same pattern noted in the issue #23 handoff for `"all"`: `buildProgram()`
  itself stays command-agnostic; the real handler is wired in `cli.ts` only. Don't be tempted to
  "fix" the stub in `program.ts` for `explain` either — `program.test.ts` pins it deliberately.

## Suggested skills
None needed to continue — this issue is complete, tested, and committed. Per `skilleddocs/plan.md`
§13's polish-backlog order (all -> explain -> demo agent -> write-up -> screenshots), the next item
is the demo agent; use `next` to pull that card, or `planner` if an orchestrator is briefing the
next session.

## Board status
- Issue: `KrishP147/tool-reversibility#24`. **Complete.** All acceptance criteria met, tests/lint/
  build/check:stamped green, manual CLI runs confirm plain-text, `--json`, unknown-slug suggestions
  and `--help` all behave as documented.
- No GitHub Projects v2 board is wired to this issue (`gh issue view 24` shows `projects:` empty),
  and the repo's label set (`gh issue view 24 --json labels` shows only `sonnet`) has no
  `status:todo`/`status:in-progress`/`status:in-review` labels to swap. Per the "no board: skip"
  rule, no card move or label edit was attempted.
- No "Started on branch" comment was posted at branch-creation time this session (branch already
  existed as the worktree's starting state when the session began); noting this so a future session
  posts it up front next time, same gap flagged in the issue #23 handoff.
- Nothing pushed, merged, or force-anything; branch `krish/issue-24` is exactly 3 commits ahead of
  `main` locally in this worktree.
