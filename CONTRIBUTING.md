# Working in this repo

- Branch per issue: `krish/issue-N`. PR -> merge commit into `main`. Never push to `main` directly.
- `pnpm i --frozen-lockfile && pnpm -r lint && pnpm -r test && pnpm -r build` must be green with NO secrets (mock-first).
- Keys only via env (`.env.example`). gitleaks runs in CI. Snapshots hold public catalog metadata only.
- No spend of any kind (paid API call, paid tier, deploy) without the maintainer's explicit approval first: produce a `--dry-run` cost estimate and stop. Agents never call paid APIs; tests use recorded responses.
- No Composio number appears in docs without a stamped report (date, commit, SDK version, model, prompt version).
- Snapshot provenance: `docs/stamping.md`, `docs/snapshot.md`. Agent planning notes and handoffs stay local in `skilleddocs/` (gitignored).
