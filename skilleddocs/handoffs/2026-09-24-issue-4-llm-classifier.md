# Handoff: issue #4, LLM classifier + cache + dry-run cost gate (2026-09-24)

Branch `krish/issue-4` (worktree `C:\Users\User\_worktrees\tool-reversibility-issue-4`, base `e687a9a`). Local commits only: nothing pushed, no PR opened, no Anthropic API call made (no key exists, D11).

## State: complete for agent scope (the spend-gated parts wait on the user)
Commits `0e972dd..fc99561` plus this doc (`git log e687a9a..krish/issue-4`):
- `@anthropic-ai/sdk` 0.128.0 added to `packages/audit` (lockfile committed).
- `packages/audit/src/classification.ts`: byte-for-byte per brief (#3 adds the same). Prettier would reflow it, but CI doesn't run prettier. **Don't run `prettier --write` on it.**
- `packages/audit/src/llm.ts`
  - `PROMPT_VERSION="classify.v1"`, default model `claude-sonnet-5`.
  - Canonical-JSON sha256 cache key (D4, hashed over the FULL tool); cache at `fixtures/llm-cache/<model>/<key>.json`.
  - Param compaction: schemas over 6000 chars become names plus descriptions of at most 160 chars, 80 props max, with `omittedProperties`. Descriptions over 8000 chars are clipped.
  - Token-budget packing: 40k tool tokens per request, 25 tools max, no duplicate slug in a request. An oversized tool goes alone.
  - Batch request: `output_config {effort:"low", format json_schema}`, `thinking {type:"disabled"}`. No temperature, prefill or fallbacks.
  - Outcomes: refusal, max_tokens, errored, expired, canceled, unparseable output, a missing line and a missing slug all become `unknown` (confidence 0, `reasons ["llm: <why>"]`) and are **not cached**.
  - Mapped results use confidence 0.7 and `reasons [rationale, "inverse_tool: X"?]`.
  - `createAnthropicBatchClient` is the only place a client gets constructed.
- `packages/audit/src/costEstimate.ts`: 3.5 chars/token and 80 output tokens per tool. Batch prices: sonnet-5 $1/$5, opus-5 $2.50/$12.50 per MTok (the claude-api skill lists standard prices of $2/$10 and $5/$25; Batch is half).
- `packages/audit/src/classifyCommand.ts` plus flags in `program.ts`/`cli.ts`:
  - Flags: `--rules --llm --dry-run --live --model --snapshot --include-deprecated`.
  - With neither `--rules` nor `--llm`, both run.
  - `--rules` prints `rules: not implemented (#3)` (marked `// TODO(#3)`, because `rulesCommand.ts` isn't on the branch).
  - Without `--live`, any uncached tool gets a refusal and exit 2. `--live` without `ANTHROPIC_API_KEY` also exits 2. The key is never printed.
- `env.ts`: adds `anthropicApiKey()` and `classifierModel()` (`CLASSIFIER_MODEL`).
- `prompts/classify.v1.md`: about 1.5k tokens.
- Tests: `llm.test.ts`, `classifyCommand.test.ts` and `program.test.ts` additions, all run on a fake client with recorded responses (`src/testing/fakeAnthropic.ts`).
  - Covered: cache hits and misses, the 100% re-run, shuffled lines and entries, the recorded refusal/errored/expired/canceled cases, max_tokens, a missing slug or line, key-order stability, full-tool hashing, packing with an oversized tool, and request shape.
  - Also covered: dry-run never calls the client factory (vi.fn spy), and the key never appears in output or logs.

## Green gate (run 2026-09-24)
- `pnpm i --frozen-lockfile && pnpm -r lint && pnpm -r test && pnpm -r build` exits 0. audit: 77 passed, 1 skipped (opt-in live test). inbox: 3 passed.
- Trimmed dry run: `pnpm audit:cli classify --llm --dry-run` gives 116 tools (9 deprecated excluded) in 5 requests, about 68.8k input and 9.4k output tokens: **$0.12 sonnet / $0.29 opus**. Exit 0.
- Full dry run: `pnpm audit:cli classify --llm --dry-run --snapshot C:/Users/User/tool-reversibility/fixtures/catalog/2026-09-24` gives 56,216 tools, 55,557 sent to the LLM (659 deprecated excluded), in 2,223 requests. That is about **26.24M input and 4.49M output tokens: $48.69 sonnet-5 / $121.71 opus-5** (Batch). Exit 0, about 40 s, no network.

## Deviations / decisions made on the user's behalf
1. **Local token estimate, not `count_tokens`.** This was per the brief. Plan §3a still says `count_tokens`, so the verifier should amend it.
2. **Committed trimmed cache is synthetic.** No key means no real responses.
   - What was committed: `fixtures/llm-recorded/trimmed.answers.json` (a slug-verb heuristic, clearly labelled) and `batch-results.sample.jsonl` (one line per outcome, real JSONL shape). `fixtures/llm-cache/claude-sonnet-5/*.json` (125 files) was replayed from those answers.
   - Every cache entry is stamped `provenance: "recorded"`. Dry runs and `--live` treat recorded entries as **misses**, so they never hide real spend or pollute a real run. A plain `classify --llm` uses them and prints "N results are recorded fixtures (synthetic, not model output)".
   - Regenerate with `pnpm --filter audit fixture:llm` (`src/testing/buildLlmFixture.ts`).
   - #5 must not report numbers from `recorded` entries (§4).
3. Cache entry shape: `{schemaVersion, promptVersion, model, key, slug, provenance, output{slug,class,inverse_tool,rationale}, result: ClassifierResult}`. There is no timestamp, so regenerated files stay deterministic.
4. The `rationale ≤200` limit is enforced by clipping on parse, because structured outputs don't support `maxLength` (claude-api skill). The prompt asks for ≤200.
5. Packing is capped at 25 tools per request (plan §3a says "~25 per request"), so on the real catalog the cap binds before the 40k-token budget. The budget still splits big tools; the test covers it.
6. Batches are chunked at ≤10k requests / 200 MB per batch (the API limit is 100k / 256 MB). The full run fits in one batch.
7. A classify run without `--dry-run` that is fully cached prints class counts only. It writes no results file; #5 can call `runLlmClassify({client:null})` or `planLlm` to read the cache.

## Not done / next
- HUMAN (D11): relay the full dry-run numbers to Krish and get a yes before running `pnpm audit:cli classify --llm --live --snapshot <full dir>` with `ANTHROPIC_API_KEY` in `.env`. Not tested against the real API. The first live run should be the trimmed set (about $0.12) to confirm the request shape, especially `thinking:{type:"disabled"}` with `effort:"low"` on sonnet-5 and `json_schema` in Batches.
- Once #3 lands: wire `--rules` to `rulesCommand` (search `TODO(#3)` in `classifyCommand.ts`).
- Opus re-judge of disagreements (D11) is #5's job: `--model claude-opus-5` plus `--toolkits`, or a slug filter (not built).

## Ideas not in the issue
- Prompt caching on the ~1.5k-token system prompt inside the batch could cut about 3.4M input tokens (about $3 on sonnet). Check the model's minimum cacheable prefix first.
- Raising `maxToolsPerRequest` to 40–50 cuts system-prompt overhead further, but the effect on answer quality at effort low is unmeasured.

## Suggested skills
- `update-progress` (with this doc), `consult-plan` (deviations 1, 2, 5), `claude-api` (before touching `llm.ts` or pricing).

## Board status
- Card: issue #4 (no project board item; labels are only `opus`, no `status:*` labels exist), so there was nothing to move and no card was moved. The branch was handed to me, so I didn't post a "Started" comment.
- Complete for agent scope. The live run and its spend are human-gated (D11).
- Deviations: see above (local estimate instead of `count_tokens`; synthetic recorded cache with provenance gating).
- Innovations: provenance-gated cache, so synthetic fixtures can't masquerade as real results or suppress spend estimates; `fixture:llm` regenerator; slug-keyed replay fake that doesn't depend on how requests are packed.
