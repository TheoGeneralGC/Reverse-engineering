# Ask AI: answer presentation, retrieval and action boundaries

Recorded 2026-10-28. This combines focused static analysis with retained original
browser captures made by the root investigator, followed by a comparison with
the replica's current source. The later captures submitted fictional formatting
facts and a query about an already owned synthetic email fixture to original Ask
AI. This document's author only inspected retained artifacts; no private vendor
endpoint or local Claude request was made by that inspection. No Ask AI parity
is verified. The proposed reconstruction contract is in
[ai-chat-contract.md](ai-chat-contract.md).

## Identity, method and coverage

- Original: authenticated `https://mail.superhuman.com/`, web build
  `db8c4288f33febf25ad9`, Chrome `156.0.8078.48`. This is the shipped web client;
  native macOS implementation details and the private server were not inspected.
- Retained source parent:
  `ev_24532bee2b2a260f736402d6848967e04e180e1d92895e5018fec0f1592cfcbf`,
  private `browser-baseline.bundle.json`. Main script SHA-256:
  `c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`.
- Pinned `npm run rea -- analyze-javascript-application` used REA 6.8.0,
  installed `reverse-engineer-anything` skill 49 and existing Node 24.22.1.
  Fifteen focused excerpts produced
  `ev_8d8afe9139efe1a41a6fd17b5eb95a570d621941f6d15ca38092cfe5f95a1343`:
  53,349 source bytes, 15 parsed files, zero parse failures, partial application
  graph and 2,984 semantic unknowns. Nine follow-up excerpts produced
  `ev_d03a4dc583ffee474cda5228aee273d17b543113a03f53ddd48fe77c82c19878`:
  nine parsed files, zero parse failures and 804 semantic unknowns. Its complete
  selected-container coverage does not mean complete original-application
  coverage. External services, injected dependencies and dynamic behavior remain
  unresolved.
- Excerpts were selected and syntax-checked as inert expressions. Classes were
  wrapped for parsing; no captured program was executed. Private
  `ai-assistant/selection-identity.json` and `selection-identity-details.json`
  preserve original ranges and fragment/analysis-file hashes. Complete REA exports
  are `analysis-approved.bundle.json` and `analysis-details.bundle.json` in that
  directory. No vendor code is copied into this report or product code.
- The first sandboxed analysis failed during macOS helper compilation, before
  source parsing, returning partial
  `ev_1d1474874fd89a67b1259cdb5c63e05bddda2f75e36766694f5b32bf5f1b528a`.
  Doctor confirmed aligned CLI/skill registration. The subsequent host-approved
  offline run succeeded; no engine installation or configuration change was made.
  The failed run supplies no semantic coverage.

Locations below are one-based lines and zero-based UTF-16 columns in that exact
main script. Selection-container line numbers are different. The source capture
is attach-limited/policy-filtered; prior traffic, most workers, raw network bodies
and storage values are absent.
The later original scenarios retain browser/target metadata but do not add a new
main-script digest. Their DOM behavior and these retained static declarations
are complementary evidence, not a fully captured causal execution trace.

## Observed original runtime

### Earlier empty-pane capture

Retained `discovery-session.bundle.json`, evidence
`ev_0e014b9b26d5cd9ce0676f08f66e8d1915792cb43aa3cc7d8bab4aaca6b00292`,
contains an empty Ask AI pane in the DOM attached to step `settings` (index 2).
That click **failed**. The DOM establishes the captured end state, not which
earlier action opened the pane. The scenario reports missing action/events and
`equality_eligible=false`; the failed step lacks action coverage.

The DOM contains `.AISidebar`, its header and empty state, `.AIAgent-input`,
`.AI-send-button`, placeholder suggestions and a knowledge-base entry point.
The AI send control has the accessible label `Send message`. There are zero
answer nodes and citation nodes in this snapshot. The editor container contains
a `Shadowbox ComposeFormEditor`; its editable internals are not retained here.
Private sanitized structure is in
`ai-assistant/sanitized-runtime-structure-corrected.json`.

The original selection-writing Shorten result in [ai-writing.md](ai-writing.md)
is a separate editor workflow. It does not verify sidebar answers, retrieval,
citations, sessions or action cards. The later sidebar probes below supersede
the earlier empty-pane-only observation without repairing its failed action.

### Fictional formatting answer

