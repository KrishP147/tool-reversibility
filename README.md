# tool-reversibility

Can this agent action be undone? An audit of Composio's tool catalog for reversibility (reversible / compensable / irreversible), compared against the behaviour hints Composio already ships, plus an approval-inbox demo and a proposal for an `irreversibleHint`.

Not affiliated with Composio. Work in progress: see `skilleddocs/plan.md`.

## Dev

pnpm workspaces monorepo: `packages/audit` (CLI) + `apps/inbox` (Next.js demo). Node >=22 (`.nvmrc`), pnpm 10.28.1
(`packageManager` field; CI reads it via `pnpm/action-setup`).

```sh
pnpm i --frozen-lockfile
pnpm -r lint
pnpm -r test
pnpm -r build
pnpm format:check   # or `pnpm format` to write
```

**Running the audit CLI:** `pnpm audit` is a built-in pnpm command (its own security-audit
scanner), so it shadows a root script literally named `audit`. Use one of:

```sh
pnpm --filter audit start -- --help
pnpm audit:cli --help          # root shortcut, forwards to the same thing
```

`classify|report|all` are stubs today ("not implemented") — see `skilleddocs/plan.md` §6.

**`fetch`: snapshot the Composio catalog** (free-tier catalog GETs only, no spend). Needs `COMPOSIO_API_KEY` in
`.env` at the repo root (loaded automatically; never logged).

```sh
pnpm audit:cli fetch                           # all toolkits -> fixtures/catalog/<YYYY-MM-DD>/ (gitignored)
pnpm audit:cli fetch --toolkits gmail,slack    # only these toolkits
pnpm audit:cli fetch --refresh                 # re-fetch toolkits already on disk (default: resume/skip)
# regenerate the committed trimmed fixture:
pnpm audit:cli fetch --toolkits gmail,slack,github,googlecalendar,notion --out fixtures/catalog/trimmed --max-tools 25 --refresh
```

One `<toolkit>.json` per toolkit plus `manifest.json` (SDK version, date, command, counts, failures). Concurrency ≤4,
exponential backoff on 429/5xx; an interrupted run resumes where it stopped. Pagination/fallback details:
`skilleddocs/plan.md` §10 (D17–D22). Tests use a fake client and need no key; the live test is opt-in:
`AUDIT_LIVE=1 pnpm --filter audit test`.

Mock mode is the default for `apps/inbox` (`INBOX_MODE=mock`, zero keys). No secrets are required to lint, test or
build; CI runs gitleaks on every push/PR.
