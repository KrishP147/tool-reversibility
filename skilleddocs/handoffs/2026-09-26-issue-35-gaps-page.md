# Handoff: issue #35 — /gaps page

Date: 2026-09-26
Branch: `krish/issue-35` (worktree `C:\Users\User\_worktrees\tool-reversibility-issue-35`)
Status: **complete**, ready for review/merge. Not pushed (per instructions).

## What was done

Implemented [issue #35](https://github.com/KrishP147/tool-reversibility/issues/35) in full: a
read-only `/gaps` page and `/gaps/[slug]` detail in `apps/inbox`, sourced from
`reports/report.json` only.

Commits (newest last) on `krish/issue-35`, on top of `0cc33f9`:
1. `e363424` feat(inbox): lib/gaps.ts, read-only report.json slices for /gaps
2. `3b00ad6` feat(inbox): /gaps list + /gaps/[slug] detail pages
3. `b893620` feat(inbox): nav link from / to /gaps
4. `5149402` feat(inbox): screenshots.ts captures gaps.png
5. `e745b7b` docs: mention /gaps under the inbox section

Files touched (all within the issue's declared ownership — nothing in
`packages/audit/**`, `reports/`, `fixtures/**`, `plan.md` was touched):
- `apps/inbox/lib/gaps.ts` (+ `gaps.test.ts`, 13 unit tests)
- `apps/inbox/app/gaps/page.tsx`, `GapsTable.tsx`, `ToolkitSummaryTable.tsx`, `StampBlock.tsx`
  (+ 3 `.test.tsx` files, 5 component tests)
- `apps/inbox/app/gaps/[slug]/page.tsx`, `GapDetail.tsx` (+ `.test.tsx`, 3 component tests)
- `apps/inbox/app/page.tsx` — one nav link (`<a href="/gaps">`), no other change
- `apps/inbox/scripts/screenshots.ts` — one added capture (`gaps.png`); **script was not run**
  this session (instructed: manager decides), so `docs/img/gaps.png` does not exist yet
- `README.md` — one paragraph + `![Gaps page](docs/img/gaps.png)` under the inbox section

## Design notes (for whoever reviews)

- `lib/gaps.ts` reads `reports/report.json` itself (own `fs.readFileSync` + `findRepoRoot`,
  module-level cache keyed by resolved path) rather than reusing `lib/report.ts`'s `loadReport`.
  Reason: `lib/report.ts`'s `Report`/`ToolReport` types (and its stub fallback) only cover the
  per-action lookup the existing inbox needs, and the issue's ownership list excludes
  `lib/report.ts` from this change. Extending its types felt like scope creep the issue didn't
  ask for; a second, narrow reader was simpler and doesn't touch shared code.
- Stub-safety: unlike `lib/report.ts` (which falls back to a bundled stub JSON), `lib/gaps.ts`
  treats a missing file **or** `stub: true` as `{ available: false }`. The bundled stub has no
  `stamp`/`totals`/`perToolkit`/`topGaps` blocks, so there's nothing gap-shaped to show — "no
  report yet" is the honest state per plan.md D31/D36 (no invented numbers).
- The top-50 gaps table in `report.json`'s `topGaps.rows` doesn't carry `tier`/`hints`/`reasons`
  (only `confidence`/`tags`/`reason` singular); `getGapsSummary` looks each row's slug up in the
  full `tools[]` array to enrich it with `hints` (as a list of true hint-tag names), `tier`,
  `tierSource` and `reasons`, matching the issue's required table columns.
- `singleGap`/`gap` on the detail page are computed in `lib/gaps.ts` from `ruleClass` +
  `hints.destructiveHint` + `llmClass` + the report's `stamp.llmStatus`, mirroring
  `packages/audit/src/explainCommand.ts`'s `isGap`/`isSingleGapRules` logic (D2/D46) without
  importing that package. `gap` is only ever true when `llmStatus === "live"`.
- Detail page: unknown slug → `notFound()`; no real report at all → friendly inline message
  (same amber banner style as the inbox's stub banner), not a 404, since that's a data-availability
  state, not a routing one.
- `README.md` change adds no new hard-coded numbers; `pnpm check:stamped` passes.

## Verification run this session

- `pnpm --filter inbox test` → 22 files / 94 tests passed (73 pre-existing + 21 new).
- `pnpm --filter inbox lint` → clean.
- `pnpm --filter inbox build` (no env) → succeeds; `/gaps` and `/gaps/[slug]` both render as
  dynamic (ƒ) routes, matching the "no static prerender" requirement.
- `pnpm check:stamped` → ok (4 files scanned).
- `pnpm exec prettier --check --end-of-line auto` on every changed/added file → all pass.

## Not done / deliberately left for the manager

- **`docs/img/gaps.png` does not exist.** The screenshot script (`apps/inbox/scripts/screenshots.ts`)
  has the new `gaps.png` capture wired in (after `detail-update.png`, same pattern: build, boot
  `next start` on a free port in mock mode, `page.goto` + `page.screenshot`), but per the task
  instructions this session did not run `pnpm --filter inbox screenshots` — that decision was
  left to the manager. Until it's run, the `![Gaps page](docs/img/gaps.png)` embed in README.md is
  a broken image link. **Next step:** run `pnpm --filter inbox screenshots` once (builds + boots +
  captures all 5 images including `gaps.png`), then `git add docs/img/gaps.png` and commit.
- Nothing else outstanding against the issue's "Done when" checklist — all other items verified
  above.

## Board status

No GitHub Projects board item exists for this repo/issue (`gh issue view 35 --json projectItems`
returned an empty array), and the issue carries no `status:*` label (only `sonnet`). Per the
task's rule ("Created the branch yourself (not handed one)? Mark issue started... no board:
skip"), no board/label move was made — the worktree and branch `krish/issue-35` already existed
when this session started, so it wasn't this session's branch to announce as started, and there
is no board to move a card on regardless.

Task is **complete**, not partial/blocked. No deviations from the issue's checklist beyond the
design choices noted above (all within the issue's stated ownership and constraints). No new
ideas/innovations surfaced beyond what's captured in the design notes above.

## Suggested skills for the next session

- None needed to pick up remaining work — it's a single manual step (run the screenshot script,
  commit the PNG). If a verifier session picks this up, the `code-review` skill would be a
  reasonable independent check of the diff before merge.