`original-formatting.json`, evidence
`ev_85d271e29959e394baa6fe59e064a3d5b6c491fc7aa378af8b98ffe4a74d1b94`,
declares nine actions and retains ten steps including scenario start. Every step
completed. Submission first shows `.AIAgent-message-answer.loading`; subsequent
answer/table/code waits and the final settle capture show rendered content with
no loading, streaming or stopped class. These states establish the captured
transition, not provider timing or a complete stream-event record.

The final answer has one `h2`, one `ul` with two `li` and two bold `b` labels,
one `table` with a two-cell header and two two-cell body rows, and one inline
`code`. The heading has `sh-preserve-font-size`. The same answer text is retained
through all four answer-visible/table/code/settle captures. There are no citation
bubbles or source rows for this fictional-facts prompt. This establishes these
specific rendered Markdown structures, not every Markdown feature.

The private 2880-by-1800 screenshot shows the Ask AI rail beside the mailbox,
a lavender question block, a stacked answer below a “Done thinking” status,
an unbordered compact table, monospace inline code, answer controls, and an input
anchored near the rail bottom. Requested viewport/DPR settings are not measured
CSS geometry; exact sizing, scrolling, clipboard fidelity and responsive behavior
remain unmeasured. The screenshot includes inbox material and stays private.

### Controlled citation, history and source navigation

| Capture | Evidence and bounded result |
| --- | --- |
| Rejected request | `original-citation-invalid-request.json` was rejected for an unsupported wait action, before a scenario/evidence ID or question submission. |
| Closed-rail attempt | `ev_124f9fee342b091b6a5e0b5da189cdadb420785069dbc6082bafcfa2a6986926`: three steps completed, the new-conversation action failed, and five later steps were cancelled. The query was not submitted. |
| Actual question | `ev_e4425d7b7814beb8d5c5d82860bda91af861237277368ed90dd08c4aee53e158`: seven actions/eight steps completed, but the captured answer was still loading/streaming after the requested settle wait. Completed steps did not establish answer completion. |
| Later passive observation | `ev_84f9a41503c0b3cacbefa6e4aa125be87bc0c1938a9390c15e66dddc0a1a41c2`: the root investigator observed a settled answer naming the exact controlled synthetic subject and UTF-8 attachment filename, with a Sources control. This passive capture is attach-limited and policy-filtered, not a replay of the question's full execution. |
| Chat history | `ev_6dfe914623d684cc91ff08f9adc6ab19d1a0003bb9e54d81c44f0f42104c9233`: four actions/five steps completed. History displays three conversation rows; their private identities/titles are omitted here. |
| Restore and expand | `ev_3b3bf954d29b785bc8ec68efe43933734f480fa0a12be8e94dc2e7de3f030bfd`: eight actions/nine steps completed. Selecting the owned history row restores the answer with one citation bubble, `data-citation="1"`. Expanding Sources reveals one email-source button. |
| Citation and navigation | `ev_e8ee77f298d981a399c9a89ba3f90d04449932b7ed7dc8b72ca416dc8a724877`: thirteen actions/fourteen steps completed. Clicking bubble 1 expands Sources and adds `highlighted` to the single source row. Clicking that row opens the controlled source at the `/thread/…` path while the AI content remains present. The later close/Inbox restore steps completed. |

The observed source is a `button.AIAgent-answer-sources-row`, containing a
background, numbered citation, origin icon, name and content fields. Its actual
sender, subject, preview, session ID and thread ID remain private. The same row
text hash is retained before/after highlighting. The root's exact-fixture checks
support that one navigation target; they do not prove semantic grounding of
every sentence, complete mailbox search or cross-account isolation.

These successful action scenarios all report incomplete coverage,
`equality_eligible=false` and missing `events`; only page-error event capture was
requested. No page errors are retained. A generated sentence claiming that no
drafts/events/actions were created is model text, not proof that no server-side
write occurred. The declared actions were chat, reading, history, citation and
navigation; no send/event-save action was declared. Full mutation, network and
causal coverage is unavailable. The root restored Inbox and closed the AI pane.
Compact derived structures/counts are retained privately in
`ai-assistant/sanitized-runtime-observations-20261028.json`.

