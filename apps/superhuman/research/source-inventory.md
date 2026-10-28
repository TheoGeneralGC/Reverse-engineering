# Captured source inventory

Recorded 2026-10-27. This report contains static findings from the shipped web
client. It does not claim that every candidate feature is enabled or executed.

## Evidence and source identity

- REA parent: `ev_24532bee2b2a260f736402d6848967e04e180e1d92895e5018fec0f1592cfcbf`.
- Operation: `inspect_web_page` against the authenticated `https://mail.superhuman.com/` page.
- Private export: `evidence/private/browser-baseline.bundle.json`.
- Main JS URL: `https://mail.superhuman.com/~backend/build/db8c4288f33febf25ad9.page.js`.
- Main JS SHA-256: `c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`.
- CSS URL was observed as resource `res_fa96a23faeb4dd3c746da4379ac1359c13e58e3d8b52b0960d845b6b97f25c58`:
  `https://mail.superhuman.com/~backend/build/style.page.db8c4288f33febf25ad9.css`.
- That exact stylesheet was separately retrieved with an unauthenticated HTTP GET
  for static inspection; it was not executed or incorporated into implementation.
- Retrieved CSS SHA-256: `487dc45e96a4d54d4069a9552f28f97883ba07f7962b83788e7b5d8d80e2e396`.
- Source copies remain ignored under `evidence/private/`. Do not commit vendor
  source or account data. The references below point into these private files.

Capture coverage is policy-filtered and attach-limited. No sections were marked
truncated. Prior requests, disallowed-origin scripts/resources, most worker
activity, raw headers/bodies, and storage values are absent. Network endpoint
strings below are source candidates rather than requests observed in flight.

## Typography and geometry

Theme-light/dark rules select SuperMailSans unless the legacy-origin theme is
active. Font resources identify the original, but redistribution rights were
not established; preserve them privately and choose a licensed implementation
font until asset use is resolved. CSS contains multiple brands/modes and legacy
overrides. Match the live theme and device pixel ratio before applying a token.

For local visual comparison only, two observed font assets were downloaded into
ignored `web/public/.local/fonts/` storage. Git ignore
was checked for both paths. No redistribution permission is implied.

| Local reference | Observed source resource | SHA-256 |
| --- | --- | --- |
| `regular.woff2` | `https://mail.superhuman.com/~backend/build/61d96e9ccb089bdad7cf.woff2` | `471e0701b832f8974160a91f357bdf5294d0c40cc680d06104bd84180f505da4` |
| `bold.woff2` | `https://mail.superhuman.com/~backend/build/c52edd77feb182576cb3.woff2` | `b79d79f453fd67134a8a6aa96bb23e02a341df8f4685cfeaf304ed03739c1a4f` |

| Measurement | Static declaration | Source location |
| --- | --- | --- |
| Default mail font | SuperMailSans; fallback Superhuman Adelle | CSS line 2, column 677847 (Unicode code points) |
| Regular mail font resource | 61d96e9ccb089bdad7cf.woff2 | CSS line 2, column 677847 (Unicode code points) |
| Bold mail font resource | c52edd77feb182576cb3.woff2 | CSS line 2, column 678368 (Unicode code points) |
| Row height | 36px | CSS line 633, column 579 (Unicode code points) |
| Row padding | top/bottom 10px; left 44px; right calc(2rem - 6px) | CSS line 633, column 579 (Unicode code points) |
| Row text size | 12px; 13px at max-resolution 1dppx; line-height 16px | CSS line 633, column 8041 (Unicode code points) |
| Date column | min-width 52px; right aligned; letter spacing .017em | CSS line 633, column 11403 (Unicode code points) |
| Sender column | flex-basis and max-width 22.5%; padding-right 2rem | CSS line 633, column 3947 (Unicode code points) |
| List inset | padding 0 6px | CSS line 655, column 851 (Unicode code points) |
| Header inset | top 32px; bottom 20px; left 44px | CSS line 654, column 1241 (Unicode code points) |
| Right pane width | clamp(260px,423px,24.47vw + 33*(1440px - 100vw)/480) | CSS line 471, column 5959 (Unicode code points) |
| Content pane minimum | 520px; flex 1 1 auto | CSS line 471, column 5412 (Unicode code points) |
| Focus motion | 256ms transform cubic-bezier(.19,1,.22,1) | CSS line 635, column 290 (Unicode code points) |
| Modern row radius | 4px | CSS line 2, column 223225 (Unicode code points) |

Light Superhuman tokens (some have later mode-specific overrides):

| Role | Value |
| --- | --- |
| Base background | `#ffffff` |
| Right-pane/base accent | `#fcfaf7` |
| Focused row background | `#f7f5ff` |
| Base text | `#141413` |
| Subdued text | `#73716d` |
| Border subdued | `#dedbd5` |
| Later default border | neutral-20 |
| Accent purple | `#714cb6` |
| Multi-selection fill | `#daedfb` |
| Base spacing grid | 4px |

Token references: CSS line 2, column 53722 (Unicode code points);
CSS line 2, column 223324 (Unicode code points).
Focused rows and multi-selected rows have separate visual treatments.

## Keyboard and command candidates

The static `ShortcutsHelp` table starts at JS line 990, column 261404 (Unicode code points).
The table itself applies provider, entitlement, and account-setting hide rules.
Runtime focus region can change the action of a key.

