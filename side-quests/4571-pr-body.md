<!--
Draft PR body. Do not open until a maintainer acks the #4571 comment.
Base: ComposioHQ/composio `next`. Head: KrishP147:krish/4571-google-session-parity.
Title: feat(google): accept Tool Router session in executeToolCall
Reviewer: @jkomyno
-->

Closes #4571

## Summary

`GoogleProvider.executeToolCall` now has the same two overloads as the OpenAI and Anthropic helpers:

```ts
executeToolCall(session: ToolCallSession, tool: GoogleGenAIFunctionCall): Promise<string>;
executeToolCall(userId: string, tool, options?, modifiers?): Promise<string>;
```

Both route through `BaseProvider.executeToolForTarget`, so session meta-tools (`COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_MANAGE_CONNECTIONS`) run through `session.execute()` and keep their session context. Argument normalization (#2406) happens before routing, so it applies to both paths.

Behaviour notes:

- **userId path:** unchanged. Same `executeTool` payload (`arguments`, `userId`, `connectedAccountId`, `customAuthParams`, `customConnectionData`), and the return value is still `JSON.stringify` of the full `ToolExecuteResponse`.
- **Session path:** returns `JSON.stringify` of the session result plus `successful: result.error === null`, the same shape the OpenAI helper returns. I kept the OpenAI shape rather than Anthropic's (`data` or `{ error }`) so the success payload matches what Google callers already get on the userId path.
- **Options with a session:** passing `options` or `modifiers` together with a session throws the existing `TypeError` from `assertToolCallExecutionOptions`, as in OpenAI/Anthropic.
- Google has no `handleToolCalls` helper, so nothing else needed a session overload.
- **Peer range:** `@composio/core` stays `>=0.16.0`. `executeToolForTarget` first shipped in core 0.17.0, so this build needs core >= 0.17.0 at runtime. `@composio/anthropic` and `@composio/openai` kept their older lower bounds when they got the same change (760f8d0), so I mirrored that. Happy to raise the lower bound to `>=0.17.0` if you prefer.

## Tests

New cases in `ts/packages/providers/google/test/google.test.ts`, modelled on the Anthropic and core OpenAI session tests:

- a session meta-tool call goes to `session.execute` with normalized args, never to the direct execute fn, and returns the expected payload
- a failed session execution comes back with `successful: false` and the error text
- stringified-JSON args are normalized before session execution
- direct options together with a session are rejected before any execution

The existing userId tests pass unchanged. All four new tests fail against the previous implementation.

Commands, run locally on Windows with Node 22.14.0 (the repo pins 24.17 in `mise.toml`; pnpm only printed an engine warning):

| Command | Result |
| --- | --- |
| `pnpm install --filter "@composio/google..." --frozen-lockfile` | ok |
| `pnpm turbo build --filter=@composio/google...` | 6/6 tasks ok |
| `pnpm --filter @composio/google test` | 2 files, 21 tests passed |
| `pnpm --filter @composio/google build` | ok |
| `pnpm lint` | exit 0, no findings in `providers/google` |
| `pnpm validate:changesets` | passed |
| `npx tsc --noEmit -p ts/packages/providers/google/tsconfig.json` | 1 error, already on `next` at `wrapTool` (`inputParameters.required`), in code this PR doesn't touch |

`pnpm turbo typecheck --filter=@composio/google` has nothing to run because the package has no `typecheck` script. I didn't run the docs build because `bun` isn't installed locally. The docs change is prose only.

## Changeset

`.changeset/google-session-execute-tool-call.md`: `@composio/google` minor, matching how 760f8d0 released the OpenAI/Anthropic change.

## Docs

`docs/content/docs/providers/google.mdx`: the TypeScript callout no longer says Google's `executeToolCall` can't take a session. It now shows `executeToolCall(session, functionCall)`, gives the version requirement (`@composio/core` >= 0.17.0, `@composio/google` >= 0.12.0), and keeps the warning about meta-tools on the user-ID path. The example code is unchanged.

## Notes

- Python parity isn't part of this PR. I can open a follow-up if you want it.
- I wrote this with AI assistance (Claude Code). I've reviewed the diff and the test results myself.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