The same owned preview session has a full first-question title in
`ev_16ece883acc864a81d4770131cb7dc194444edb24ca72a1661243fa7cace6db1`
and a shorter subject-like title in
`ev_3c2d863bbe31d4001ff4d349e6b741558a467e38a78e882d0da57e0849b7ce73`.
Retained DOM comparison uses the identical private `data-session-id`: title text
changes from 325 to 20 UTF-8 bytes. That later scenario fails at a stale
full-question-prefix restore selector, after displaying history; it does not
establish the conversation/card is absent. Title condensation between observations
is observed; its timing, model/provider, trigger and generation mechanism remain
unknown. The replica's deterministic first-question title is a local design
choice and does not reproduce this later title behavior. No automatic paid title
request is added. The private bounded comparison is
`ai-assistant/sanitized-history-title-transition.json`.

### Structured draft preview and Create Draft

Original `ev_34b12c8e20517ea7fe55e6b385f3e3a0f6b6b2ea939ed977e9a7cb33682fa6e5`
has six actions/seven completed steps and shows one generated draft card with
To, subject, body, Send and Create Draft. The later controlled
`ev_08a45c59c3c5a553da48eb6e57ec08b4b0fa4d0b112982ce5576164e85b7cdfb`
has fifteen actions/sixteen completed steps: restoring that owned preview and
clicking Create Draft opens a populated standalone composer while Ask AI remains
present. The exact controlled subject/recipient are checked before clearing only
that new test draft's fields and returning to Inbox. Send is not clicked.

After creation, the card has one native-disabled `Current Draft` button; after
closing the composer, it has enabled `Go To Draft`. Those two buttons are not
activated by that probe. Later
`ev_9b56668174589150c95429c7eba609c96c3c7cc7bea9061b0c94e1f852d3cf0a`
has five actions/six completed steps and restores the same owned card with enabled
Go To Draft after reload, using session identity rather than its changed title.
Activation is then observed in
`ev_af82697a6a3a7239f5c9da30330f9104113d47b699974591a0835bebdcbf2216`:
seven actions/eight retained steps complete. It opens the exact same owned draft
URL, with the previously cleared subject empty and root's recipient-chip guard
reporting zero, then shows disabled Current Draft again. This supports retained
identity/header edits rather than rebuilding headers from the preview. Editable
body transfer/retention is not proven by global AX text, which also contains the
preview card. No Send, new Create Draft or field edit occurs in this reopen probe.
Missing events and `equality_eligible=false` remain, with
no screenshots requested in the successful creation run. This establishes the
bounded UI flow, not Gmail persistence, provider deletion, delivery or a general
confirmation policy. Earlier selector/transport failures are retained separately.
The sanitized observation, recovery limits and proposed local artifact/action
contract are in [ai-draft-design.md](ai-draft-design.md); it is not yet implemented.

## Declared answer presentation

All findings in this section are static declarations, not executed behavior.

| Area | Declaration | Original location |
| --- | --- | --- |
| Streaming answer state | Stream events accumulate content/retrievals, keep finished/streaming/replay state, and persist selected completed/retrieval-bearing events into the local session service. Retrieval entries are deduplicated and ordered by numeric index. | `SemanticSearchStreamDataHandler` 750:2241; live handler 750:6167 |
| Markdown conversion | Content passes through citation processing, a Markdown-to-HTML helper, then a response sanitizer. Custom renderers declare headings, lists/nested lists, tables, inline/code blocks, paragraph spacing and horizontal rules. Emoji handling and Unicode normalization are present. | `agentMarkdownToHtml` 388:1848; handler 750:2241 |
| Markdown limits | The preceding citation helper removes triple-backtick delimiters and normalizes curly quotes before numeric citation substitution. Therefore a renderer branch alone does not establish how fenced code or literal citation-like text appears through the complete sidebar path. Exact Markdown, escaping and streaming behavior need probes. | `renderCitation` 393:26; helper export mapping in module 10233 |
| Citation bubbles | Numeric bracket tokens become `.AIAgent-citation.bubble` elements with citation, answer and message indexes. `AIChat` groups related citations, installs click handlers, expands the corresponding sources and highlights numeric indexes, then scrolls them into view. A token is not proof of a correctly grounded source. | `renderCitation` 393:26; `AIChat` 784:5061 |
| Answer rendering | Question/answer HTML is rendered in separate message containers. Thinking content has a distinct optional toggle. Loading, stopped, streaming, scroll-to-bottom and incomplete-indexing states have separate branches. Sanitizer calls and a URI policy are declared; this investigation does not certify sanitizer security. | `AIChat` 784:5061; handler 750:2241 |
| Sources controls | Answers can show Copy, feedback and Sources controls. Source controls are hidden for stopped/unfinished states in the inspected path; expansion/highlights are local UI state. Copy constructs plain-text and HTML clipboard values. Draft/event cards have their own source-control integration. | `AIChat` 784:5061 |
| Source rows | Distinct calendar, email, knowledge-base and web rows are declared. Email rows use sender/subject/body metadata and thread/message identities. Calendar rows carry title, dates/times and calendar/event identities. Knowledge/web rows have their own icons/name/URL fields. | `AIAgentSourcesList` 784:1810 |
| Source navigation | Email sources navigate to a specific message or thread; calendar sources can open a week/event; knowledge-base and web sources take separate paths. Source navigation can discard a focused empty draft before changing context. It is not equivalent to merely expanding citation highlights. | `OpenAskAiSourceAction` 783:86412; `AIChat` 784:5061 |

