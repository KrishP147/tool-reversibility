# Handoff: issue #27 — inbox screenshots via headless Playwright

**Status: complete.** All done-when items met, tests/lint/format/stamp checks green, working tree clean.

## What was done

- `apps/inbox/package.json`: added `playwright` (plain, not `@playwright/test`) devDependency and a `"screenshots": "tsx scripts/screenshots.ts"` script. Chromium installed via `pnpm --filter inbox exec playwright install chromium` (already cached locally; not committed).
- `apps/inbox/scripts/screenshots.ts` (new): builds the app, picks a free port, starts `next start -p <port>` with `INBOX_MODE` deleted and `INBOX_AUDIT_DIR` set to a fresh `mkdtemp` dir, polls for a 200 on `/`, then drives one headless Chromium browser/context/page (viewport 1280x800, dpr 1) through:
  - `/` → `docs/img/list.png`
  - `/actions/001-gmail-send-email` → `docs/img/detail-send.png`
  - click Approve, wait for `[data-testid="decision-confirmation"]` → `docs/img/approved.png`
  - `/actions/002-github-update-issue` → `docs/img/detail-update.png`
  Each screenshot is size-checked (<400KB) right after capture. Server is always killed in a `finally` — `taskkill /PID <pid> /T /F` on win32, negative-pid `SIGKILL` (process group) elsewhere.
- `apps/inbox/lib/audit.ts`: `defaultAuditDir()` now returns `process.env.INBOX_AUDIT_DIR` if set, else the prior `<cwd>/.data` behavior. `apps/inbox/lib/audit.test.ts`: added a `describe("defaultAuditDir")` block (env-set + fallback cases).
- `docs/img/{list,detail-send,detail-update,approved}.png`: captured and committed (24–38 KB each, all reviewed visually — correct pages, correct approve confirmation with hash, correct diff table).
- `README.md`: lines ~22-24 (GIF TODO) replaced with the four PNG embeds, a one-line caption, and a note that a GIF/Loom walkthrough is a separate user step. Nothing else in README touched.

Commits (branch `krish/issue-27`, on top of `e1b1dc9`):
1. `97ad0be` feat(inbox): add playwright devDep for screenshots
2. `719d469` feat(inbox): allow INBOX_AUDIT_DIR to override audit dir
3. `ab589d8` feat(inbox): add headless-Playwright screenshot script
4. `cd0f3d8` docs: embed inbox screenshots in README

## Verification run this session

- `pnpm --filter inbox screenshots` — succeeded end to end on first try (no memory issues, no retries needed); server process fully cleaned up afterward (checked no leftover `next`/`node` process).
- `pnpm --filter inbox test` — 17 files / 73 tests passed (twice: once before the screenshot run, once after, both green).
- `pnpm --filter inbox lint` — clean.
- `pnpm check:stamped` — ok (4 files).
- `pnpm exec prettier --check --end-of-line auto` on all changed files — clean.
- `git status` after everything — clean tree, no `apps/inbox/.data`, no stray files (`.next`/`node_modules`/`next-env.d.ts` correctly gitignored).

## Deviations / notes

- None of significance. This machine had enough free RAM that the "memory-critical" retry/bail-out path in the brief was never exercised — the capture ran clean in one pass.
- Picked the `001-gmail-send-email` fixture (not the github one) for the `approved.png` capture; the issue didn't specify which, and send-fixture's confirmation view reads cleanly as a screenshot.
- Not touched: `.github/**`, `.gitignore` (already had `apps/inbox/.data/`), `packages/audit/**`, `fixtures/**`, `docs/WRITEUP.md`, `skilleddocs/plan.md` — as scoped.

## Suggested skills for next session

- None needed to continue this issue — it's done. If picking the next backlog item, use `next` to read the board, then `pair` or the standard implementer flow.

## Board status

- Issue: [#27](https://github.com/KrishP147/tool-reversibility/issues/27) — "Inbox screenshots via headless Playwright → docs/img/*.png in README".
- No labels beyond `sonnet` were present (no `status:*` label, no project board item found for this issue — see below), so there was nothing to move from "todo" at start and nothing to flip to "in-review" now via the label fallback.
- Card/board: checked `gh issue view 27` (no `projects:` field shown) and there is no `status:*` label on the repo for this issue to toggle. No board update was possible/needed this session.
- Task complete, no deviations from the issue's shape, no follow-on ideas beyond what's noted above.
