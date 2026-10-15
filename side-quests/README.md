# Side quests: ComposioHQ/composio

Upstream drafts that came out of building this repo. Each file is a comment or issue for
ComposioHQ/composio; the header comment in each says where it belongs.

| File                                 | What it is                                                                                                                                                                                   | Status (2026-10-05)                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `sdk-schema-rejection.md`            | New issue: `getRawComposioTools` throws for a whole toolkit when one tool's `inputParameters` isn't a strict JSON-schema object. Offline repro: `packages/audit/scripts/sdk-schema-repro.ts` | open draft, re-verified on `@composio/core@0.22.0` |
| `4509.md`                            | Comment for #4509: the reporter's three questions, no fix proposed                                                                                                                           | open draft                                         |
| `4571-comment.md`, `4571-pr-body.md` | Comment + PR body for #4571 (session overloads for the Google provider)                                                                                                                      | superseded by ComposioHQ/composio#4675             |
| `4286.md`                            | Comment for #4286 (`authorize()` runtime vs public type)                                                                                                                                     | superseded by ComposioHQ/composio#4665             |