The runtime probes above corroborate a formatted answer, one citation numbered
1, history restoration, Sources expansion/highlighting and one source navigation.
They do not establish the general index base/order for multiple sources,
clipboard fidelity, arbitrary citation correctness or exact table geometry.
Generated HTML must not be copied into the replica as a trusted rendering shortcut.

## Declared context and retrieval scope

`useSemanticSearch` (779:21455) builds a request with session/question/request
identities, query and chat history, plus user name and optional configured
company/position. It conditionally adds current-thread identity/messages when a
visible actionable conversation is eligible, and excludes knowledge-base matcher
context from that branch. It also stores source-thread metadata for a session.
The thread attachment is conditional; a fresh conversation is not declared to
require a selected thread. `StartAIAgentSessionAction` (786:55123) creates a local
session, and separate replay/history code restores earlier events.

This supports the **inference** that original Ask AI is designed around a
server-side semantic assistant with optional open-thread context, rather than
only a selected-thread prompt. It does not establish which messages the server
retrieves, complete mailbox coverage, indexing freshness, provider permissions,
multi-account boundaries or retrieval quality. The displayed incomplete-indexing
branch is further evidence that completeness is a separate state.

The status-name map at UTF-16 offset 9,080,957 (798:6733) declares these candidate
operations:

| Declared status keys | What is established / unresolved |
| --- | --- |
| `search_emails`, `search_calendar`, `find_availability`, `search_contacts` | Search/availability progress labels exist. Read-only intent is inferred from the names, not proved by a retained tool schema or authorization policy. |
| `web_search`, `knowledge_base_search` | Separate external/knowledge retrieval labels exist. Vendors, indexed contents, citations and actual invocation are unknown. |
| `get_date_info`, `check_dates`, `get_tone_and_voice`, `handoff` | Date/voice/handoff status paths are named; their implementations and scope are not present in these excerpts. |

The inspected client calls an injected backend stream service. Its server-side
tool definitions, query parameters, result limits and capability enforcement are
not recovered. No private endpoint was called to fill those gaps. The captured
bundle also contains other agent frameworks; similarly named tools or UI cannot
be attributed to this sidebar without a connecting execution/data-flow path.

## Actions and confirmation declarations

The sidebar stream handler recognizes structured draft and calendar-event
content and exposes distinct cards. That is richer than read-only retrieval.

- `AIAgentCreateDraft` (783:24508) shows a generated draft body and action controls
  after completion, with reply/thread, stopped and sent-state branches.
  `useAICreateDraft` (783:8854) declares Open, Send, Insert, Replace and Create
  handlers. The Send handler checks for empty recipients, then dispatches a send
  action. This excerpt does **not** establish a universal additional confirmation
  dialog. Downstream send safeguards were not traced or exercised here.
- `useAICreateEvent` (783:3600) declares Edit/Save handlers, writable-calendar
  selection and an invalid-event branch. A past-time condition invokes an
  explicit confirmation action. The save path can create meeting-provider data
  and dispatch calendar creation. That conditional past-time dialog does not
  establish confirmation for every invitation or provider write.
- `ConfirmAIEnabled`/feature/onboarding/upgrade checks referenced by sidebar
  opening near 786:55123 are AI enablement gates. They are not proof of action
  approval or permission to send an email.
- A **separate generic agent UI** declares approval/rejection buttons, pending
  editability, approved/rejected action results and skipping pending calls after
  a later user message. Relevant excerpts are `ToolCallFooter` 985:15976,
  `useToolCallActions` 975:216296 and `useAutoRejectPendingToolCall` 985:12666.
  Reachability from the captured Ask AI sidebar and server enforcement are
  unresolved. Do not transplant its confirmation rules as verified sidebar rules.

