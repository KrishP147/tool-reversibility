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
(Gmail, Outlook, Slack, Sheets, Calendar, Drive, GitHub, Notion). Research hypothesis, UNVERIFIED: `GMAIL_SEND_EMAIL`
tags = `important, openWorldHint`. The public toolkit page shows no tags, so confirm through the SDK.

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
  response's next-cursor field name is UNVERIFIED. Then, per toolkit, call
  `composio.tools.getRawComposioTools({ toolkits: [slug], limit })`. `tool.types.ts` confirms `ToolListParams` is a
  union that requires one of `tools | toolkits | search | tags | authConfigIds`. There is no unfiltered call and
  no `cursor` on this method. UNVERIFIED: whether `limit` truncates a big toolkit. Compare the count against
  toolkit metadata. If it truncates, fall back to the REST tools list endpoint with a cursor and log it in the D-log.
  Concurrency ≤4, exponential backoff on 429/5xx, resumable (skip toolkits already snapshotted), and `--refresh`.
- **Snapshot.** `fixtures/catalog/<date>/<toolkit>.json` holds the normalized Tool (`slug, name, description, tags,
  inputParameters, toolkit, version, isDeprecated, scopes`; fields verified in the docs). `manifest.json` records the SDK
  version, date and counts. A trimmed 5-toolkit fixture is committed so tests and CI run without a key.
- **Hints.** Map `tags[]` to 7 booleans and keep unknown tags raw. The blog doesn't document whether the SDK exposes the Enhanced Controls tier
  (UNVERIFIED). Check the Tool object, then any permissions API. If it's absent, derive the effective tier from
  the hints (destructiveHint→Destructive, readOnlyHint→Read, else Write) and label the column "derived". Cite #4327, which
  shows the real mapping is keyed by slug and drifts.
- **Rules** (`rules.ts`, pure, table-tested). Tokenize the slug verb (after the toolkit prefix), the description and the schema.
  Irreversible: SEND, POST, PUBLISH, PAY, CHARGE, TRANSFER, NOTIFY, INVITE, REPLY, FORWARD, MERGE, DEPLOY,
  EXECUTE, and DELETE/PURGE/EMPTY_TRASH when no restore is documented. Compensable (an inverse exists): CREATE/ADD/
  INSERT/UPDATE/PATCH/MOVE/ARCHIVE/LABEL, and update with an id param. Reversible (no external effect):
  GET/LIST/SEARCH/FETCH/READ/FIND/DESCRIBE, or `readOnlyHint`. Anything else is `unknown`.
  Output: `{ class, confidence, reasons[] }`.
- **LLM** (`llm.ts`). `claude-opus-5` at effort `low` (D3), overridable with `CLASSIFIER_MODEL`. Send ~25 tools per
  request through the Message Batches API (50% cost). Get structured output via `output_config.format` with a JSON schema
  `{slug, class, inverse_tool?, rationale≤200}`. Don't set temperature (it's removed on current models). Key results
  by `custom_id`, never by position. Handle `stop_reason: "refusal"` by marking the tool `unknown`. Cache each result at
  `fixtures/llm-cache/<model>/<sha256(prompt_version+tool JSON)>.json` so re-runs are free. The prompt lives in
  `prompts/classify.v1.md`. `--dry-run` prints the `count_tokens` estimate and the dollar cost before spending anything.
- **Compare/report.** For each tool, record the rule class, LLM class, agreement, hints, tier, and `GAP` = (both say irreversible) ∧
  ¬destructiveHint. REPORT.md holds totals, a confusion matrix, per-toolkit tables, the top-50 gaps and a disagreement sample.
  The header of every report is stamped with date, commit hash, SDK version, model id, prompt version and catalog manifest hash.
- CLI: `pnpm audit fetch|classify|report|all [--toolkits gmail,slack] [--offline]`.

### 3b. `apps/inbox`: the approval inbox for "ask" actions (Zephyr's review UX, rebuilt on Sessions)
- **List view.** Toolkit logo, slug, reversibility badge (irreversible red, compensable amber, reversible green),
  tier, and the reasons from the report.
- **Detail view.** A payload diff of fixture "before" vs proposed for updates, and a rendered preview for sends. If a
  compensating tool exists, show it. Approve / Reject / Edit, with an append-only audit log (who, when, decision, payload
  hash) kept as JSON in mock mode and in SQLite in live mode.
