# Side quests: ComposioHQ/composio

Drafts for plan §6 item 9. Nothing here has been posted or pushed (as of 2026-10-05). Every step below is done by a human.

## Status (2026-10-05)

- **#4571 superseded.** jkomyno merged ComposioHQ/composio#4675 on 2026-09-28. It adds session overloads to Google + Cloudflare `executeToolCall`, OpenAI Responses `handleResponse` and Python Google, and closes #4571. Our local fork branch `krish/4571-google-session-parity` (`C:\Users\User\_worktrees\composio`, 3 commits, never pushed) is redundant. Don't post `4571-comment.md` or `4571-pr-body.md`; they're kept as a record only.
- **#4286 superseded.** tarunvashishth posted the same diagnosis and opened ComposioHQ/composio#4665 (widens `ToolRouterAuthorizeFn`, still open on 2026-10-05). Don't post `4286.md`.
- **#4509 still open.** No comments yet, so `4509.md` is still postable.
- **`sdk-schema-rejection.md` still valid.** Re-verified on `@composio/core@0.22.0` and on `next` at 2a1e9001: the same 6/8 toolkits fail offline, and the dup check was re-run with no match.

| File | What it is | Status |
| --- | --- | --- |
| `4571-comment.md` | Issue-first comment for #4571 | superseded by #4675 |
| `4571-pr-body.md` | PR body for #4571 | superseded by #4675 |
| `4286.md` | Comment for #4286 (sample or types?) | superseded by #4665 |
| `4509.md` | Comment for #4509: the three questions only, no fix | postable |
| `sdk-schema-rejection.md` | New issue: `getRawComposioTools` throws for 8 toolkits on malformed `inputParameters` | postable |

## Steps (human)

1. `sdk-schema-rejection.md`: re-check for dups, drop the leading `<!-- -->` line, then post it as a new issue on ComposioHQ/composio (title from `## Title`). If a maintainer agrees with the `safeParse` + warn/skip suggestion, a fix PR off `next` (`krish/schema-safeparse`) is a natural follow-up.
2. `4509.md`: drop the leading `<!-- -->` line and post it on #4509. Wait for answers and don't guess at a fix.
3. Optional cleanup: delete the stale fork branch with `git -C C:\Users\User\_worktrees\composio switch next` and then `git branch -D krish/4571-google-session-parity`.

## Open points from the #4571 draft (historical; #4675 resolved them)

- The `@composio/core` peer lower bound for `@composio/google` stays at `>=0.16.0`, which mirrors Anthropic/OpenAI, but the change needs core >= 0.17.0. Raise it?
- The session path returns the OpenAI-style full result, not Anthropic's `data`/`{ error }`. It was chosen to keep Google's current success payload.