The later controlled Create Draft probe above is the observed exception to this
earlier static-only action review. No Send, event Save, Insert, Replace, approval,
feedback, clipboard or integration action was declared in these retained probes.
Further action comparison needs an owned fixture and its exact authorized scope.

## Replica baseline before persistent chat

This comparison read product source before the persistent-chat implementation
phase; it is not original runtime evidence and made no provider call. Later API
implementation and offline checks are documented in [AI-CHAT.md](../api/AI-CHAT.md).
They do not retroactively verify original parity or sidebar runtime comparison.

| Capability | Original declaration | Current replica boundary |
| --- | --- | --- |
| Scope | Backend semantic request, optional open-thread attachment, sessions/history and retrieval-bearing responses | `POST /api/ai` has one prompt plus optional selected thread; no mailbox search or full-mailbox index |
| Context bound | Exact server retrieval/context limits are unknown | Last 10 selected-thread messages, 4,500 body characters each, explicit omitted/truncated indicators; no selected thread means no mailbox context |
| Tools | Search/calendar/contact/web/knowledge status names and generated action cards | No model tools, calendar reads, search execution or mailbox mutations in the adapter |
| Response | Streamed content, retrieval objects, citations and card structures | `{text,mode,model,responseId,contextThreadId}`; nonstreaming provider request, no structured retrieval/citation fields |
| Presentation | Sanitized Markdown-derived HTML, inline citations and expandable source rows | Sidebar answer is rendered as React text; Markdown/source cards and multi-turn session UI are absent |
| Writing | Sidebar draft cards plus a separate inline editor-writing workflow | Selected-text inline writing is independently implemented; its live synthetic proof does not verify sidebar retrieval or citations |

The replica's original-like broad placeholder is not evidence that finding or
scheduling is implemented. Claude configuration/live rewriting likewise does not
prove original model identity, mailbox grounding, retrieval quality or action
parity. A future local retrieval design would need explicit account scope,
bounded read-only tools and structured source identities before displaying
citations. Mutations and their confirmation flow should remain a separate,
reviewable boundary; none is added by this report.

## Candidate selectors and safe original probes

Root owns the browser leases. Selectors below distinguish runtime observations
from static candidates. Resolve fresh DOM/AX uniqueness and the
actual editable node before acting; `.AIAgent-input` is a wrapper, not an
observed textarea. Scope AI submission to `.AISidebar .AI-send-button`: its
`Send message` label must not be confused with a mail composer send control.

| Surface | Candidate selectors / boundary |
| --- | --- |
| Empty sidebar | `.AISidebar`, `.AISidebar-empty-state`, `.AIAgent-input`, `.AI-send-button`, `.AISidebar-knowledge-base-entry-point` — retained DOM structure |
| Answer | `.AIAgent-message-answer-content` and loading/streaming answer classes — runtime; `.AIAgent-message-thinking-content` toggle behavior remains static |
| Citations | `.AIAgent-citation.bubble[data-citation="1"]`, `.AIAgent-citation-group` — runtime for the one fixture; click expands/highlights |
| Sources | `.AIAgent-answer-sources-expand-button`, `button.AIAgent-answer-sources-row`, `.AIAgent-answer-sources-row.highlighted` — runtime; calendar variant remains static |
| History | `#AISidebar-header-history`, `.AISidebar-conversation-history-item[data-session-id]`, child title/date — runtime. The sibling `-discard` control persists deletion and is excluded. |
| Generated draft | `.AIAgentCreateDraft-wrapper`, `.AIAgentCreateDraft-body`, `.AIAgentCreateDraft-toggle-button` — static; action controls are mutation boundaries |

Start with a fresh Ask AI conversation in the mailbox list, with no existing user
draft or real conversation focused. Optional thread context is automatically
declared, so instruction text alone is not a substitute for controlling the
current UI context. Record build, account identity privately, viewport, prompt,
stream/end state, DOM/AX and missing-event coverage. Keep all real source names,
subjects, addresses and calendar details private.

