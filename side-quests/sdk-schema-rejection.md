<!-- draft, not posted -->

## Title

[Bug]: `getRawComposioTools` throws ZodError for a whole toolkit when one tool's inputParameters isn't a strict JSON-schema object (8 toolkits: boolean/oneOf/allOf nodes)

## Summary

`@composio/core@0.21.0`.

`Tools.getRawComposioTools({ toolkits })` runs every tool's `inputParameters` through `ToolSchema.parse` in `transformToolCases` (not `safeParse`). If one tool's `inputParameters` doesn't conform (boolean JSON-schema node, draft-04-style boolean keyword, top-level `oneOf`/`allOf` with no `type: "object"`), the whole call throws and no tools for that toolkit return. #3354/#3397 normalized *empty* `input_parameters`/`output_parameters` before strict validation, but left non-empty malformed schemas unchanged.

Reproduced offline by re-parsing stored REST tool JSON via `ToolSchema.safeParse`. 8 of 1562 toolkits fail:

| Toolkit (fail/total) | Failing tool | zod path | Message |
| --- | --- | --- | --- |
| coinbase_wallet_mcp (1/15) | COINBASE_WALLET_MCP_CHAIN_RPC_REQUEST | `inputParameters.properties.params.items` | Invalid input (node is boolean `true`) |
| datadog_mcp (1/370) | DATADOG_MCP_AGGREGATE_DORA_EVENTS | `inputParameters.properties.formulas.items` | Invalid input (`true`) |
| honeycomb_mcp (2/33) | HONEYCOMB_MCP_CREATE_TRIGGER | `inputParameters.properties.query.properties.filters.items` | Invalid input |
| ramp_mcp (4/213) | RAMP_MCP_RAMP_FUND_X402_WALLET | `inputParameters.properties.amount.oneOf.0.exclusiveMinimum` | Expected number, received boolean (draft-04 boolean `exclusiveMinimum`) |
| runway (6/22) | RUNWAY_GENERATE_IMAGE | `inputParameters.type` | Invalid literal, expected "object" (top level is `oneOf`, no `type`) |
| tiktok_ads (1/142) | TIKTOK_ADS_GET_SMART_PLUS_MATERIAL_REPORT | `inputParameters.allOf.1.then.properties.query_lifetime` | Expected object, received boolean |
| highlevel_mcp (0/36) | n/a | n/a | not reproduced offline; `inputParameters` all pass — rejection presumably in `outputParameters` (not in this snapshot) |
| longbridge_mcp (0/161) | n/a | n/a | same as above |

## Repro

```ts
composio.tools.getRawComposioTools({ toolkits: ["runway"] });
```
Throws `ZodError` at `inputParameters.type` before returning anything. Offline, no key: `pnpm exec tsx packages/audit/scripts/sdk-schema-repro.ts --dir <catalog-snapshot-dir>`.

## Expected vs actual

Expected: tools returned, non-conforming per-tool schemas tolerated or skipped. Actual: the whole call throws `ZodError` (all 8 toolkits fall back in our audit).

## Suggestion

`transformToolCases` should `safeParse` each tool and warn+skip failures, not `parse` the batch. Separately, `ToolSchema`/`ParametersSchema` could accept boolean JSON-schema nodes and non-object top-level schemas, since MCP toolkits emit valid JSON Schema in these shapes.

## Duplicate check

Searched `gh search issues --repo ComposioHQ/composio schema getRawComposioTools`, plus "ZodError inputParameters", "boolean schema", "ToolSchema" (2026-09-26). No match. Closest: #3354 (closed, fixed by #3397), same code path but for empty `outputParameters`, not malformed non-empty `inputParameters`.
