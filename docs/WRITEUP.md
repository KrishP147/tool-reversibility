# Can this agent action be undone?

_Krish (KrishP147), 2026-09-26_

At Hack the North 2026 my team built Zephyr, an agent project that acts through Composio. It made
the top 12 of the Warp track. The part I kept coming back to was a hand-written rule: treat
`GMAIL_SEND_EMAIL` as irreversible and always ask a human first. Nothing in the tool's metadata
told us to do that; we knew because we had read the slug. Our Devpost feedback asked Composio for
exactly that flag.

Composio tags every tool with MCP-style hints (`readOnlyHint`, `destructiveHint`, `createHint` and
so on), and Enhanced Controls groups tools into Read / Write / Destructive tiers. Those describe
what an action changes. They don't say whether it can be undone, which is what an agent gate needs
to know. A delivered email deletes nothing, so it isn't "destructive", but it can't be taken back
either. `GMAIL_SEND_EMAIL` is tagged `important`, `openWorldHint` and `createHint`,
with no `destructiveHint` [snapshot 2026-09-24, @composio/core 0.21.0](../skilleddocs/plan.md).

So I built [tool-reversibility](../README.md) to measure that gap across the catalog.

## Four classes

I sort each tool into one of four classes (my classification, not ground truth):

- **reversible**: no external effect, e.g. `GMAIL_FETCH_EMAILS`;
- **compensable**: it changes state, but an inverse API call exists, e.g. `GMAIL_MOVE_TO_TRASH`;
- **irreversible**: the effect leaves the system (a message delivered, money moved, a hard
  delete), e.g. `GMAIL_SEND_EMAIL`;
- **unknown**: can't tell from the metadata, e.g. `COMPOSIO_MULTI_EXECUTE_TOOL`, which runs
  whatever it is handed.

## Method

1. **Fetch.** I paged the full catalog, 1,562 toolkits and 56,216 tools [snapshot 2026-09-24, @composio/core 0.21.0](../skilleddocs/plan.md).
2. **Hints and tier.** Tags map to seven hint booleans. The SDK doesn't expose the Enhanced
   Controls tier on tools or toolkits, so I derive one (destructiveHint gives Destructive,
   readOnlyHint gives Read, anything else is Write) and label the column "derived".
3. **Rules.** A pure, table-tested classifier reads the slug verb, description and schema. Every
   verdict carries named evidence, such as `verb:SEND` or `desc:"restore"`, so it can be checked.
4. **LLM.** A second classifier sends tools through the Anthropic Batches API with a structured
   output schema and caches every answer. It cannot spend anything until a local `--dry-run` cost
   estimate has been shown to a human and approved.
5. **Compare.** A tool is a **gap** when both classifiers call it irreversible and it has no
   `destructiveHint`. The rules-only version is reported separately.
6. **Spot-check.** A stratified, hand-labelled set scores the classifiers with precision and
   recall.

## What the rules found

Everything below is in the stamped [report](../reports/REPORT.md). The population is 55,557
non-deprecated tools [report 2026-09-24, commit a9d50c0].

| class        | rules                                      |
| ------------ | ------------------------------------------ |
| reversible   | 32,418 [report 2026-09-24, commit a9d50c0] |
| compensable  | 14,135 [report 2026-09-24, commit a9d50c0] |
| irreversible | 6,003 [report 2026-09-24, commit a9d50c0]  |
| unknown      | 3,001 [report 2026-09-24, commit a9d50c0]  |

Of the tools the rules call irreversible, 913 of 6,003 (15.2%) carry no `destructiveHint` [report 2026-09-24, commit a9d50c0].
The top of that list: `GMAIL_SEND_EMAIL`, `GMAIL_REPLY_TO_THREAD`, `OUTLOOK_SEND_EMAIL`,
`SLACK_SEND_MESSAGE`. The derived tier puts every one in Write, next to saving a draft.

On the spot-check set, the rules score 0.667 precision and 0.800 recall on "irreversible" [report 2026-09-24, commit a9d50c0].
Their main weakness is `unknown`: they almost never admit it, and guess a class instead.

## What this does not show yet

- **The LLM columns are empty.** The headline gap needs both classifiers to agree, and the LLM
  pass has not run live, so the gap and the agreement rate are [[pending live run]].
- **The labels are provisional.** The spot-check labels were made blind and are still pending my
  review, so the precision and recall above may move.
- **The rules are heuristics.** A verb like SEND or POST is strong evidence, not proof. Some
  "POST" tools just create a record that can be deleted later.

## The demo

The repo also ships an approval inbox: the "ask" step I wanted in Zephyr. Each pending action gets a
reversibility badge, the rule reasons, a rendered preview for sends or a payload diff for updates,
and Approve / Reject / Edit with an append-only audit log. It runs on fixtures with zero keys by
default.

`pnpm demo:agent` runs a scripted agent (no LLM, mock session by default) that tries to send an
email. Its tools come from `session.tools()` with a `beforeExecute` guard, which throws and queues
a pending row for the live inbox, so nothing is sent.
This is a proposal queue, not a server-side gate. The hook relies on
undocumented `@composio/core` 0.21.0 behaviour, and a caller that uses `session.execute()` directly
skips it entirely. That limit is the argument for putting this in Composio itself.

## The proposal

[PROPOSAL.md](../PROPOSAL.md) is a ready-to-post feature request with three parts:

1. an `irreversibleHint` on tools, independent of `destructiveHint`, left unset rather than
   `false` until someone has reviewed the tool;
2. an **Irreversible** tier in Enhanced Controls that defaults to "ask with a preview" and wins
   over Write;
3. an optional `compensatingTool` slug, so an approval screen can say "undo with X" instead of a
   bare "reversible".

Seed it from a classifier like this one, starting with the eight Enhanced Controls apps, and have
a person review each toolkit before it ships.

What I'd want to build next at Composio is that reviewed hint, wired into the approval flow, so an
agent developer never has to hand-write the rule we wrote for `GMAIL_SEND_EMAIL`.