| Candidate | Synthetic prompt / assertion to compare |
| --- | --- |
| ASK-01: formatting only | “Use only these fictional facts: Cedar has 3 samples; Birch has 2. Do not search mail, calendars, contacts or the web. Show a heading, two bullets with bold labels, a two-row table and inline code.” Compare actual DOM elements/spacing, not identical model wording. Keep this free of citation-like numbers at first. |
| ASK-02: formatting edge | In a new context-free conversation, request a tiny fictional fenced-code example and literal bracketed numbers, with no retrieval. Record whether fence removal/literal citation-like text follows the declared preprocessing. Do not interpret an ungrounded number bubble as a real citation. |
| ASK-03: controlled citation | Only when an existing approved synthetic message fixture is indexed: “Find only messages containing the exact synthetic marker `<OWNED_FIXTURE_MARKER>`. State its two fictional facts and cite sources; if none is found, say so. Do not send, draft, schedule or modify anything.” Root supplies the exact marker from its private fixture record. Compare retrieval status, source identity/index and citation highlighting; no new email is created. |
| ASK-04: selected context | Open only that approved synthetic thread, start a fresh chat and ask a factual question about its synthetic content. Compare behavior with ASK-03's mailbox-list context and whether the same controlled source is attached. This does not test arbitrary real-mail submission to the local Claude adapter. |
| ASK-05: calendar read | If an already owned synthetic calendar fixture is available, ask whether its exact marker exists within a short explicit date range. Require an empty answer when absent and prohibit creation, edits, RSVP, invitations or sending. Observe whether calendar-search/availability status and a source row appear; do not create a new fixture or click Save. |

Sources toggling and citation highlighting can be compared separately from
source navigation. Do not click a source row while an existing user draft is
focused: the declared navigation path can discard an empty draft. Copy changes
the clipboard, feedback may persist data, web sources navigate externally, and
draft/calendar card controls can write or send. Those actions are excluded from
the basic read-only probes.

## Remaining evidence needed

Selected Markdown structures, history restoration and a single email citation
interaction are runtime-observed; replica comparison remains open. The controlled
query/answer supports retrieval of that owned fixture from mailbox-list context.
Broader mailbox-wide retrieval remains an inference, while actual coverage,
indexing freshness, ranking, cross-account isolation and tool permissions are
unknown. No generic read-only tool contract, universal action confirmation rule,
original model/provider identity, backend schema or complete feature denominator
has been recovered. Next useful checks include formatting edges, multiple/absent
sources, selected-context differences, calendar retrieval and separately scoped
action cards. The proposed implementation and offline acceptance requirements
are in [ai-chat-contract.md](ai-chat-contract.md) and
[ai-assistant-adversarial.md](ai-assistant-adversarial.md). No feature should be
marked verified from these captures/excerpts alone.

## Later owned draft lifecycle observations

The separate [draft design ledger](ai-draft-design.md) now records subsequent
original runtime evidence, distinct from the earlier static card declarations:

- `ev_0d50ac6d99cc6ec57bc3567130ba309e0dc22c0383218c6af932d181cc4fc15d`
  completes ten steps clearing the exact owned blank draft body with scoped
  keyboard Select All/Backspace and a controlled-word-hidden/settle/close check.
  Earlier direct editable `fill('')` did not establish persisted Squire state;
  its later failed body-hidden assertion cannot prove Go To Draft reinsertion.
- After that emptied draft disappears, the retained final card in
  `ev_1803772a5e0e5844f0e42b0e39fbcf1f6313fd9d40528a81c63a712f6a1f336a`
  shows Send/Create Draft, while the requested Go To Draft locator fails. This
  is an affordance reset observation, not a successful navigation scenario.
- `ev_34af2c2caef7d02065c5a07a9e64ad35a613fb4c1c10f6167d521ac16908d856`
  then completes nineteen steps: the same owned card's explicit Create Draft
  opens a different private draft URL, with exact controlled subject/recipient
  guards. Proper keyboard body/header cleanup, settling and return to Inbox
  complete. No Send action is declared in this scenario.

A focused retained `useAICreateDraft` declaration separates loading/selecting an
existing mapped draft from its initial content-creating and explicit replacement
paths. The existing-draft open branch does not explicitly replace its body with
the preview; a From-account adjustment can occur. This supports a bounded static
existing-draft navigation interpretation, not proof of all downstream side effects
or body retention. No vendor implementation is published or executed here.

The successful captures still lack event-family coverage and remain
`equality_eligible=false`. They establish UI identity/header states and deliberate
re-creation, without proving Gmail persistence/deletion, concurrent idempotence,
original storage generations or card Send behavior. The reconstruction's explicit
generation/receipt policy is a local design choice; it is not attributed to the
original server.
