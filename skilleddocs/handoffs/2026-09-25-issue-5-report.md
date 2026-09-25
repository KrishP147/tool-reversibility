# Handoff: issue #5, compare + stamped report + spot-check labels

Branch `krish/issue-5` (worktree `C:\Users\User\_worktrees\tool-reversibility-issue-5`), base `main` 6514548. Not pushed, no PR.

## Commits
- 23b2188 `fixtures/labels/spotcheck.json`: 74 blind labels (20 irreversible / 21 compensable / 18 reversible / 15 unknown; 55 from EC apps; no deprecated tools). Commit message says 75, the file has 74.
- a08013c `packages/audit/src/{compare,spotcheck}.ts` + tests: D2 GAP, rules-only single gap, 4x4 confusion, per-toolkit stats, top-gap ranking, seeded (mulberry32) disagreement sample, per-class P/R.
- 30e305e `report.ts`, `reportCommand.ts` + tests; `report` wired in `cli.ts`; help text; inbox `Report` gets optional `stamp?`/`llmStatus?`; `.gitignore` adds `reports/full/`.
- 43f6596 `reports/REPORT.md` + `reports/report.json`, generated from a clean tree at 30e305e (`dirty: false`, `llmStatus: "recorded"`, `model: "pending"`).
- 8fb10d0 README/PROPOSAL: rules-only keys filled with `[report 2026-09-24, commit 30e305e]`; README CLI table now says `report` works; `reports` added to `.prettierignore`.

## How it behaves
- `pnpm audit:cli report --snapshot <dir>` reads one toolkit file at a time. It classifies with the rules, and reads LLM results from `fixtures/llm-cache/<model>` only (never the API). `llmStatus` is `live` only when every non-deprecated tool has a `provenance: "live"` entry; otherwise it is `recorded` or `pending`, and every LLM key (`llm.*`, `agreement`, `gap`, `confusion`, `perToolkit.*.irreversible|gap`, LLM P/R, disagreement sample) is left out of report.json. REPORT.md shows `[[pending live run]]` in those places.
- Population: non-deprecated tools. Deprecated tools are only counted in `totals.deprecatedExcluded` (D28).
- `perToolkit.<ec>` always has `tools`, `rulesIrreversible` and `singleGap`. `irreversible` (both classifiers) and `gap` only appear once the run is live, because PROPOSAL's column is headed "irreversible (both)".
- `tools[]` holds only non-deprecated tools from the 8 EC apps plus the `fixtures/pending` slugs (1,622 rows, about 940 KB). Until the run is live, `llmClass` is `"unknown"` and `agree` is `false`, and the inbox badge falls back to `ruleClass` because unknown has the lowest caution rank. The full CSV goes to `reports/full/tools.csv` (gitignored).
- Full run: 17 s. Rules-only numbers are in `reports/REPORT.md`. On the spot-check, rules score precision 0.64 and recall 0.8 on irreversible, and recall 0.133 on unknown (the meta/arbitrary-execute tools mostly come out compensable or irreversible).

## Green gate (run 2026-09-25, all pass)
`pnpm i --frozen-lockfile && pnpm -r lint && pnpm -r test && pnpm -r build && pnpm check:stamped`, and `pnpm exec prettier --check --end-of-line auto packages apps`.

## Not done / next
- The live LLM pass (D11, needs approval and spend). After it: `pnpm audit:cli report --snapshot fixtures/catalog/2026-09-24` from a clean tree, commit the reports, then fill the `gap.*`/`agreement.rate`/`perToolkit.*` placeholders and the headline. `pnpm check:stamped` will flag every one of them once `llmStatus` is `live`.
- Krish needs to review the labels in `fixtures/labels/spotcheck.json` (all marked "pending Krish review").
- The report's `regenerate` field prints `--snapshot fixtures/catalog/2026-09-24`. This run actually read the main clone's copy, because the snapshot is gitignored and lives only in `C:\Users\User\tool-reversibility`.

## Suggested skills
- `update-progress` (fresh session, input this doc), `consult-plan` for the deviations below.

## Board status
- Issue #5: **partial by design.** Stages A to E are all done. The issue's "headline filled from the data" part is still blocked on the approved live LLM run (D11/D31). The issue is not on a Projects board and has no `status:*` labels, so no card was moved.
- Deviations:
  - The labels were made by the implementer, not Krish. They are blind and flagged for review.
  - `perToolkit` adds `rulesIrreversible`/`singleGap` keys, and `irreversible` means "both classifiers" (live only).
  - `reports/` is prettier-ignored.
  - The CSV lives at `reports/full/tools.csv`.
- Ideas:
  - An `unknown` gold class shows the rules misfiling meta-tools (`*_EXECUTE_*`, GraphQL, workflow dispatch) as compensable or irreversible. That is a cheap rule to add under #16.
  - The inbox could show a "LLM pending" hint using the new `llmStatus` field.
