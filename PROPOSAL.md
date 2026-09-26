<!--
Posting note (remove before pasting): Krish posts this issue himself on ComposioHQ/composio, after
the Litmus take-home is submitted and before or with the application (plan.md D12). Composio is
issue-first, so this goes up as an issue, not a PR. Every [[pending live run]] / [[report:KEY]]
placeholder must be filled from a stamped reports/REPORT.md first (docs/stamping.md), and
`pnpm check:stamped` must pass.
-->

# Feature request: `irreversibleHint` for tools whose effect can't be undone

## Problem

Composio tags tools with MCP-style behaviour hints (`readOnlyHint`, `destructiveHint`,
`idempotentHint`, `openWorldHint`, `createHint`, `updateHint`, `important`), and Enhanced
Controls (beta) sorts tools into Read / Write / Destructive tiers. Both describe **what an action
changes**. Neither says **whether it can be undone**.

Those are different questions. Sending an email, posting to a Slack channel, inviting a user or
paying an invoice deletes nothing, so none of them is "destructive". None of them can be taken
back either. MCP defines `destructiveHint: false` as "only additive updates", and a delivered
email is additive. An agent gate keyed on `destructiveHint` or the Destructive tier lets every one
of these through at the same level as "create a draft".

Concrete case: `GMAIL_SEND_EMAIL` carries `important`, `openWorldHint` and `createHint`, and no `destructiveHint` [snapshot 2026-09-24, @composio/core 0.21.0](https://github.com/KrishP147/tool-reversibility/blob/main/skilleddocs/plan.md).
Those are exactly the tags on `GMAIL_CREATE_EMAIL_DRAFT`, so a policy built on tags or the derived
tier treats sending an email like saving a draft. Meanwhile `GMAIL_SEND_DRAFT`, which delivers a
message just the same, does carry `destructiveHint` ([fixture](https://github.com/KrishP147/tool-reversibility/blob/main/fixtures/catalog/trimmed/gmail.json), [snapshot 2026-09-24, @composio/core 0.21.0]).
The tags alone can't tell a gate which of these three can be undone.

## Data

From [tool-reversibility](https://github.com/KrishP147/tool-reversibility), an open audit of the
whole Composio catalog. Every number below comes from the stamped report,
[reports/REPORT.md](https://github.com/KrishP147/tool-reversibility/blob/main/reports/REPORT.md). Its header carries the date, commit, `@composio/core`
version, model id, prompt version and catalog manifest hash, plus the command that regenerates it.

**Headline.** Of [[pending live run]] tools that both our classifiers (rules and an LLM) call
irreversible, [[pending live run]] ([[pending live run]]%) carry neither `destructiveHint` nor
any tag that moves them out of the Write tier. `GMAIL_SEND_EMAIL` is one of them.

| catalog                            | value                                            |
| ---------------------------------- | ------------------------------------------------ |
| tools classified (non-deprecated)  | 55,557 [report 2026-09-24, commit a9d50c0]       |
| toolkits                           | 1,562 [report 2026-09-24, commit a9d50c0]        |
| deprecated tools excluded          | 659 [report 2026-09-24, commit a9d50c0]          |
| rules and LLM agree                | [[report:agreement.rate]]                        |
| irreversible, both classifiers (M) | [[report:gap.M]]                                 |
| of those, no `destructiveHint` (N) | [[report:gap.N]]                                 |
| share (P)                          | [[report:gap.P]]                                 |
| same gap, rule classifier alone    | 913 of 6,003 [report 2026-09-24, commit a9d50c0] |

The eight Enhanced Controls apps:

| toolkit         | tools                                   | irreversible (both)                               | no `destructiveHint`                     |
| --------------- | --------------------------------------- | ------------------------------------------------- | ---------------------------------------- |
| Gmail           | 60 [report 2026-09-24, commit a9d50c0]  | [[report:perToolkit.gmail.irreversible]]          | [[report:perToolkit.gmail.gap]]          |
| Outlook         | 287 [report 2026-09-24, commit a9d50c0] | [[report:perToolkit.outlook.irreversible]]        | [[report:perToolkit.outlook.gap]]        |
| Slack           | 159 [report 2026-09-24, commit a9d50c0] | [[report:perToolkit.slack.irreversible]]          | [[report:perToolkit.slack.gap]]          |
| Google Sheets   | 50 [report 2026-09-24, commit a9d50c0]  | [[report:perToolkit.googlesheets.irreversible]]   | [[report:perToolkit.googlesheets.gap]]   |
| Google Calendar | 47 [report 2026-09-24, commit a9d50c0]  | [[report:perToolkit.googlecalendar.irreversible]] | [[report:perToolkit.googlecalendar.gap]] |
| Google Drive    | 91 [report 2026-09-24, commit a9d50c0]  | [[report:perToolkit.googledrive.irreversible]]    | [[report:perToolkit.googledrive.gap]]    |
| GitHub          | 874 [report 2026-09-24, commit a9d50c0] | [[report:perToolkit.github.irreversible]]         | [[report:perToolkit.github.gap]]         |
| Notion          | 54 [report 2026-09-24, commit a9d50c0]  | [[report:perToolkit.notion.irreversible]]         | [[report:perToolkit.notion.gap]]         |

How far to trust the classes: they are our classification, not ground truth. On a hand-labelled
spot-check set (labelled blind, pending review) the rule classifier scores, on "irreversible",
0.667 precision and 0.8 recall over 74 tools [report 2026-09-24, commit a9d50c0], and the report
lists every case where rules and the LLM disagree. The tier is
**derived** from the hints (destructiveHint gives Destructive, readOnlyHint gives Read, anything
else is Write), because neither the SDK nor the REST tool objects expose the real Enhanced
Controls tier. ComposioHQ/composio#4327 shows that the real mapping is keyed by slug and drifts.

## Proposal

1. **`irreversibleHint: boolean` on tools**, next to the existing hints. `true` means that once
   the call succeeds, its effect has left the system and no API call can take it back: a message
   was delivered, money moved, or a record was hard-deleted. It is independent of
   `destructiveHint`. A send is irreversible without being destructive; an archive changes state
   but can be undone.
2. **An "Irreversible" tier (or modifier) in Enhanced Controls** whose default policy is **Ask
   with a preview**: the approver sees the rendered email or message, not only a JSON payload. It
   takes precedence over Write, so a send never runs unasked just because it counts as a write.
3. **Optional `compensatingTool: string`**: the slug of the closest undo when one exists, such as
   a `*_DELETE_*` for a `*_CREATE_*`. An approval UI can then say "can be undone with X" instead
   of a bare "reversible".

## Migration

- Leave `irreversibleHint` absent (unknown) by default rather than `false`, so existing tools
  don't silently claim to be safe.
- Seed values from a classifier like ours, starting with the eight Enhanced Controls apps above,
  and have a person review each toolkit before it ships. Our per-tool classes, reasons and
  disagreements are in `reports/report.json` and free to reuse.
- Session policies can then key on the new hint the same way they key on tags today, e.g.
  `composio.create(userId, { tags: { disable: ["irreversibleHint"] } })`, or an Enhanced Controls
  rule can route it to Ask.

## Prior art

- **MCP tool annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
  `openWorldHint`) are where Composio's hints come from. They describe side effects but not
  reversibility, which is the gap described here.
- **Zephyr** ([github.com/KrishP147/Zephyr](https://github.com/KrishP147/Zephyr), Hack the North 2026) hand-gated `GMAIL_SEND_EMAIL` as irreversible because nothing in the tool's metadata said
  so. Our Devpost feedback asked Composio for this flag.
- Related: ComposioHQ/composio#4327.

## Offer to help

I'm happy to do the work: seed data for the Enhanced Controls apps from the audit, a PR that adds
the field to the TypeScript SDK types, docs for the new tier, or a review of whatever shape you
prefer. The audit is MIT licensed and reproducible end to end; its README has the exact commands.

Not affiliated with Composio.
