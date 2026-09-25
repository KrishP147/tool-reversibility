# Tool reversibility report

| stamp | value |
| --- | --- |
| date (snapshot) | 2026-09-24 |
| generatedAt | 2026-09-25T17:41:22.431Z |
| commit | `30e305ea4c2ad080a3390e490256766d586c6f91` |
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
| reversible | 32,440 | [[pending live run]] |
| compensable | 13,515 | [[pending live run]] |
| irreversible | 5,966 | [[pending live run]] |
| unknown | 3,636 | [[pending live run]] |

## Rules vs LLM

Agreement rate and the 4x4 confusion matrix: [[pending live run]].

## Single-classifier gap (rules only)

Of 5,966 tools the rules call irreversible, 989 (16.6%) carry no `destructiveHint`.
This is not the D2 headline gap, which also needs the LLM to agree.

## Enhanced Controls apps

| toolkit | tools | irreversible (rules) | no destructiveHint (rules) | irreversible (both) | gap (both) |
| --- | --- | --- | --- | --- | --- |
| gmail | 60 | 12 | 5 | [[pending live run]] | [[pending live run]] |
| outlook | 287 | 64 | 12 | [[pending live run]] | [[pending live run]] |
| slack | 159 | 16 | 6 | [[pending live run]] | [[pending live run]] |
| googlesheets | 50 | 3 | 0 | [[pending live run]] | [[pending live run]] |
| googlecalendar | 47 | 4 | 0 | [[pending live run]] | [[pending live run]] |
| googledrive | 91 | 12 | 2 | [[pending live run]] | [[pending live run]] |
| github | 874 | 81 | 6 | [[pending live run]] | [[pending live run]] |
| notion | 54 | 3 | 1 | [[pending live run]] | [[pending live run]] |

## Spot-check

Hand-labelled set: `fixtures/labels/spotcheck.json`, 74 labels scored. Labelled blind, pending Krish's review.

Rules on "irreversible": precision 0.640, recall 0.800; accuracy 0.757.

| class | labelled | predicted | correct | rules precision | rules recall | LLM precision | LLM recall |
| --- | --- | --- | --- | --- | --- | --- | --- |
| reversible | 18 | 18 | 18 | 1.000 | 1.000 | [[pending live run]] | [[pending live run]] |
| compensable | 21 | 29 | 20 | 0.690 | 0.952 | [[pending live run]] | [[pending live run]] |
| irreversible | 20 | 25 | 16 | 0.640 | 0.800 | [[pending live run]] | [[pending live run]] |
| unknown | 15 | 2 | 2 | 1.000 | 0.133 | [[pending live run]] | [[pending live run]] |

