<!-- Draft comment for https://github.com/ComposioHQ/composio/issues/4571. Post by hand. Keep under 120 words. -->

Hi, I'd like to pick this up if nobody else is on it.

Plan: add the same two `executeToolCall` overloads the OpenAI and Anthropic providers have, `(session: ToolCallSession, tool)` and `(userId, tool, options?, modifiers?)`, with the implementation routed through `BaseProvider.executeToolForTarget`. The userId path and its return payload stay as they are today. TypeScript only for now; I can follow up with Python if you want parity there.

The PR would include tests mirroring the Anthropic/OpenAI session cases (session meta-tool routing, error result, options rejected with a session), a minor changeset for `@composio/google`, and an update to the callout in `providers/google.mdx`.

Does that sound right? Happy to adjust before opening anything.