| Area | Declared shortcuts |
| --- | --- |
| Actions | Cmd+K command; `/` search; Z undo; `?` Ask AI |
| Messages | C compose; Enter reply-all/open; R reply; F forward; O expand; Shift+O expand all; Cmd+O links/attachments; Cmd+; snippet |
| Conversations | E archive/done; Shift+E not done; H reminder; S star/flag; U read/unread; I summarize; Shift+M mute; `#` trash/delete; `!` spam/junk; Cmd+U unsubscribe; X select; Esc clear selection |
| Selection | Cmd+A select from here; Cmd+Shift+A select all |
| Navigation | J/K conversation; N/P message; Esc back; Tab/Shift+Tab split; left arrow folders; Space/Shift+Space paging |
| Folder sequences | G then I inbox; O other; S starred; D drafts; T sent; E done; H reminders; M muted; `;` snippets; `!` spam; `#` trash; A all mail; L label (F folder on Microsoft) |
| Composer | Cmd+Shift+O to; C cc; B bcc; F from; S subject; U attachment; H reminder; L send later; Cmd+J AI; Cmd+Shift+, discard; Cmd+Enter send; Cmd+Shift+Enter send-and-done |
| Rich text | Cmd+B/I/U bold/italic/underline; Cmd+K link; Cmd+Shift+X strike; Cmd+Shift+7/8/9 numbers/bullets/quote; Tab indent; Shift+Tab outdent |
| Calendar | 0 day; 2 week; minus/equal previous/next; Cmd+Shift+A availability; B create event; Shift+B empty event when AI enabled |
| Popout | Shift+C compose; Shift+Enter reply-all; Shift+R reply; Shift+F forward; Cmd+Shift+P pop in/out; Cmd+/ popout and search; Cmd+D focus |
| Collaboration | Cmd+S share; M comment; colon reaction; Cmd+Backspace delete comment, all entitlement gated |

The `?` handler varies: Ask AI can occupy it, while a legacy shortcut-help
controller is conditional on AI availability. Do not force a single behavior
without observing the selected account. Microsoft hides Gmail-only labels/mute
and uses flag/delete/junk terminology.

## Backend and integration candidates

These endpoint names are in the captured program, including demo and feature
branches. No request was made to them during this analysis. Backend structure
and model provider cannot be recovered from these names.

| Family | Static path candidates |
| --- | --- |
| Sessions | `/~backend/v3/oauth2.authenticate`, `sessions.signInWithAuthCode`, `sessions.getCsrfToken`, `sessions.getTokens` |
| Mail sync/state | `/~backend/v3/userdata.sync`, `userdata.getThreads`, `userdata.write`, `labels.resync`, `messages.modifyLabels`, `splitInboxes.modify` |
| Delivery/scheduling | `/~backend/messages/send`, `/send/cancel`, `/~backend/reminders/create`, `/cancel`, `/~backend/v3/smartsend.getTimeRange` |
| Attachments | `/~backend/v3/attachments.upload` |
| AI | `/~backend/v3/ai.compose`, `ai.composeEdit`, `ai.composeAgentic`, `ai.tldrSync`, `ai.askAIProxy`, `ai.semanticSearchProxy.user`, `ai.analyzeWritingStyle` |
| Automation | `/~backend/v3/autoLabels.upsert`, `autoLabels.preview`, `autoArchive.upsertRules`, `autoDrafts.previewEAScheduling` |
| Knowledge | `/~backend/v3/knowledgeBase.upsert`, `knowledgeBase.delete` |
| Calendar/conferencing | `/~backend/v3/calendarEvents.create`, `calendarAvailability.create`, `calendars.authenticate`, `microsoftCalendar.proxy`, `zoom.authenticate`, `zoom.createMeeting` |
| Team sharing | `/~backend/v3/userdata.share`, `drafts.share`, `comments.write`, `comments.discard`, `links.react`, `teams.members`, `teams.activity` |
| CRM | `/~backend/v3/crm/hubspot/contact`, `crm.fields/hubspot`, `crm.fields/pipedrive`, `salesforce.fields`, `salesforce.createContact` |

Delivery source reference: JS line 445, column 2946 (Unicode code points).
AI source reference: JS line 445, column 21071 (Unicode code points).
Collaboration source reference: JS line 445, column 26074 (Unicode code points).
CRM source reference: JS line 706, column 398000 (Unicode code points).

Program strings reference Google APIs (`www.googleapis.com`,
`people.googleapis.com`, `gmail.googleapis.com`) and Microsoft Graph
(`graph.microsoft.com`). Presence establishes shipped integration code, not
authentication or successful execution for the current account.

No `api.openai.com`, `chat/completions`, or `anthropic` string was found in this
single main client source. That bounded negative search does not establish the
private AI provider, and API service choices remain implementation decisions.

## Remaining discovery

- Runtime-confirm focus regions, command menu results, provider differences,
  settings screens, compose behavior, and message/keyboard scenarios.
- Capture actual network metadata during representative approved test actions.
- Measure active computed styles at the selected viewport/DPR and theme.
- Inspect independently loaded lazy chunks and workers when they are relevant.
- Verify paid/team/CRM/calendar features with entitled accounts and fixtures.
