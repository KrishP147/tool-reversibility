# Handoff: issue #8, PROPOSAL.md + README write-up + stamp check (2026-09-25)

Branch `krish/issue-8` (worktree `C:\Users\User\_worktrees\tool-reversibility-issue-8`, base `main` 47fb027). Local commits only; not pushed, no PR.

## State: complete for agent scope; numbers wait on #5 + the live LLM run
Commits (`git log 47fb027..krish/issue-8`): 7103dee check script + test + CI step; c1c2b9a `docs/stamping.md`; 39416ee `PROPOSAL.md`; b3e375b README.

- `scripts/check-stamped.mjs` (plain Node, no deps) and `scripts/check-stamped.test.mjs` (node:test, 20 cases covering pass + every fail case). Root script `pnpm check:stamped` = test suite, then the scan. CI step "Stamp check" runs after Build. Convention and allowed report keys: `docs/stamping.md`.
  - Scans `README.md`, `PROPOSAL.md`, `docs/**/*.md`. Code fences are **not** skipped; CLI flags are handled by a `(?<![\w-])` lookbehind (`--max-tools 25` passes).
  - Citation = a known snapshot marker `[snapshot 2026-09-24, @composio/core 0.21.0]` (`KNOWN_SNAPSHOTS`) or a report marker `[report <date>, commit <hex>]` that matches `reports/report.json`, on the **same physical line**.
  - A leftover `[[report:KEY]]` fails once report.json has the key. For LLM-dependent keys (`llm.*`, `agreement.*`, `gap.*`, `perToolkit.*`) this only applies once `stamp.llmStatus === "live"`, so a recorded/synthetic report never forces numbers into docs. The literal `[[report:KEY]]` is exempt, since the docs use it to name the syntax.
- `PROPOSAL.md` follows plan §3c. The posting note (D12) is an HTML comment at the top. All links are absolute GitHub URLs so it can be pasted as-is. New evidence: `GMAIL_CREATE_EMAIL_DRAFT` has tags **identical** to `GMAIL_SEND_EMAIL`, while `GMAIL_SEND_DRAFT` does carry `destructiveHint` (committed trimmed fixture, cited with a snapshot stamp).
- README contains the pitch, the pending headline linking `reports/REPORT.md`, plan-verified snapshot facts (stamped), repro steps, a table of the current CLI state, the mock inbox, limitations, Zephyr and the ownership note, a GIF placeholder, and MIT / not-affiliated.

## Green gate (run 2026-09-25, this worktree)
`pnpm i --frozen-lockfile && pnpm -r lint && pnpm -r test && pnpm -r build && pnpm check:stamped`: all exit 0. audit: 271 passed, 1 skipped. inbox: 39 passed. Stamp suite: 20 passed. `pnpm exec prettier --check --end-of-line auto README.md PROPOSAL.md docs scripts` is clean. `pnpm exec eslint scripts` is clean (it needs a `/* global process, console */` line; `pnpm -r lint` doesn't cover the root).

## Contract for #5 (read this before merging #5 or #8 second)
- report.json key paths must match `KEY_PATTERNS` in `scripts/check-stamped.mjs`. PROPOSAL uses `perToolkit.<slug>.{tools,irreversible,gap}` for gmail, outlook, slack, googlesheets, googlecalendar, googledrive, github and notion. If #5 picks different field names or slugs, update PROPOSAL and `KEY_PATTERNS` together.
- The checker reads stamp fields from `report.stamp` (falling back to the top level): `date`, `commit`, `llmStatus`. The full field list is in `docs/stamping.md`.
- Once #5 lands with a rules-only report, `pnpm check:stamped` **will fail** on README and PROPOSAL for `totals.*` and `spotcheck.*`. That is intended: fill those in with `[report <date>, commit <sha>]` markers.

## Not done / next
- HUMAN (Krish): the Devpost link (`TODO(Krish)` in README), the demo GIF, reviewing the Zephyr ownership wording, and posting PROPOSAL after the Litmus submit (D12).
- After #5 plus the approved live run: fill the placeholders and flip the headline.
- README's CLI table says `classify --rules` still prints "not implemented (#3)" (true on main 47fb027). If #5 wires it up, update that row.

## Suggested skills
- `update-progress` (with this doc); `code-review` on `47fb027..krish/issue-8`.

## Board status
- Issue #8 has no Projects v2 item and no `status:*` labels (only `opus`), so there was nothing to move. The branch was handed over already created, so I posted no "Started" comment.
- Complete for agent scope. The "Krish has reviewed it" and number-filling parts are blocked on a human and on #5.
- Deviations: the tier and spotcheck keys follow the brief's contract. I added a `perToolkit` field naming (`tools`, `irreversible`, `gap`) that #5 must match. The literal `[[report:KEY]]` is exempt.
- Ideas: a `check-stamped --fill` mode could substitute report values and append the report marker automatically. `KNOWN_SNAPSHOTS` could be read from committed manifests instead of hard-coded.
