# Side quests: ComposioHQ/composio

Drafts for plan §6 item 9. Nothing here has been posted or pushed. Every step below is done by a human.

Local fork checkout: `C:\Users\User\_worktrees\composio`, branch `krish/4571-google-session-parity` (off `next` at d3005fb). It has three local commits and hasn't been pushed.

| File | What it is |
| --- | --- |
| `4571-comment.md` | Issue-first comment for #4571, which asks for a go-ahead |
| `4571-pr-body.md` | PR body for #4571, including the exact commands and results |
| `4286.md` | Comment for #4286: sample or types? (proposed fix included) |
| `4509.md` | Comment for #4509: the three questions only, no fix |
| `sdk-schema-rejection.md` | New issue draft: `getRawComposioTools` throws for 8 toolkits on malformed `inputParameters` |

## Steps

1. Post `4571-comment.md` on #4571, `4286.md` on #4286 and `4509.md` on #4509. Drop the leading `<!-- -->` line from each before posting.
2. Wait for a maintainer to ack on #4571 (CONTRIBUTING.md asks for issue-first).
3. Once it's acked, re-run the checks if `next` has moved: rebase onto `upstream/next`, then run `pnpm --filter @composio/google test` and `pnpm lint`. Then push the branch:
   `git -C C:\Users\User\_worktrees\composio push -u origin krish/4571-google-session-parity`
4. Open a PR from `KrishP147:krish/4571-google-session-parity` against `ComposioHQ:next`. Use the title in the header of `4571-pr-body.md` and the rest of that file as the body, then request review from @jkomyno.
5. Python parity (the `python/providers/google` equivalent) comes only after a maintainer acks the TS PR (D14).
6. #4286: once a maintainer picks option 1 or 2, branch `krish/4286-...` off `next` and apply that fix. Option 1 needs a patch changeset for `@composio/core`.
7. #4509: wait for answers, and don't guess at a fix.
8. `sdk-schema-rejection.md`: re-check for dups, then post as a new issue on ComposioHQ/composio (title from the draft's `## Title`); drop the leading `<!-- -->` line first.

## Open points to confirm with the maintainer

- The `@composio/core` peer lower bound for `@composio/google` stays at `>=0.16.0`, which mirrors Anthropic/OpenAI, but the change needs core >= 0.17.0. Raise it?
- The session path returns the OpenAI-style full result, not Anthropic's `data`/`{ error }`. It was chosen to keep Google's current success payload.