| label \ rules | reversible | compensable | irreversible | unknown |
| --- | --- | --- | --- | --- |
| reversible | 18 | 0 | 0 | 0 |
| compensable | 0 | 20 | 1 | 0 |
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
| 6 | `GMAIL_PATCH_SEND_AS` | gmail | 0.90 | idempotentHint, openWorldHint, updateHint, important, send_as_aliases | verb:SEND |
| 7 | `GOOGLEDRIVE_CREATE_REPLY` | googledrive | 0.90 | createHint, important, comment, reply | verb:REPLY |
| 8 | `GOOGLEDRIVE_UPDATE_REPLY` | googledrive | 0.90 | updateHint, important, comment, reply | verb:REPLY |
| 9 | `NOTION_SEND_FILE_UPLOAD` | notion | 0.90 | openWorldHint, updateHint, important, file_uploads | verb:SEND |
| 10 | `OUTLOOK_FORWARD_MESSAGE` | outlook | 0.90 | updateHint, important, email | verb:FORWARD |
| 11 | `OUTLOOK_FORWARD_USER_CALENDAR_EVENT` | outlook | 0.90 | createHint, important, calendar | verb:FORWARD |
| 12 | `GITHUB_CREATE_A_DEPLOY_KEY` | github | 0.95 | openWorldHint, createHint, repos | verb:DEPLOY |
| 13 | `GITHUB_CREATE_A_REPLY_FOR_A_REVIEW_COMMENT` | github | 0.95 | openWorldHint, createHint, pulls | verb:REPLY |
| 14 | `GMAIL_FORWARD_MESSAGE` | gmail | 0.95 | openWorldHint, createHint | verb:FORWARD |
| 15 | `OUTLOOK_CREATE_DRAFT_REPLY` | outlook | 0.95 | openWorldHint, createHint, updateHint | verb:REPLY |
| 16 | `OUTLOOK_CREATE_FORWARD_DRAFT` | outlook | 0.95 | openWorldHint, createHint, Mail | verb:FORWARD |
| 17 | `OUTLOOK_CREATE_ME_FORWARD_DRAFT` | outlook | 0.95 | openWorldHint, createHint, Mail | verb:FORWARD |
| 18 | `OUTLOOK_CREATE_ME_MESSAGE_REPLY_ALL_DRAFT` | outlook | 0.95 | openWorldHint, createHint, Mail | verb:REPLY |
| 19 | `OUTLOOK_CREATE_ME_REPLY_ALL_DRAFT` | outlook | 0.95 | openWorldHint, createHint, Mail | verb:REPLY |
| 20 | `OUTLOOK_CREATE_REPLY_ALL_DRAFT` | outlook | 0.95 | openWorldHint, createHint, Mail | verb:REPLY |
| 21 | `OUTLOOK_CREATE_USER_MAIL_FOLDER_MESSAGE_REPLY_DRAFT` | outlook | 0.95 | openWorldHint, createHint, Mail | verb:REPLY |
| 22 | `SLACK_INVITE_USER_TO_WORKSPACE` | slack | 0.95 | openWorldHint, createHint, admin, admin.users | verb:INVITE |
| 23 | `SLACK_SEND_EPHEMERAL_MESSAGE` | slack | 0.95 | openWorldHint, createHint, chat | verb:SEND |
| 24 | `SLACK_SEND_ME_MESSAGE` | slack | 0.95 | openWorldHint, createHint, chat | verb:SEND |
| 25 | `GITHUB_MERGE_A_BRANCH` | github | 0.90 | openWorldHint, updateHint, repos | verb:MERGE |
| 26 | `GITHUB_MERGE_A_PULL_REQUEST` | github | 0.90 | openWorldHint, updateHint, pulls | verb:MERGE |
| 27 | `GITHUB_PUBLISH_SPONSORS_TIER_GRAPH_QL` | github | 0.90 | updateHint, GraphQL, Sponsors | verb:PUBLISH |
| 28 | `GITHUB_TRANSFER_A_REPOSITORY` | github | 0.90 | openWorldHint, updateHint, repos | verb:TRANSFER |
| 29 | `GMAIL_UPDATE_SEND_AS` | gmail | 0.90 | openWorldHint, updateHint, send_as_aliases | verb:SEND |
| 30 | `OUTLOOK_SEND_DRAFT` | outlook | 0.90 | idempotentHint, updateHint, email, mail | verb:SEND |
| 31 | `SLACK_INVITE_USER_TO_CHANNEL` | slack | 0.90 | openWorldHint, updateHint, admin, admin.conversations | verb:INVITE |
| 32 | `SLACK_INVITE_USERS_TO_A_SLACK_CHANNEL` | slack | 0.90 | openWorldHint, updateHint, conversations | verb:INVITE |
| 33 | `GOOGLESUPER_SEND_EMAIL` | googlesuper | 1.00 | openWorldHint, createHint, important | verb:SEND |
| 34 | `RESEND_SEND_EMAIL` | resend | 1.00 | openWorldHint, createHint, important, email | verb:SEND |
| 35 | `ABLY_PUBLISH_BATCH_MESSAGES` | ably | 0.95 | openWorldHint, createHint, important, messages | verb:PUBLISH |
| 36 | `ABLY_PUBLISH_MESSAGE_TO_CHANNEL` | ably | 0.95 | openWorldHint, createHint, important | verb:PUBLISH |
| 37 | `ABLY_PUBLISH_PUSH_NOTIFICATION` | ably | 0.95 | openWorldHint, createHint, important, push_notifications | verb:PUBLISH |
| 38 | `ABLY_PUBLISH_PUSH_NOTIFICATIONS_BATCH` | ably | 0.95 | openWorldHint, createHint, important, push_notifications | verb:PUBLISH |
| 39 | `ACTIVE_TRAIL_SEND_OPERATIONAL_MESSAGE_EMAIL` | active_trail | 0.95 | openWorldHint, createHint, important, messaging | verb:SEND |
| 40 | `AMARA_SEND_MESSAGE` | amara | 0.95 | openWorldHint, createHint, important, Messages | verb:SEND |
| 41 | `AMPLITUDE_SEND_EVENTS` | amplitude | 0.95 | openWorldHint, createHint, important | verb:SEND |
| 42 | `ANCHOR_BROWSER_DEPLOY_TASK` | anchor_browser | 0.95 | openWorldHint, createHint, important, tasks | verb:DEPLOY |
| 43 | `BASECAMP_POST_BUCKETS_MESSAGE_BOARDS_MESSAGES` | basecamp | 0.95 | openWorldHint, createHint, important, message_boards_and_messages | verb:POST |
| 44 | `BASECAMP_POST_BUCKETS_RECORDINGS_COMMENTS` | basecamp | 0.95 | openWorldHint, createHint, important, comments | verb:POST |
| 45 | `BASECAMP_POST_BUCKETS_TODOLISTS_COMMENTS` | basecamp | 0.95 | openWorldHint, createHint, important, comments | verb:POST |
| 46 | `BASECAMP_POST_BUCKETS_TODOLISTS_TODOS` | basecamp | 0.95 | openWorldHint, createHint, important, todos_and_lists | verb:POST |
| 47 | `BASECAMP_POST_BUCKETS_TODOS_COMMENTS` | basecamp | 0.95 | openWorldHint, createHint, important, comments | verb:POST |
| 48 | `BASECAMP_POST_PROJECTS` | basecamp | 0.95 | openWorldHint, createHint, important, projects_and_teams | verb:POST |
| 49 | `BOTPRESS_SEND_MESSAGE` | botpress | 0.95 | openWorldHint, createHint, important, messaging | verb:SEND |
| 50 | `BRILLIANT_DIRECTORIES_CREATE_DATA_POST` | brilliant_directories | 0.95 | openWorldHint, createHint, important, content | verb:POST |

## Disagreement sample

Seeded 25-row sample of rules-vs-LLM disagreements: [[pending live run]].
