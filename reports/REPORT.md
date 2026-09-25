# Tool reversibility report

| stamp | value |
| --- | --- |
| date (snapshot) | 2026-09-24 |
| generatedAt | 2026-09-25T17:52:48.380Z |
| commit | `ace084d6552ad3fa6a4f0ae57a47c186370dc3f1` |
| dirty | false |
| @composio/core | 0.21.0 |
| model | pending |
| llmStatus | recorded |
| promptVersion | classify.v1 |
| manifestSha256 | `b2a64c25fbce549713e44947b5686f01da379a4f2bc1b38e4829428ececd55fb` |
| regenerate | `pnpm audit:cli report --snapshot fixtures/catalog/2026-09-24` |

Classes are **our** classification (plan D1), not ground truth. The tier is **derived** from
hints (destructiveHint -> Destructive, readOnlyHint -> Read, else Write; D6/D22).

## Headline

Of [[pending live run]] tools that both classifiers call irreversible, [[pending live run]] ([[pending live run]]%) carry no `destructiveHint`.

LLM status is `recorded`: live LLM results cover 0 of 55,557 tools (116 recorded synthetic cache entries ignored, D31).
Only rule-classifier numbers below are real; every LLM-dependent number waits for the approved live pass (D11).

## Population

|  | count |
| --- | --- |
| toolkits | 1,562 |
| tools (non-deprecated, the population) | 55,557 |
| deprecated tools excluded | 659 |

## Classes

| class | rules | LLM |
| --- | --- | --- |
| reversible | 32,418 | [[pending live run]] |
| compensable | 14,129 | [[pending live run]] |
| irreversible | 6,009 | [[pending live run]] |
| unknown | 3,001 | [[pending live run]] |

## Rules vs LLM

Agreement rate and the 4x4 confusion matrix: [[pending live run]].

## Single-classifier gap (rules only)

Of 6,009 tools the rules call irreversible, 913 (15.2%) carry no `destructiveHint`.
This is not the D2 headline gap, which also needs the LLM to agree.

## Enhanced Controls apps

| toolkit | tools | irreversible (rules) | no destructiveHint (rules) | irreversible (both) | gap (both) |
| --- | --- | --- | --- | --- | --- |
| gmail | 60 | 10 | 3 | [[pending live run]] | [[pending live run]] |
| outlook | 287 | 64 | 12 | [[pending live run]] | [[pending live run]] |
| slack | 159 | 17 | 6 | [[pending live run]] | [[pending live run]] |
| googlesheets | 50 | 3 | 0 | [[pending live run]] | [[pending live run]] |
| googlecalendar | 47 | 4 | 0 | [[pending live run]] | [[pending live run]] |
| googledrive | 91 | 12 | 2 | [[pending live run]] | [[pending live run]] |
| github | 874 | 87 | 6 | [[pending live run]] | [[pending live run]] |
| notion | 54 | 2 | 0 | [[pending live run]] | [[pending live run]] |

## Spot-check

Hand-labelled set: `fixtures/labels/spotcheck.json`, 74 labels scored. Labelled blind, pending Krish's review.

Rules on "irreversible": precision 0.667, recall 0.800; accuracy 0.770.

| class | labelled | predicted | correct | rules precision | rules recall | LLM precision | LLM recall |
| --- | --- | --- | --- | --- | --- | --- | --- |
| reversible | 18 | 18 | 18 | 1.000 | 1.000 | [[pending live run]] | [[pending live run]] |
| compensable | 21 | 30 | 21 | 0.700 | 1.000 | [[pending live run]] | [[pending live run]] |
| irreversible | 20 | 24 | 16 | 0.667 | 0.800 | [[pending live run]] | [[pending live run]] |
| unknown | 15 | 2 | 2 | 1.000 | 0.133 | [[pending live run]] | [[pending live run]] |

| label \ rules | reversible | compensable | irreversible | unknown |
| --- | --- | --- | --- | --- |
| reversible | 18 | 0 | 0 | 0 |
| compensable | 0 | 21 | 0 | 0 |
| irreversible | 0 | 4 | 16 | 0 |
| unknown | 0 | 5 | 8 | 2 |

## Top 50 gaps: single-classifier (rules only)

Rules say irreversible and there is no `destructiveHint`. These are **single-classifier** candidates,
not D2 gaps. Ranked: Enhanced Controls apps first, then `important`, then rule confidence.

