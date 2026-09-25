# Stamping convention for Composio numbers

Rule (plan.md §4, CONTRIBUTING.md): no number about Composio's catalog appears in prose unless it
comes from a reproducible, stamped run. `pnpm check:stamped` (`scripts/check-stamped.mjs`, plain
Node, no dependencies) enforces this on `README.md`, `PROPOSAL.md` and `docs/**/*.md`. CI runs it
after Build, together with its `node:test` suite (`scripts/check-stamped.test.mjs`).

## Three ways to write a Composio number

1. **Not measured yet:** write `[[pending live run]]`. The headline stays like this until a live
   classifier run exists.
2. **Comes from the report:** write `[[report:KEY]]`, and link
   [reports/REPORT.md](../reports/REPORT.md) in the same file. `KEY` is a dotted path into
   `reports/report.json` (issue #5). Allowed keys:
   - `totals.tools`, `totals.toolkits`, `totals.deprecatedExcluded`
   - `rules.byClass.<class>`, `llm.byClass.<class>`, where class is `reversible`, `compensable`,
     `irreversible` or `unknown`
   - `agreement.rate`
   - `gap.M`, `gap.N`, `gap.P` (headline, D2) and `singleGap.rules.M|N|P`
   - `perToolkit.<slug>.<field>`
   - `spotcheck.n`, `spotcheck.rules.precision`, `spotcheck.rules.recall`

   Once `reports/report.json` has a value for a key, the placeholder must be replaced by the value
   plus a report stamp (below). Keys that need the LLM (`llm.*`, `agreement.*`, `gap.*`,
   `perToolkit.*`) only have to be filled once the report says `llmStatus: "live"`. A report built
   from the recorded (synthetic) LLM cache never forces a number into the docs.

3. **Plan-verified snapshot fact:** write the number with a stamp marker **on the same line**.

## Stamp markers

- Snapshot: `[snapshot YYYY-MM-DD, @composio/core X.Y.Z]`. Only snapshots listed in
  `KNOWN_SNAPSHOTS` are accepted. Today that is the 2026-09-24 full fetch with `@composio/core`
  0.21.0 (plan.md §10, D19 to D24). A marker may be wrapped in a link to its source.
- Report: `[report YYYY-MM-DD, commit <hex>]`. It must match `date` and the start of `commit` in
  the `stamp` block of `reports/report.json` (or its top level, if there is no `stamp` block).

"On the same line" means one physical line of Markdown: a paragraph line, a list item or a table
row. A stamp on another line does not cover the number.

## What the checker flags

- Any percentage (`<n>%` or `<n> %`), anywhere, unless the line has a valid stamp.
- A number followed by `tool`, `tools`, `toolkit` or `toolkits`, with up to two words in between
  (`<n> deprecated tools`), or a number right after one of those words (`tools: <n>`).
- Placeholders other than `[[pending live run]]` and `[[report:KEY]]`, keys outside the allowed
  list, and stamp markers that don't match a known snapshot or the current report.
- A file that uses `[[report:KEY]]` but never links `reports/REPORT.md`.

**Code fences and inline code are scanned too**, so a number can't hide in a sample of command
output. CLI flags are handled on purpose instead: the "word then number" rule doesn't fire when the
word is part of a flag (`--max-tools 25`), because a hyphen right before `tools` rules it out.

Known blind spots: numbers written as words, counts of things other than tools and toolkits
(apps, requests, dollars), and a single long line that holds both a stamp and an unrelated number.
Reviewers still read the prose.

## Report stamp fields (issue #5)

The header of `reports/REPORT.md` and the `stamp` block of `reports/report.json` carry:

| field            | meaning                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| `date`           | catalog snapshot date (`YYYY-MM-DD`)                                     |
| `generatedAt`    | ISO timestamp of the report build                                        |
| `commit`         | git commit the report was built from                                     |
| `dirty`          | `true` if the working tree had uncommitted changes                       |
| `sdkVersion`     | `@composio/core` version used for the fetch                              |
| `model`          | LLM model id, or `"pending"` before a live run                           |
| `llmStatus`      | `live` (real model output), `recorded` (synthetic fixtures) or `pending` |
| `promptVersion`  | `classify.v1`                                                            |
| `manifestSha256` | sha256 of the catalog snapshot's `manifest.json`                         |
| `regenerate`     | the exact command that rebuilds the report (`pnpm audit:cli report`, #5) |

Only a report with `llmStatus: "live"` and `dirty: false` should back the headline.
