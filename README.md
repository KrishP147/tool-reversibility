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

Commands (`fetch|classify|report|all`) are stubs today ("not implemented") — see `skilleddocs/plan.md` §6.

Mock mode is the default for `apps/inbox` (`INBOX_MODE=mock`, zero keys). No secrets are required to lint, test or
build; CI runs gitleaks on every push/PR.
