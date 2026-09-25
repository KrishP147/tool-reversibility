# fixtures/llm-recorded

Synthetic stand-ins for Message Batches results. **Not model output.** No API key was used and no model was called (D11).

- `trimmed.answers.json`: one answer per tool in `fixtures/catalog/trimmed`, from a slug-verb heuristic.
- `batch-results.sample.jsonl`: result lines in the real JSONL shape, one per outcome (`succeeded`, `refusal`, `errored`, `expired`, `canceled`), for the first 25 non-deprecated trimmed tools packed 5 per request.

`fixtures/llm-cache/claude-sonnet-5/` is replayed from `trimmed.answers.json`; every entry there is stamped `"provenance": "recorded"`. Dry runs and `--live` runs treat recorded entries as misses, and `classify` prints a note whenever it uses them. Replace them with a real `--live` run (after the user approves the dry-run cost) before any number goes into a report.

Regenerate: `pnpm --filter audit fixture:llm`.