- **Mock mode is the default** (`INBOX_MODE=mock`, zero keys). It reads `fixtures/pending/*.json` and `reports/report.json`.
- **Live mode** is optional and behind a flag. It creates a session with the verified shape
  `composio.create(userId, { tags: { enable: [...], disable: [...] } })`, runs a tiny agent, and intercepts calls before
  execution. The intercept hook (modifiers / `tools.executeSessionTool`) is UNVERIFIED. Live mode must never block the demo.

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
- **Runtime:** Next binds `0.0.0.0:$PORT`. Mock mode is the default, so the deploy needs zero secrets. Live mode reads Replit Secrets only.
- **Done when:** a fresh GitHub import followed by Deploy works with no manual steps, the URL shows the inbox with fixtures, and the README has the URL, the date and a "Run on Replit" badge.

## 6. Issues (ordered; each ≤3 h implementer session)
1. **Scaffold monorepo + CI** (sonnet). Files: root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.github/workflows/ci.yml`, LICENSE, `.env.example`, `.gitignore`, README stub.
   - Done when: CI is green with no secrets, gitleaks runs and lint passes. Deps: none.
2. **Catalog fetcher + snapshot** (opus, because the API shape is uncertain). Files: `packages/audit/src/{fetch,normalize,snapshot}.ts` and mocked-SDK tests.
   - Done when: every §3a UNVERIFIED item is resolved into the D-log; pagination/truncation, backoff and resume are handled; the full snapshot is local; the trimmed fixture is committed; the manifest has counts. Deps: 1. HUMAN step: provide `COMPOSIO_API_KEY`.
3. **Hints/tier extraction + rule classifier** (sonnet). Files: `packages/audit/src/{hints,rules}.ts` and ≥40 table-driven tests, including GMAIL_SEND_EMAIL, `*_DELETE_*` and `*_LIST_*`.
   - Done when: every fixture tool has a class and reasons, and the tier is labelled derived or real. Deps: 2 (fixture only).
4. **LLM classifier + cache** (opus). Files: `packages/audit/src/llm.ts`, `prompts/classify.v1.md`.
   - Done when: the Batches + structured-output round-trip works; a re-run is 100% cache hits; `--dry-run` shows the cost; tests use a recorded response with no key. Deps: 2. HUMAN steps: provide `ANTHROPIC_API_KEY`; approve the spend after the dry-run.
5. **Compare + report + spot-check labels** (opus, because the labels and the claim need judgment). Files: `packages/audit/src/{compare,report}.ts`, `fixtures/labels/spotcheck.json`, `reports/*`.
   - Done when: the stamped report is committed with a confusion matrix and P/R against ≥50 labels, and the headline is filled from the data (or reworded if the data disagrees). Deps: 3, 4.
6. **Inbox UI, mock mode** (sonnet). Files: `apps/inbox/**`, `fixtures/pending/*.json`.
   - Done when: list, detail, diff/preview, badge, approve/reject and the audit log all work with zero keys; component tests exist; CI builds the app. Deps: 5 (stub the report until then).
7. **Inbox live mode + P4 Replit deploy** (sonnet; opus if the intercept stays unclear). Files: `apps/inbox/lib/live.ts`, `.replit`, `replit.nix` or Dockerfile.
   - Done when: §5 is met; live mode works behind its flag or is documented as a stretch goal; the README has a 90 s Loom script. Deps: 6.
8. **PROPOSAL.md + README write-up** (opus).
   - Done when: every number is a stamped one; the README has the pitch, headline, repro steps, GIF and limitations; Krish has reviewed it. Posting the issue is a HUMAN step. Deps: 5.
9. **Side quest: ComposioHQ/composio fork** (opus for #4571, sonnet for the docs issues). Parallel lane, no deps.
   - Fork, then branch `krish/4571-google-session-parity` off `next`.
   - **Comment on #4571 FIRST** with the plan (a `ToolCallSession` overload mirroring the Anthropic provider and routed via `executeToolForTarget` on `BaseProvider`, in TS + Python, with tests), then wait for an ack.
   - Implement in TS (path `ts/packages/providers/google` is UNVERIFIED), then Python. Add tests and `pnpm changeset`, and run `pnpm build && pnpm test && pnpm lint && pnpm typecheck`.
   - #4286: comment asking whether the sample or the types is the intended behaviour, then fix that one.
   - #4509: comment with the 3 questions and wait for an answer; the fix depends on a maintainer's reply, so don't guess.
   - Done when: branches are pushed to the fork, PR bodies are drafted in `side-quests/*.md` and checks pass locally.
   - **Opening PRs = human/orchestrator step:** base `next`, review from @jkomyno, issue linked.

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
- **D9 Stack:** Next.js 15 App Router + Tailwind; SQLite (better-sqlite3) in live mode only.

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