| # | slug | toolkit | rule confidence | tags | rule reason |
| --- | --- | --- | --- | --- | --- |
| 1 | `GMAIL_SEND_EMAIL` | gmail | 1.00 | openWorldHint, createHint, important | verb:SEND |
| 2 | `GMAIL_REPLY_TO_THREAD` | gmail | 0.95 | openWorldHint, createHint, important | verb:REPLY |
| 3 | `OUTLOOK_REPLY_EMAIL` | outlook | 0.95 | openWorldHint, createHint, updateHint, important | verb:REPLY |
| 4 | `OUTLOOK_SEND_EMAIL` | outlook | 0.95 | openWorldHint, createHint, important, email | verb:SEND |
| 5 | `SLACK_SEND_MESSAGE` | slack | 0.95 | openWorldHint, createHint, important, chat | verb:SEND |
| 6 | `GOOGLEDRIVE_CREATE_REPLY` | googledrive | 0.90 | createHint, important, comment, reply | verb:REPLY |
| 7 | `GOOGLEDRIVE_UPDATE_REPLY` | googledrive | 0.90 | updateHint, important, comment, reply | verb:REPLY |
| 8 | `OUTLOOK_FORWARD_MESSAGE` | outlook | 0.90 | updateHint, important, email | verb:FORWARD |
| 9 | `OUTLOOK_FORWARD_USER_CALENDAR_EVENT` | outlook | 0.90 | createHint, important, calendar | verb:FORWARD |
| 10 | `GITHUB_CREATE_A_DEPLOY_KEY` | github | 0.95 | openWorldHint, createHint, repos | verb:DEPLOY |
| 11 | `GITHUB_CREATE_A_REPLY_FOR_A_REVIEW_COMMENT` | github | 0.95 | openWorldHint, createHint, pulls | verb:REPLY |
| 12 | `GMAIL_FORWARD_MESSAGE` | gmail | 0.95 | openWorldHint, createHint | verb:FORWARD |
| 13 | `OUTLOOK_CREATE_DRAFT_REPLY` | outlook | 0.95 | openWorldHint, createHint, updateHint | verb:REPLY |
| 14 | `OUTLOOK_CREATE_FORWARD_DRAFT` | outlook | 0.95 | openWorldHint, createHint, Mail | verb:FORWARD |
| 15 | `OUTLOOK_CREATE_ME_FORWARD_DRAFT` | outlook | 0.95 | openWorldHint, createHint, Mail | verb:FORWARD |
| 16 | `OUTLOOK_CREATE_ME_MESSAGE_REPLY_ALL_DRAFT` | outlook | 0.95 | openWorldHint, createHint, Mail | verb:REPLY |
| 17 | `OUTLOOK_CREATE_ME_REPLY_ALL_DRAFT` | outlook | 0.95 | openWorldHint, createHint, Mail | verb:REPLY |
| 18 | `OUTLOOK_CREATE_REPLY_ALL_DRAFT` | outlook | 0.95 | openWorldHint, createHint, Mail | verb:REPLY |
| 19 | `OUTLOOK_CREATE_USER_MAIL_FOLDER_MESSAGE_REPLY_DRAFT` | outlook | 0.95 | openWorldHint, createHint, Mail | verb:REPLY |
| 20 | `SLACK_INVITE_USER_TO_WORKSPACE` | slack | 0.95 | openWorldHint, createHint, admin, admin.users | verb:INVITE |
| 21 | `SLACK_SEND_EPHEMERAL_MESSAGE` | slack | 0.95 | openWorldHint, createHint, chat | verb:SEND |
| 22 | `SLACK_SEND_ME_MESSAGE` | slack | 0.95 | openWorldHint, createHint, chat | verb:SEND |
| 23 | `GITHUB_MERGE_A_BRANCH` | github | 0.90 | openWorldHint, updateHint, repos | verb:MERGE |
| 24 | `GITHUB_MERGE_A_PULL_REQUEST` | github | 0.90 | openWorldHint, updateHint, pulls | verb:MERGE |
| 25 | `GITHUB_PUBLISH_SPONSORS_TIER_GRAPH_QL` | github | 0.90 | updateHint, GraphQL, Sponsors | verb:PUBLISH |
| 26 | `GITHUB_TRANSFER_A_REPOSITORY` | github | 0.90 | openWorldHint, updateHint, repos | verb:TRANSFER |
| 27 | `OUTLOOK_SEND_DRAFT` | outlook | 0.90 | idempotentHint, updateHint, email, mail | verb:SEND |
| 28 | `SLACK_INVITE_USER_TO_CHANNEL` | slack | 0.90 | openWorldHint, updateHint, admin, admin.conversations | verb:INVITE |
| 29 | `SLACK_INVITE_USERS_TO_A_SLACK_CHANNEL` | slack | 0.90 | openWorldHint, updateHint, conversations | verb:INVITE |
| 30 | `GOOGLESUPER_SEND_EMAIL` | googlesuper | 1.00 | openWorldHint, createHint, important | verb:SEND |
| 31 | `RESEND_SEND_EMAIL` | resend | 1.00 | openWorldHint, createHint, important, email | verb:SEND |
| 32 | `ABLY_PUBLISH_BATCH_MESSAGES` | ably | 0.95 | openWorldHint, createHint, important, messages | verb:PUBLISH |
| 33 | `ABLY_PUBLISH_MESSAGE_TO_CHANNEL` | ably | 0.95 | openWorldHint, createHint, important | verb:PUBLISH |
| 34 | `ABLY_PUBLISH_PUSH_NOTIFICATION` | ably | 0.95 | openWorldHint, createHint, important, push_notifications | verb:PUBLISH |
| 35 | `ABLY_PUBLISH_PUSH_NOTIFICATIONS_BATCH` | ably | 0.95 | openWorldHint, createHint, important, push_notifications | verb:PUBLISH |
| 36 | `ACTIVE_TRAIL_SEND_OPERATIONAL_MESSAGE_EMAIL` | active_trail | 0.95 | openWorldHint, createHint, important, messaging | verb:SEND |
| 37 | `AMARA_SEND_MESSAGE` | amara | 0.95 | openWorldHint, createHint, important, Messages | verb:SEND |
| 38 | `AMPLITUDE_SEND_EVENTS` | amplitude | 0.95 | openWorldHint, createHint, important | verb:SEND |
| 39 | `ANCHOR_BROWSER_DEPLOY_TASK` | anchor_browser | 0.95 | openWorldHint, createHint, important, tasks | verb:DEPLOY |
| 40 | `BASECAMP_POST_BUCKETS_MESSAGE_BOARDS_MESSAGES` | basecamp | 0.95 | openWorldHint, createHint, important, message_boards_and_messages | verb:POST |
| 41 | `BASECAMP_POST_BUCKETS_RECORDINGS_COMMENTS` | basecamp | 0.95 | openWorldHint, createHint, important, comments | verb:POST |
| 42 | `BASECAMP_POST_BUCKETS_TODOLISTS_COMMENTS` | basecamp | 0.95 | openWorldHint, createHint, important, comments | verb:POST |
| 43 | `BASECAMP_POST_BUCKETS_TODOLISTS_TODOS` | basecamp | 0.95 | openWorldHint, createHint, important, todos_and_lists | verb:POST |
| 44 | `BASECAMP_POST_BUCKETS_TODOS_COMMENTS` | basecamp | 0.95 | openWorldHint, createHint, important, comments | verb:POST |
| 45 | `BASECAMP_POST_PROJECTS` | basecamp | 0.95 | openWorldHint, createHint, important, projects_and_teams | verb:POST |
| 46 | `BOTPRESS_SEND_MESSAGE` | botpress | 0.95 | openWorldHint, createHint, important, messaging | verb:SEND |
| 47 | `CALENDARHERO_SEND_ASSISTANT_MESSAGE` | calendarhero | 0.95 | openWorldHint, createHint, important, Messaging | verb:SEND |
| 48 | `CALLPAGE_POST_CREATE_MANAGER` | callpage | 0.95 | openWorldHint, createHint, important, Managers | verb:POST |
| 49 | `CANVA_POST_DESIGNS` | canva | 0.95 | openWorldHint, createHint, important, design_creation_and_organization | verb:POST |
| 50 | `CANVA_POST_EXPORTS` | canva | 0.95 | openWorldHint, createHint, important, exports_and_formats | verb:POST |

## Disagreement sample

Seeded 25-row sample of rules-vs-LLM disagreements: [[pending live run]].
