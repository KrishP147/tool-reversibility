# Working in this repo

- Branch per issue: `krish/issue-N`. PR -> merge commit into `main`. Never push to `main` directly.
- `pnpm i --frozen-lockfile && pnpm -r lint && pnpm -r test && pnpm -r build` must be green with NO secrets (mock-first).
- Keys only via env (`.env.example`). gitleaks runs in CI. Snapshots hold public catalog metadata only.
- No paid API call or deploy without the user's approval: produce a `--dry-run` cost estimate and stop.
- No Composio number appears in docs without a stamped report (date, commit, SDK version, model, prompt version).
- Design record: `skilleddocs/plan.md`. Session handoffs: `skilleddocs/HANDOFF.md`.
