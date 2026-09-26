# plan.md — `tool-reversibility` (P1, owner KrishP147)

Spec written 2026-09-24. Sources verified that day are listed at the bottom. Anything marked UNVERIFIED must be
confirmed by the implementer before code depends on it.

## 1. Pitch + headline claim
When an agent acts through Composio, the gate on each call is whatever Composio knows about that tool. Today that is a set of
MCP-style behaviour hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`,
`createHint`, `updateHint`, `important`), plus the Read / Write / Destructive tier that Enhanced Controls
(beta, 2026-07-01) adds. Neither tells you whether an action can be undone. Sending an email, posting to Slack or paying an invoice
deletes nothing, so it isn't "destructive", yet none of them can be taken back. `tool-reversibility` pulls the whole Composio tool
catalog and classifies every tool as **reversible / compensable / irreversible**, using rules plus an LLM with both cached. It compares
that against the hints Composio already ships and publishes the gap. It also ships an approval-inbox demo of what an
"ask" UX looks like when reversibility is known, and a data-backed proposal for an `irreversibleHint`.
The idea comes from Krish's Hack the North 2026 project Zephyr, which hand-gated `GMAIL_SEND_EMAIL` as irreversible. His Devpost feedback
asked Composio for exactly this flag.

**Headline claim to prove (fill in with real numbers only):** "Of **M** tools that both classifiers call irreversible,
**N** (**P%**) carry neither `destructiveHint` nor any tag that moves them out of the Write/ask tier, e.g.
`GMAIL_SEND_EMAIL`." Secondary numbers: the agreement rate between the rules and the LLM, and the per-toolkit gap for the 8 Enhanced Controls apps
(Gmail, Outlook, Slack, Sheets, Calendar, Drive, GitHub, Notion). Research hypothesis was `GMAIL_SEND_EMAIL`
tags = `important, openWorldHint`; the SDK actually returns `important, openWorldHint, createHint` (resolved, D21).

## 2. Stack
TypeScript (strict), pnpm workspaces, Node 22, vitest, tsx (CLI), zod. Demo: Next.js 15 App Router + Tailwind.
LLM: `@anthropic-ai/sdk`. Why TS: Composio's primary SDK is `@composio/core`, the Fullstack Product intern JD centres
on TS dashboard/SDK/docs work, and the side-quest PRs land in `ts/packages/*`. eslint + prettier. CI is GitHub Actions
(`pnpm i --frozen-lockfile && pnpm -r test && pnpm -r build`) and needs no secrets.

## 3. Architecture
`packages/audit/` (CLI) · `apps/inbox/` (Next.js) · `fixtures/` (catalog snapshots, LLM cache, pending actions) ·
`reports/` (stamped REPORT.md + report.json) · `PROPOSAL.md`.

### 3a. `packages/audit`: fetch → extract → classify (rules, llm) → compare → report
- **Fetch.** `new Composio({ apiKey: process.env.COMPOSIO_API_KEY })`. Enumerate toolkits with
  `composio.toolkits.get({ limit, cursor })`. The query fields `category, cursor, limit, managedBy, sortBy` are verified; the
  next-cursor field is `next_cursor`, visible only on the raw client, so we page via `composio.getClient().toolkits.list` (resolved, D19). Then, per toolkit, call
  `composio.tools.getRawComposioTools({ toolkits: [slug], limit })`. `tool.types.ts` confirms `ToolListParams` is a
  union that requires one of `tools | toolkits | search | tags | authConfigIds`. There is no unfiltered call and
  no `cursor` on this method. `limit: 1000` does not truncate any current toolkit (max 896, github); the guard still
  compares against toolkit metadata and falls back to the REST tools list with a cursor (resolved, D20; SDK payload rejection also falls back, D21).
  Concurrency ≤4, exponential backoff on 429/5xx, resumable (skip toolkits already snapshotted), and `--refresh`.
- **Snapshot.** `fixtures/catalog/<date>/<toolkit>.json` holds the normalized Tool (`slug, name, description, tags,
  inputParameters, toolkit, version, isDeprecated, scopes`; fields verified in the docs). `manifest.json` records the SDK
  version, date and counts. A trimmed 5-toolkit fixture is committed so tests and CI run without a key.
- **Hints.** Map `tags[]` to 7 booleans and keep unknown tags raw. The SDK does not expose the Enhanced Controls tier
  (resolved, D22: no tier field on Tool or toolkit, raw or SDK). So derive the effective tier from
  the hints (destructiveHint→Destructive, readOnlyHint→Read, else Write) and label the column "derived". Cite #4327, which
  shows the real mapping is keyed by slug and drifts.
- **Rules** (`rules.ts`, pure, table-tested). Tokenize the slug verb (after the toolkit prefix), the description and the schema.
  Irreversible: SEND, POST, PUBLISH, PAY, CHARGE, TRANSFER, NOTIFY, INVITE, REPLY, FORWARD, MERGE, DEPLOY,
  EXECUTE, and DELETE/PURGE/EMPTY_TRASH when no restore is documented (explicit no-way-back text, e.g. "cannot be undone", beats restore keywords, D26). Compensable (an inverse exists): CREATE/ADD/
  INSERT/UPDATE/PATCH/MOVE/ARCHIVE/LABEL, and update with an id param. REMOVE/REVOKE: compensable, irreversible if the
  description says so, unless it also documents a re-add/restore path (D35). ABORT/CANCEL: compensable, irreversible if the
  description shows in-flight/no-way-back work. WATCH/DUPLICATE/SET/UNARCHIVE: compensable. SEND/POST after an earlier
  PATCH/UPDATE/GET/LIST/CREATE token in the slug are read as nouns (`GMAIL_PATCH_SEND_AS`) (#16, D27). Reversible (no external effect):
  GET/LIST/SEARCH/FETCH/READ/FIND/DESCRIBE, or `readOnlyHint`. Anything else is `unknown` (0 of 125 in the trimmed fixture after #16).
  Output: `{ class, confidence, reasons[] }`.
- **LLM** (`llm.ts`). `claude-opus-5` at effort `low` (D3), overridable with `CLASSIFIER_MODEL`. Send ~25 tools per
  request through the Message Batches API (50% cost). Get structured output via `output_config.format` with a JSON schema
  `{slug, class, inverse_tool?, rationale≤200}`. Don't set temperature (it's removed on current models). Key results
  by `custom_id`, never by position. Handle `stop_reason: "refusal"` by marking the tool `unknown`. Cache each result at
  `fixtures/llm-cache/<model>/<sha256(prompt_version+tool JSON)>.json` so re-runs are free. The prompt lives in
  `prompts/classify.v1.md`. `--dry-run` prints a local token estimate (3.5 chars/token, no API call, D25) and the dollar cost before spending anything. Packing, deprecated handling and request shape: D28-D30.
- **Compare/report.** For each tool, record the rule class, LLM class, agreement, hints, tier, and `GAP` = (both say irreversible) ∧
  ¬destructiveHint. REPORT.md holds totals, a confusion matrix, per-toolkit tables, the top-50 gaps and a disagreement sample.
  The header of every report is stamped with date, commit hash, SDK version, model id, prompt version and catalog manifest hash.
- CLI: `pnpm audit:cli fetch|classify|report|all [--toolkits gmail,slack] [--offline]` (D17; `pnpm audit` is a pnpm builtin).

### 3b. `apps/inbox`: the approval inbox for "ask" actions (Zephyr's review UX, rebuilt on Sessions)
- **List view.** Toolkit logo, slug, reversibility badge (irreversible red, compensable amber, reversible green),
  tier, and the reasons from the report.
- **Detail view.** A payload diff of fixture "before" vs proposed for updates, and a rendered preview for sends. If a
  compensating tool exists, show it. Approve / Reject / Edit, with an append-only audit log (who, when, decision, payload
  hash) kept as JSON in mock mode and in SQLite in live mode.
- **Mock mode is the default** (`INBOX_MODE=mock`, zero keys). It reads `fixtures/pending/*.json` and `reports/report.json`.
- **Live mode** is optional and behind a flag. It creates a session with the verified shape
  `composio.create(userId, { tags: { enable: [...], disable: [...] } })`, runs a tiny agent, and intercepts calls before
  execution. Intercept resolved in #7 (D42): `session.tools()` `modifiers.beforeExecute` in `@composio/core` 0.21.0 (pinned exact); `session.execute()` skips it. Live mode must never block the demo.

### 3c. `PROPOSAL.md`
A ready-to-paste Composio feature-request issue. **Problem:** the hints describe *what changes*, not *whether it can be undone*; sending is not destructive. **Data:** tables from the stamped report. **Proposal:** `irreversibleHint: boolean` on tools, plus an Enhanced Controls "Irreversible" tier/modifier defaulting to Ask-with-preview; optional `compensatingTool` slug. **Migration:** seed from the classifier, starting with the 8 EC apps. **Prior art:** MCP tool annotations, Zephyr. **Offer to help.** Krish posts it himself (issue-first policy).

## 4. Honesty / quality constraints
- No Composio number appears anywhere without a reproducible run: commit hash, date, SDK version, model id and the regenerate command.
  The README headline links to the stamped report.
- The classes are presented as *our* classification, with the disagreement rate shown, not as ground truth. Hand-label ≥50 tools
  (stratified) as a spot-check set and report precision/recall for both classifiers.
- Keys come from env only (`COMPOSIO_API_KEY`, `ANTHROPIC_API_KEY`). Commit `.env.example`, gitignore `.env*`, and run gitleaks in CI.
  Snapshots hold public catalog metadata only, never user or connected-account data.
- Mock-first: CI is green with no keys. Live paths sit behind `--live` and env vars and are skipped in CI.
- MIT license. The README says "not affiliated with Composio".

## 5. P4: Replit-deployable `apps/inbox`
- **What's needed:**
  - `.replit`: `run = "pnpm --filter inbox start"`; `[deployment] build = ["sh","-c","corepack enable && pnpm i --frozen-lockfile && pnpm --filter inbox build"]`; `deploymentTarget = "cloudrun"` (Autoscale); `[[ports]] localPort = 3000`.
  - `replit.nix` with `pkgs.nodejs_22`, or a Dockerfile fallback (`node:22-slim`, Next `output: "standalone"`).
  - These `.replit` keys are UNVERIFIED; check them against the Replit docs.
  - As built (#7, D41): `.replit` with `modules = ["nodejs-22"]`, no `replit.nix`, no Dockerfile, no `output: "standalone"`; `start` = `next start -H 0.0.0.0 -p ${PORT:-3000}`. The deploy itself is user-gated (§13).
- **Runtime:** Next binds `0.0.0.0:$PORT`. Mock mode is the default, so the deploy needs zero secrets. Live mode reads Replit Secrets only.
- **Done when:** a fresh GitHub import followed by Deploy works with no manual steps, the URL shows the inbox with fixtures, and the README has the URL, the date and a "Run on Replit" badge.

## 6. Issues (ordered; each ≤3 h implementer session)
1. **Scaffold monorepo + CI** (sonnet). **Done** (PR #10). Files: root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.github/workflows/ci.yml`, LICENSE, `.env.example`, `.gitignore`, README stub.
   - Done when: CI is green with no secrets, gitleaks runs and lint passes. Deps: none.
2. **Catalog fetcher + snapshot** (opus, because the API shape is uncertain). **Done** (PR #11). Files: `packages/audit/src/{fetch,normalize,snapshot}.ts` and mocked-SDK tests.
   - Done when: every §3a UNVERIFIED item is resolved into the D-log; pagination/truncation, backoff and resume are handled; the full snapshot is local; the trimmed fixture is committed; the manifest has counts. Deps: 1. HUMAN step: provide `COMPOSIO_API_KEY`.
3. **Hints/tier extraction + rule classifier** (sonnet). **Done** (PR #14; verbs PR #19, #16). Files: `packages/audit/src/{hints,rules}.ts` and ≥40 table-driven tests, including GMAIL_SEND_EMAIL, `*_DELETE_*` and `*_LIST_*`.
   - Done when: every fixture tool has a class and reasons, and the tier is labelled derived or real. Deps: 2 (fixture only).
4. **LLM classifier + cache** (opus). **Done** (PR #15); live run user-gated (§13). Files: `packages/audit/src/llm.ts`, `prompts/classify.v1.md`.
   - Done when: the Batches + structured-output round-trip works; a re-run is 100% cache hits; `--dry-run` shows the cost; tests use a recorded response with no key. Deps: 2. HUMAN steps: provide `ANTHROPIC_API_KEY`; approve the spend after the dry-run.
5. **Compare + report + spot-check labels** (opus, because the labels and the claim need judgment). **Done** (PR #20, rules-only; regen after D35 in ecf5a7d); headline + LLM columns wait on the live run (§13). Files: `packages/audit/src/{compare,report}.ts`, `fixtures/labels/spotcheck.json`, `reports/*`.
   - Done when: the stamped report is committed with a confusion matrix and P/R against ≥50 labels, and the headline is filled from the data (or reworded if the data disagrees). Deps: 3, 4.
6. **Inbox UI, mock mode** (sonnet). **Done** (PR #13). Files: `apps/inbox/**`, `fixtures/pending/*.json`.
   - Done when: list, detail, diff/preview, badge, approve/reject and the audit log all work with zero keys; component tests exist; CI builds the app. Deps: 5 (stub the report until then).
7. **Inbox live mode + P4 Replit deploy** (sonnet; opus if the intercept stays unclear). **Done** (PR #21) except user-gated: Replit deploy + URL, live smoke with a real key (§13, D40-D43). Files: `apps/inbox/lib/live.ts`, `.replit`, `replit.nix` or Dockerfile.
   - Done when: §5 is met; live mode works behind its flag or is documented as a stretch goal; the README has a 90 s Loom script. Deps: 6.
8. **PROPOSAL.md + README write-up** (opus). **Done** (PR #17) except Krish review, GIF, Devpost link, posting (§13).
   - Done when: every number is a stamped one; the README has the pitch, headline, repro steps, GIF and limitations; Krish has reviewed it. Posting the issue is a HUMAN step. Deps: 5.
9. **Side quest: ComposioHQ/composio fork** (opus for #4571, sonnet for the docs issues). Parallel lane, no deps. **Done** locally (D18); posting user-gated.
   - Fork, then branch `krish/4571-google-session-parity` off `next`.
   - **Comment on #4571 FIRST** with the plan (a `ToolCallSession` overload mirroring the Anthropic provider and routed via `executeToolForTarget` on `BaseProvider`, in TS + Python, with tests), then wait for an ack.
   - Implement in TS (path `ts/packages/providers/google` is UNVERIFIED), then Python. Add tests and `pnpm changeset`, and run `pnpm build && pnpm test && pnpm lint && pnpm typecheck`.
   - #4286: comment asking whether the sample or the types is the intended behaviour, then fix that one.
   - #4509: comment with the 3 questions and wait for an answer; the fix depends on a maintainer's reply, so don't guess.
   - Done when: branches are pushed to the fork, PR bodies are drafted in `side-quests/*.md` and checks pass locally.
   - **Opening PRs = human/orchestrator step:** base `next`, review from @jkomyno, issue linked.
12. **Side quest: SDK schema rejection upstream draft** (sonnet; issue #12, from D21). **Done** (PR #22): `side-quests/sdk-schema-rejection.md` + offline repro `packages/audit/scripts/sdk-schema-repro.ts` (D44). Posting is a human step.
13. **P1 polish: `audit:cli all`, `explain`, `pnpm demo:agent`** (issues #23 sonnet, #24 sonnet, #25 opus). **Done** (PRs #28, #29, #30; D45-D50, §14). `demo:agent --live` is user-gated (§14).

**What each issue asks.** These are summaries from the fetch tool; re-read the originals before commenting.
- **#4571** "[Feature]: Google provider's executeToolCall doesn't accept a session (unlike OpenAI/Anthropic)". It proposes to "mirror the Anthropic provider's implementation by adding an overload that accepts a session parameter and routes through the existing `executeToolForTarget` helper on `BaseProvider`". The gap is in both the TS and Python SDKs.
- **#4286** "Broken TypeScript sample in your Slack bot example" (bug/docs). `experimental: { accountType: 'SHARED' }` fails on `@composio/core@0.18.0` with "'experimental' does not exist in type '{ callbackUrl?: string; alias?: string; }'".
- **#4509** "Clarify deprecated user_id in connected-account responses" (docs). The reporter asks three things:
  - Is `user_id` still returned during the deprecation?
  - Is its omission from the TS SDK intentional?
  - Is listing with `user_ids` the recommended way to check ownership?

## 7. Decisions log
- **D1 Taxonomy:** reversible (no external effect) / compensable (inverse API exists) / irreversible (effect escapes the system: message delivered, money moved, hard delete) / unknown.
- **D2 GAP:** both classifiers say irreversible ∧ no `destructiveHint`. The single-classifier gap is reported separately.
- **D3 LLM:** `claude-opus-5` at effort `low` via Batches (the Anthropic skill default). Downgrade only if Krish says so (Q2).
- **D4 Cache:** one JSON file per tool, keyed by sha256(prompt_version + canonical tool JSON). Snapshots go in dated folders; only the trimmed fixture and its cache are committed.
- **D5 Enumeration:** per toolkit via `getRawComposioTools({ toolkits: [slug] })`, because the union type forbids an unfiltered call.
- **D6 Tier column:** real if the SDK exposes it, otherwise labelled "derived".
- **D7:** mock-first; live mode is opt-in.
- **D8 Repo:** `KrishP147/tool-reversibility`, MIT, branches `krish/<issue>-<slug>`.
- **D9 Stack:** Next.js 15 App Router + Tailwind; SQLite in live mode only (~~better-sqlite3~~ -> built-in `node:sqlite`, D40).

## 8. Open questions (Krish)
1. Composio free tier OK, or paid project for rate limits?
2. LLM spend cap for full classify; Opus 5 or cheaper model?
3. Post PROPOSAL issue before or after application submit?
4. Zephyr screenshots/links in README?
5. #4571: TS + Python, or TS only?

## Sources verified 2026-09-24
- https://docs.composio.dev/kb/guide/platform-session-tool-policies (7 tags; `composio.create(user, { tags: { enable, disable } })`)
- https://docs.composio.dev/reference/sdk-reference/typescript/tools (`getRawComposioTools`, `getRawComposioToolBySlug`, Tool fields)
- https://docs.composio.dev/reference/sdk-reference/typescript/toolkits (`toolkits.get({category,cursor,limit,managedBy,sortBy})`, `getMany`)
- https://github.com/ComposioHQ/composio/blob/next/ts/packages/core/src/types/tool.types.ts (`ToolListParams` union)
- https://composio.dev/content/introducing-enhanced-controls-beta (tiers, defaults, 8 apps; SDK tier exposure not documented)
- https://github.com/ComposioHQ/composio/blob/next/CONTRIBUTING.md (issue-first, `next`, @jkomyno, changeset, AI policy)
- Issues #4571, #4286, #4509, #4327 (all open at fetch time)

## 9. Orchestrator decisions on §8 (2026-09-24)
- D10 Composio free tier; fetcher must survive rate limits (backoff, resume). Escalate to the user only if the free tier cannot enumerate the catalog.
- D11 **No spend of any kind without the user's explicit approval first (user rule).** `--dry-run` cost estimate is mandatory before any classify run; the orchestrator relays the number to the user and waits for a yes. Default `CLASSIFIER_MODEL=claude-sonnet-5` for the full pass; re-judge disagreements + the spot-check set with `claude-opus-5` (also approval-gated). Load the `claude-api` skill for exact model ids/pricing before implementing `llm.ts`. Implementers never call paid APIs; tests use recorded responses.
- D12 PROPOSAL issue is posted by Krish after the Litmus take-home is submitted and before/with the application.
- D13 README links Zephyr (repo + Devpost) and states which parts Krish owned (content-bank honesty note).
- D14 #4571: TypeScript first; Python only if the TS PR is acked by a maintainer.
- D15 Branches: `krish/issue-N` (hub convention).
- D16 Replit deploy (P4) is issue 7; `.replit` keys must be verified against docs.replit.com before commit. Replit deploy itself may cost money → user approval before deploying.
- D17 (2026-09-24, #1) CLI entry is root script `pnpm audit:cli <cmd>` (= `pnpm --filter audit start -- <cmd>`). `pnpm audit` is a pnpm builtin (security audit) and shadows any root script named `audit`; §3a CLI line updated.
- D18 (2026-09-24, #9, verifier on user's behalf) Side-quest fork branch `krish/4571-google-session-parity` stays local-only (`C:\Users\User\_worktrees\composio`) until a maintainer acks the #4571 comment; pushing is a human step per `side-quests/README.md`. Amends §6 item 9 "Done when: branches are pushed to the fork" → drafts in `side-quests/*.md` + local checks pass; push after ack. Why: Composio CONTRIBUTING is issue-first; an unacked public branch/PR is premature.

## 10. Issue 2 findings (live, 2026-09-24, `@composio/core` 0.21.0, free tier, catalog GETs only)
- D19 **Toolkit pagination:** the REST list returns `{ items, next_cursor, total_pages, current_page, total_items }`; `next_cursor` is an opaque base64 string (e.g. `Mi0xMDAw`), null on the last page. The SDK `toolkits.get({ limit })` returns a bare array and drops the cursor (at `limit: 1000` it silently stops at 1000 of 1562). So we list via `composio.getClient().toolkits.list({ limit: 1000, cursor })` and drain `next_cursor`.
- D20 **Per-toolkit tools:** `getRawComposioTools({ toolkits: [slug], limit: 1000 })` returns every version-latest tool, deprecated included; it matches the raw `tools.list(...).total_items`, and no current toolkit reaches 1000 (max: github 896). `meta.tools_count` counts non-deprecated tools only (github 874 = 896 − 22). `limit` must always be passed: without it the SDK auto-adds `important=true` for a toolkits-only query and returns a curated subset (`getRawComposioTools` source, 0.21.0). Guard: if a result fills `limit` or has fewer non-deprecated tools than `tools_count`, re-fetch via raw `tools.list({ toolkit_slug, cursor })`. In the full run this guard fired 0 times.
- D21 **SDK payload rejection:** for 8 toolkits (`coinbase_wallet_mcp, datadog_mcp, highlevel_mcp, honeycomb_mcp, longbridge_mcp, ramp_mcp, runway, tiktok_ads`) the SDK's zod schema rejects the tool list (e.g. a boolean JSON-schema node under `inputParameters.properties`). Errors with no HTTP status fall back to the raw REST list (no zod), recorded as `source: "rest-cursor", fallbackReason: "sdk-error"`. HTTP errors (401, exhausted 429/5xx) still fail the toolkit and land in `manifest.failures`.
- D22 **Tier exposure:** not exposed. Neither the SDK `Tool` (`slug, name, description, inputParameters, outputParameters, tags, toolkit, version, isDeprecated, availableVersions, scopes, isNoAuth`) nor the raw tool (adds `scope_requirements, no_auth, human_description, deprecated`) nor the toolkit object carries a Read/Write/Destructive tier; the only `permissions` in the SDK is session elicitation config. Per D6 the tier column is **derived** from hints.
- D23 **`GMAIL_SEND_EMAIL` tags:** `important, openWorldHint, createHint` (SDK and raw agree). No `destructiveHint`, so it is a GAP candidate under D2.
- D24 **Snapshot shape:** `fixtures/catalog/<date>/<slug>.json` = `{ schemaVersion, toolkit, source, fallbackReason?, fetchedAt, toolCount, fullToolCount, tools[] }`; `manifest.json` = SDK version, date, command, counts, failures, per-toolkit counts. Resume skips any toolkit with a valid file; `--refresh` re-fetches. Full run: `pnpm audit:cli fetch` at commit `abdba72` (resume pass) → 1562 toolkits, 56,216 tools (659 deprecated), 0 failures, 0 truncation fallbacks, 8 sdk-error fallbacks; ~169 MB, gitignored. Trimmed fixture: `--toolkits gmail,slack,github,googlecalendar,notion --out fixtures/catalog/trimmed --max-tools 25`; slugs unchanged; 125 of 1,233 tools kept (pins `GMAIL_SEND_EMAIL` and one tool per common verb).

## 11. Issues 3/4/6 verification (2026-09-25, verifier on user's behalf)
- D25 **Token estimate (#4):** `--dry-run` estimates tokens locally at 3.5 chars/token instead of calling `count_tokens`. Why: a dry run must never need a key or touch a paid/remote API (D11); the estimate only gates approval. §3a amended.
- D26 **DELETE precedence (#3):** in the DELETE branch, explicit no-way-back description text ("cannot be undone", "no recovery", "bypassing Trash") wins over restore keywords ("undo", "trash"). Fixes `SLACK_DELETE_SLACK_LIST_ITEM` and `GMAIL_BATCH_DELETE_MESSAGES` being compensable; `NOTION_DELETE_BLOCK` (archive, restorable) stays compensable.
- D27 **Missing verbs (#3, done in #16):** ~~REMOVE/REVOKE/WATCH/DUPLICATE/SET/UNARCHIVE/ABORT fall to `unknown`~~. #16 (PR #19) added them plus CANCEL and noun-masking of SEND/POST; trimmed fixture unknown 9 -> 0 (§3a updated). Known leftovers: `GMAIL_STOP_WATCH` reason names WATCH not STOP (class right); masking fires on any earlier PATCH/UPDATE/GET/LIST/CREATE token, so a future `*_CREATE_AND_SEND` slug would read compensable. #5's rule-vs-LLM compare surfaces both.
- D28 **Deprecated tools (#4):** excluded from the LLM pass by default (`--include-deprecated` adds them); the rules pass still classifies them. Full catalog: 55,557 of 56,216 sent. Report totals (#5) must state which population they cover.
- D29 **Request shape (#4):** effort `low`, thinking disabled, structured output via json_schema (`additionalProperties: false`) inside a Batch; no temperature, prefill or fallbacks. Not yet tried against the real API, so the first live run is the trimmed fixture (~$0.12 on sonnet-5), approval-gated per D11.
- D30 **Packing (#4):** requests are packed to a 40k-token budget with a 25-tool cap; an oversized tool goes alone. On the real catalog the 25-tool cap binds first.
- D31 **Synthetic cache (#4):** the committed trimmed cache (`fixtures/llm-cache`, `provenance: "recorded"`) is a slug-verb heuristic, not model output. `--dry-run` and `--live` ignore it, a plain `classify --llm` warns when it is used, and **#5 must never report numbers from it as Composio/model results**.
- D32 **Formatting (#3/#4/#6):** `classification.ts` is one file (both branches were byte-identical, merged cleanly). Reformatted with prettier rather than prettier-ignored, along with 10 inbox files from #6; the byte-identical rule only existed to avoid a merge conflict. `prettier --check --end-of-line auto packages apps` is clean.
- D33 **`classify --rules` (#3/#4):** wired to `rulesCommand` (the #4 `TODO(#3)` stub is gone); default `classify` runs rules then LLM. classify tests now pin `--snapshot fixtures/catalog/trimmed`, because a local gitignored dated snapshot otherwise wins `resolveSnapshotDir` and the tests fail (and take minutes) on any machine that has run a full fetch.
- D34 **Inbox fixtures (#6):** `fixtures/pending/*` and the stub report now use real catalog slugs and field names: `GMAIL_SEND_EMAIL.recipient_email`, `GITHUB_UPDATE_AN_ISSUE` (owner/repo/issue_number), `NOTION_ARCHIVE_NOTION_PAGE` (the catalog has no `NOTION_DELETE_PAGE`), `SLACK_SEND_MESSAGE.markdown_text`. Stub hints come from real tags (D23) and `ruleClass` from the rules classifier; `llmClass` stays illustrative and the report keeps `stub: true`. `SendPreview` reads the real names and still accepts the legacy `to`/`text`.

## 12. Issues 8/16 verification (2026-09-25, verifier on user's behalf)
- D35 **REMOVE/REVOKE restore text (#16):** within REMOVE/REVOKE, a documented re-add/restore path ("to restore", "re-add", "re-grant", "re-share") beats an "irreversible" keyword -> compensable (confidence 0.6, reason `desc:"restore"`). Why: D1 defines compensable as "an inverse exists", and the tool's own description names it; REMOVE/REVOKE loses a link, not data, so D26's DELETE direction (no-way-back text wins) does not carry over. Negated forms ("cannot be restored", "cannot be undone") never count. Effect: `GITHUB_REMOVE_TEAM_MEMBERSHIP` irreversible -> compensable; `SLACK_REVOKE_FILE_PUBLIC_SHARING` (no restore path) stays irreversible. Trimmed fixture: compensable 54, irreversible 19. Reports regenerated rules-only at a9d50c0 (rules irreversible 6,009 -> 6,003, github 87 -> 86; spot-check unchanged) and README/PROPOSAL stamps refilled.
- D36 **Stamp contract (#8):** `pnpm check:stamped` (`scripts/check-stamped.mjs`, CI step after Build) scans README.md, PROPOSAL.md and docs/**/*.md. Allowed `[[report:KEY]]` keys: `totals.{tools,toolkits,deprecatedExcluded}`, `rules|llm.byClass.<class>`, `agreement.rate`, `gap.{M,N,P}`, `singleGap.rules.{M,N,P}`, `perToolkit.<slug>.{tools,irreversible,gap}`, `spotcheck.{n,rules.precision,rules.recall}`. #5 must emit exactly these in `reports/report.json` with a `stamp` block `{date, generatedAt, commit, dirty, sdkVersion, model, llmStatus, ...}` (docs/stamping.md). A key with a value must be replaced by value + `[report YYYY-MM-DD, commit <sha>]`; LLM-dependent keys are forced only once `llmStatus: "live"` (D31).
- D37 **Placeholder tokens (#8):** only two placeholders are legal: `[[pending live run]]` (not measured yet; the README headline until a live run) and `[[report:KEY]]` (file must also link reports/REPORT.md). Anything else in `[[...]]` fails the check. Code fences and inline code are scanned; `--max-tools`-style flags are exempt.
- D38 **Plan-verified facts exception (#8):** a number from a plan-verified snapshot (§10, D19-D24) may appear in docs with `[snapshot YYYY-MM-DD, @composio/core X.Y.Z]` on the same physical line; only snapshots in `KNOWN_SNAPSHOTS` (today 2026-09-24 / 0.21.0) pass. Why: §4 requires a reproducible run for every number, and the §10 fetch is one; hard-coded list until committed manifests replace it.
- D39 **Zephyr wording (#8, D13):** README ownership list matches the content-bank notes (optimizer, HITL approval fixes, Connections page, sponsor integrations behind mock twins; "top 12 of the Warp track", not a placement). Added: Gemini/GPTZero were not run live at submission. No Praxic users/pilots are claimed anywhere.

## 13. P1 status 2026-09-26 (issues 5/7/12 verification, verifier on user's behalf)
- D40 **SQLite driver (#7, amends D9):** live mode uses Node's built-in `node:sqlite` (`DatabaseSync`, `apps/inbox/lib/store.ts`), not better-sqlite3. Why: no native build, no `onlyBuiltDependencies` change, nothing extra for Replit. Cost: needs Node >=22.13 (prints an experimental warning); vitest needs a virtual-module shim for `node:sqlite` (`apps/inbox/vitest.config.ts`), re-check on vitest upgrades. Mock mode stays JSONL.
- D41 **Replit config (#7, amends §5):** `.replit` only (`nodejs-22` module, `[deployment]` cloudrun build/run, port 3000 -> 80); no `replit.nix`, no Dockerfile, no Next `output: "standalone"`. Why: the Replit nodejs module supplies Node + corepack; standalone output only matters for the Dockerfile fallback. Fall back to Dockerfile + standalone only if the first Deploy fails. Unverified until the deploy: that Replit's nodejs-22 is >=22.13 (only matters for live mode).
- D42 **Intercept (#7, resolves §3b UNVERIFIED):** `approvalGuard` hooks `session.tools()` `modifiers.beforeExecute`; `session.execute()` skips modifiers. Both are undocumented `@composio/core` 0.21.0 behaviour read from its dist, so the dependency is pinned exact; re-verify before any bump. Client-side "proposal queue", not a server gate (README Limitations). ~~No agent calls `session.tools()` in this build, so the guard is unit-tested but unwired~~ -> wired by the scripted `pnpm demo:agent` (#25, D47); the UI uses a Propose form instead. Accepted as the §6 item 7 "documented stretch" path.
- D43 **Re-decide guard (#7):** live Approve/Reject/Edit act only on a `pending` row; a settled row is refused (manager fix ae06bd6 + regression test), so a second Approve never re-sends. A failed execute leaves the row `pending` (retry allowed). No lock against a concurrent double-click: single-user demo, accepted.
- D44 **SDK schema rejection (#12, extends D21):** offline repro against the 2026-09-24 snapshot reproduces 6 of 8 (coinbase_wallet_mcp, datadog_mcp, honeycomb_mcp: boolean `items`; ramp_mcp: boolean `exclusiveMinimum`; runway: top-level `oneOf`, no `type`; tiktok_ads: boolean schema in `allOf.then`). highlevel_mcp and longbridge_mcp pass on `inputParameters`; the draft says "presumably `outputParameters` (not snapshotted)", which stays unverified until a live call with a key (free catalog GET, user-run). Dup check: none open; closest #3354 (closed via #3397).

**Complete (merged on main, CI green, no keys):** scaffold + CI + gitleaks (#1); full catalog fetch + trimmed fixture (#2); hints + rules (#3, #16); LLM classifier + cache + `--dry-run` cost gate (#4, never run live); compare + stamped rules-only report + 74 blind spot-check labels (#5); inbox mock mode (#6); inbox live mode behind `INBOX_MODE=live` + `.replit` (#7); PROPOSAL + README + `check:stamped` (#8); side-quest drafts (#9, #12). Local gate at 078b824: audit 323 passed + 1 skipped, inbox 65, lint/build/check:stamped ok.

**User-gated (nothing else is open):**
1. Live LLM run (D11): trimmed fixture first (~$0.12, sonnet-5), then the full pass (~$48.69, sonnet-5) after re-approving the `--dry-run` number; then regenerate the report from a clean tree and fill the headline + LLM placeholders.
2. Replit: import, Deploy -> Autoscale, fill "Deployed URL" + date in README (D16 approval if it costs money); optional live smoke with a real `COMPOSIO_API_KEY`.
3. Devpost link + demo GIF in README; review the Zephyr ownership wording.
4. Review the 74 spot-check labels (`fixtures/labels/spotcheck.json`, "pending Krish review").
5. Post the 4 side-quest drafts (`side-quests/`: #4571 comment, #4286, #4509, SDK schema rejection) per `side-quests/README.md`; post PROPOSAL after the Litmus submit (D12).
6. (added 2026-09-26, #25) Run `pnpm demo:agent --live` once with a test Composio key (D48); never run by agents.

## 14. P1 polish verification 2026-09-26 (issues 23/24/25, verifier on user's behalf)
- D45 **`all` semantics (#23):** `all` = fetch -> `classify --rules` -> `report`, stops at the first non-zero exit; never touches the LLM (`--live`/`--llm` exit 2, D11). `--offline` skips fetch, pins `--snapshot fixtures/catalog/trimmed` (an explicit `--snapshot` wins) and writes the report to `reports/offline/` (gitignored) or `--out <dir>`; committed `reports/` is never touched. Online `all` (no `--offline`) regenerates the committed `reports/REPORT.md` + `report.json` **by design** (it is the full-catalog regen path; commit from a clean tree, D36). `--out` means two things: online, the fetch snapshot dir that classify/report then read (manager fix 45a1be2); offline, the report output dir. CI runs `all --offline`.
- D46 **`explain` contract (#24):** `audit:cli explain <SLUG> [--snapshot] [--model] [--json]` reads only the snapshot + on-disk LLM cache (no network, no key). Prints toolkit, raw tags -> 7 hints + other tags, derived tier, rule class/confidence/reasons, LLM cache state `live|recorded|miss` for model + `PROMPT_VERSION` (`recorded` labelled "recorded-synthetic — NOT a model verdict", D31), GAP (D2; live-only) + single-gap flags, spot-check label + rationale when labelled. Exit 0 on hit; unknown slug exit 2 + 5 closest slugs (Levenshtein, alpha tiebreak); missing slug exit 2. `--json` = same fields. Trimmed cache is all `recorded`, so no live GAP shows until the live run.
- D47 **Modifier shape (#25, amends D42):** in `@composio/core` 0.21.0 `session.tools(modifiers, requestOptions)` takes modifiers **flat** — `session.tools({ beforeExecute })` (dist L9896); the executor calls `modifiers.beforeExecute({ toolSlug, toolkitSlug, sessionId, params })` (dist L1984-1989). The #7/#25 briefs' nested `{ modifiers: { beforeExecute } }` is silently ignored (guard never fires). `demoAgent.ts` uses the flat shape; re-verify on any SDK bump (pin stays exact).
- D48 **Agentic provider for `--live` (#25):** the default `ComposioProvider.wrapTools` drops the execute fn (dist L11028-11035), so `beforeExecute` never fires through it; `demo:agent --live` builds its own client with a minimal `BaseAgenticProvider` + `toolkits: ["gmail"]`. Typechecks; never run (needs a key). Default `pnpm demo:agent` is a mock session, no network, no LLM.
- D49 **approvalGuard db path (#25):** `approvalGuard` has no db-path param and writes `<cwd>/.data/live.db`, so `runDemo` requires `DEMO_DB` to end in `.data/live.db` and chdirs to its grandparent for the call (restored in `finally`). Accepted for the demo; follow-up #31 (sonnet) adds a `dbPath` param.
- D50 **ApprovalRequiredError payload (#25):** the error carries `toolSlug` + `pendingId`, not `params`; tests assert params via the stored pending row. Accepted (changing it touches `live.ts`); optional part of #31.

**Status:** #23, #24, #25 merged (PRs #28-#30), CI green on main 0d68d92. Local gate at 0d68d92: audit 346 passed + 1 skipped, inbox 69, lint/build/check:stamped ok; smokes `all --offline`, `explain GMAIL_SEND_EMAIL`, `demo:agent` (temp DB) exit 0. User-gated adds one item to §13: run `pnpm demo:agent --live` once with a test Composio key (D48). Open: #26 WRITEUP (in progress), #27 screenshots, #31 approvalGuard dbPath.
