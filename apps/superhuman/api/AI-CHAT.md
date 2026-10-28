# Persistent Ask AI API

This is a local reconstruction design. Original formatting/history/citation
observations do not establish the original private server contract or full
parity. See [the shared contract](../research/ai-chat-contract.md),
[original evidence](../research/ai-assistant.md) and
[adversarial requirements](../research/ai-assistant-adversarial.md).

API source froze at 2026-10-28T07:46:50.189Z with all 261 API tests and strict
TypeScript checks passing. These include existing Gmail/Calendar regressions and
new isolated chat/storage/retrieval/stream cases. A later isolated synthetic
three-turn live API check passed formatting, local mail search/read/citation and
same-session history; see [the bounded record](../research/ai-chat-live-check.md).
It does not establish browser/original parity, live Stop or real-mail coverage.
The separate existing inline-writing endpoint has its own checks.

## Readiness and scope

`GET /api/ai/chat/status?accountId=ACCOUNT` returns `{status}` with configuration,
capabilities, policy version, local index counts/coverage and limitations. Claude
requires explicit `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`; the current adapter
uses version `2026-10-21`. There is no automatic model selection, paid retry or
fallback to the optional inline OpenAI adapter. No keys are returned by the API.

Every route requires the account plus the exact session/turn relationship.
Missing and foreign resources share `404 ai_chat_not_found`. This is still a
single-user, loopback development service, not a hosted multi-user auth system.
History, excerpts and answers persist in the ignored private SQLite database;
they are not encrypted separately from existing local mail. Do not publish it.

## Routes

All responses use `Cache-Control: no-store`; failures use the existing
`{error:{code,message}}` envelope. Browser-safe exports are in
[`src/ai-chat-types.ts`](src/ai-chat-types.ts).

| Request | Response |
| --- | --- |
| `POST /api/ai/chat/sessions {accountId}` | `201 {session}`; no model request |
| `GET /api/ai/chat/sessions?accountId&limit=20&cursor` | `{sessions,nextCursor,hasMore}`; maximum 50 session metadata rows |
| `GET /api/ai/chat/sessions/:id?accountId&beforeSeq&limit=20` | `{session,turns,nextBeforeSeq,hasMore}`; latest bounded page, ascending turn order within page, maximum 50 |
| `POST /api/ai/chat/sessions/:id/turns` | `202 {session,turn}`; durable acceptance, not completed answer |
| `GET /api/ai/chat/sessions/:id/turns/by-request/:clientRequestId?accountId` | `{session,turn}`; read-only uncertain-ACK recovery |
| `GET /api/ai/chat/turns/:id?accountId&sessionId` | `{session,turn}`; snapshot, no dispatch |
| `GET /api/ai/chat/turns/:id/events?accountId&sessionId&afterSeq=0&limit=100` | `{events,nextSeq,hasMore,turnRevision,terminal}`; maximum 200 events, exact ordered scope |
| `POST /api/ai/chat/turns/:id/cancel {accountId,sessionId}` | `{session,turn}`; best-effort local Stop |
| `GET /api/ai/chat/sources/:id?accountId&sessionId&turnId` | `{source,resolution:{availability,target}}`; current local resolution, never arbitrary model URLs |

Submit only these fields:

```json
{
  "accountId": "ACCOUNT",
  "clientRequestId": "a-new-client-uuid",
  "expectedRevision": 0,
  "prompt": "Use only fictional facts: Cedar has three samples.",
  "context": { "resources": [] }
}
```

Optional `context.selectedThreadId` must belong to that account. Resources are
unique values from `mail` and `calendar`; an empty array enables no new search
tool, but an explicit selected thread and earlier session history are still
context. Use a fresh empty session with no thread for a context-free synthetic
check. The optional `retryOfTurnId` is an explicit new request linked to a finished
unsuccessful turn in that session. Unknown fields/client-authored history are
rejected. Prompt limit is 10,000 UTF-8 bytes; JSON revision must be a number.

Persist the exact submit request and key before POST. Same key plus same request
returns the same turn before busy/revision checks; changing its prompt/context
conflicts. After an uncertain HTTP result, read the same key. A temporary 404
does not prove the original POST cannot still arrive. Do not silently create a
new key, resubmit, or replay a paid request on reload/network recovery.

## Execution, streaming and recovery

One active turn per session/account and at most two active local turns are
accepted. A dispatch row, request hash and actually offered source IDs commit
before each Claude call. Final answer/state commit atomically. Terminal turns
are fenced from late callbacks. On recovery, unfinished dead-owner/expired turns
become `interrupted` if undispatched or `outcome_unknown` after dispatch; no
automatic request resumes. Stored provider IDs are actual returned IDs, not proof
that a request lacking an ID was never dispatched.

Polling replays persisted genuine text/thinking-state/tool/source events; there
is no completed-text animation pretending to stream. Token batches target at
most one write per 100 ms or 2 KiB, with state/tool/terminal flushes. The initial
transport is polling, not a separate SSE subscription endpoint. Thinking is
requested with provider display omitted: the UI may show actual thinking-block
state, but no hidden reasoning or invented summary is exposed.

Stop records cancellation and aborts local IO best effort. After dispatch it
cannot prove external computation/billing stopped. `cancelled`, `failed`,
`interrupted` and `outcome_unknown` have no completed `answer`; retained text is
explicitly partial. Missing credentials return `503 ai_chat_not_configured` and
no canned answer. Deadline, stream, budget and provider failures are durable
sanitized errors, with no automatic paid retry/fallback.

## Local retrieval and limits

The model receives three strict read-only retrieval tools when enabled: `mail_search`,
`mail_read`, `calendar_cache_search`. Their account is fixed by the runner, never
chosen by model arguments. No mailbox send/create-draft/archive/label/Calendar write, sync, OAuth,
browser, shell, network, contact, web or knowledge-base tool is available.

Mail search uses account-scoped FTS5/plain-text projection, separate from the
mailbox UI's search grammar. It literal-token-matches indexed subject,
participants, body text and attachment names; search returns summaries first,
not full thread records. Only source IDs actually served to that turn can request
bounded body reads. Trash, spam and draft-only conversations are excluded; mixed
received/draft threads remain eligible. Messages and search results are untrusted
evidence, not instructions.

Pure SQLite triggers immediately invalidate changed/deleted projections and
queue their IDs. A background local worker projects at most 25 threads per slice;
old writer connections need no UDF/custom functions. Initial backfill/migration
does not rewrite original mail JSON. Pending counts, truncated indexed text,
partial remote import and sync errors remain explicit coverage reasons. Complete
local projection does not mean complete Gmail history. Search does not trigger
provider synchronization or parse every message body per request.

Per-record projection failures retain bounded error codes/counts, not body/error
text. They stay pending/partial but do not starve other rows or retry every tick;
changing/deleting that record clears its derived error for a later bounded slice.
A version rebuild transaction clears obsolete projections/errors/orphaned queue
entries and backfills from unchanged original JSON. Version 4 also invalidates
the old document in the insert trigger: legacy `INSERT OR REPLACE` writers remain
safe when SQLite recursive delete triggers are disabled.

The versioned index retains at most 50 latest messages/thread, 16,000 text bytes
per indexed message and 128,000 body bytes/thread, with truncation flags. Actual
answer body context is tighter: eight full-thread reads/turn, latest ten messages
per thread and 4,500 UTF-8 text bytes/message, with bounded sender/date/attachment
metadata. Header/attachment omissions are also marked; identities are never
silently truncated into a different navigation target.
Known provider-DRAFT message text is excluded even in mixed conversations, with
an explicit omitted-draft count. A last-draft-derived preview is replaced by a
bounded received-message preview; no draft record is edited or submitted.

Calendar retrieval reads only authorized cached data with current local roles
and granted scopes. Explicit ranges are at most 31 elapsed days. Missing,
expired or partial expanded ranges and canonical-only recurrence coverage remain
partial/unavailable. Calendar all-day intervals use the calendar's IANA midnight;
timed intervals use their explicit instants. Nothing here checks live free/busy;
a cache miss is never presented as available time or remote absence.

Shared hard ceilings are four provider rounds, eight tools, 50 summary hits,
64 receipts, 96 KiB context (per dispatch plus newly produced context across the
turn), 4,096 output tokens across rounds, 32 KiB answer text, 1,024/1 MiB durable
events and one 60-second whole-turn deadline. The allowances cannot all be used
simultaneously. UTF-8 clipping preserves complete code points.

## Sources and citations

Receipts store bounded server labels/excerpts, exact account/local targets,
snapshot/version hashes, time and coverage. Only IDs included in a durable
provider-dispatch receipt map can become final citations; a model cannot invent
a label/URL/ID or guess an unserved retrieved row into an authoritative source.
Same-date content corrections report changed, deleted/draft-only mail loses its
target, and inaccessible Calendar sources report unavailable. Historical
receipts remain intact; no similarly named source is substituted.

Reserved model syntax `[cite:1]` becomes the displayed numbered bubble only
through the current served receipt map and Markdown prose-token validation.
Plain `[1]`, escaped markers, links, raw-HTML literals, code and unknown numbers
stay noninteractive. This internal syntax is a local design choice. Copy uses
rendered text/allowlisted HTML, not the reserved raw protocol. Citation membership
proves identity, not semantic truth of the model's sentence.

## Offline evidence and limits

Tests use explicit `:memory:`/temporary database paths; application fixtures set
the same `databasePath` and `env.DATABASE_PATH`. No ordinary test opens the live
database or calls a provider. Root stops running processes before controlled
live migrations/restarts.

The bounded synthetic 10,000-thread benchmark used 9,000 selected-account rows,
1,000 other-account rows and approximately 1.3 KiB bodies. Local indexed search
averaged 4.12 ms over five warm calls versus 137.53 ms for legacy scoped body
search; both found ten matches. Indexed receipts were 7,271 bytes versus 18,965
bytes for full matched threads, with zero full-body JSON parses per indexed
query. Initial projection took 896 ms. This single-machine in-memory benchmark
ran alongside the offline API suite, so its timings include shared-host load;
it does not measure network/model latency or original-app performance. Private
counts/timings/query plan and source hashes are in
`.local/benchmarks/ai-retrieval-20261028.json`.

The passing final output is `.local/audits/ai-api-suite-20261028-v2.log`; source
identities are `.local/audits/ai-api-source-freeze-20261028-v2.json`. The prior
260-test checkpoint remains retained and is superseded by the independently
reproduced/fixed legacy-REPLACE invalidation case. The first sandboxed full run
had 240 passes and 13 loopback `listen EPERM` failures; the final approved host-only
loopback run passed 261/261. Neither run constructed the live Store or called a
live model/mail/calendar provider.

| Frozen component | SHA-256 |
| --- | --- |
| Service | `9950c1e7135892c5a520a6102664f95add9228e810a363eb49f3fb51b782ae69` |
| Local retrieval/index | `9801ac022491548b166e806f2c6054a73ee5e38f879a7ae90cd88bd363a295f5` |
| Stream parser | `790217edac043ac7c25ab9def4400a77c6fb7d7cba063182202d09ad1fed98c0` |
| Shared Markdown policy | `2d7e4818704c6ef80ec6bdfda858c546a9b037abe239980771cb908671d48502` |

## Structured previews and explicit local Create Draft

The additive browser-safe contract is
[`src/ai-draft-types.ts`](src/ai-draft-types.ts). Status policy
`local-chat-preview-v2` advertises `draft-preview` and `create-local-draft`.
`propose_email_draft` is a planning-only tool available independently of retrieval
resources; it cannot create a Draft, choose an account/From/existing draft, send,
schedule, synchronize a provider or invoke another mutation. The three retrieval
tools retain their existing scope and shared limits. Model text does not create
buttons or authorize an action.

Only successful `end_turn` completion atomically commits one validated preview
with its answer, turn and `preview`/terminal events. Failed, cancelled, interrupted,
unknown or event-budget-exhausted turns have no actionable preview. Before explicit
activation the application Draft records remain unchanged. The final turn/history
has optional `previews`; genuine partial text may precede the completed card.

Inputs are strict To/Cc/Bcc arrays of `{email,name?}`, subject, plain body, optional
HTML and `sourceNumbers`. There are at most 50 recipients, 200 UTF-8 bytes/name,
2,048 bytes/subject, 12 KiB/body or HTML and 16 KiB for the entire tool input,
within the existing whole-turn budget. Every mailbox uses the strict outgoing
parser/serializer, preserving quoted commas/escaped display names and authored
address casing. Empty recipient arrays allow an editable unsent draft. Header
controls, unsupported fields, malformed addresses and oversized data are rejected.
HTML passes the existing parser-backed allowlist; its visible plain alternative
is authoritative over conflicting model-supplied plain text. No attachments,
remote images or automatic signature are appended. Only actually offered
same-turn receipt numbers can become preview `sourceIds`.

All routes use the ordinary nested error envelope and no-store policy:

| Request | Result |
| --- | --- |
| `GET /api/ai/chat/artifacts/:previewId?accountId&sessionId&turnId` | `{preview,creation,request:null,resolution,createGeneration,draft?}` for the latest generation; no creation or model call |
| `POST /api/ai/chat/artifacts/:previewId/create-draft` | Strict `{accountId,sessionId,turnId,clientRequestId,expectedPreviewHash,expectedGeneration}`; 201 for a new local generation, 200 for recovery of an existing one |
| `GET /api/ai/chat/draft-actions/by-request/:clientRequestId?accountId&sessionId&turnId&previewId` | Same response with the exact historical request/creation; read-only lost-ACK recovery |

`creation.generation` starts at zero. A never-created preview offers
`createGeneration:0`. An existing editable target returns `available` and the
**current** owned `draft`, including subsequent user edits. A locked/sent/scheduled/
sending/unresolved delivery target returns `locked`, no draft body and no creation
offer. Queued local delivery locks are checked as well as persisted status. A
moved-to-another-account target is unavailable and cannot be recreated. Scope
checks precede any draft-body parse.

Only canonical absence of the latest target offers its next `createGeneration`.
A fresh explicit action with that `expectedGeneration` can create a replacement;
GET/history restoration and old keys never do. The original has bounded runtime
evidence of this affordance after an owned empty draft disappears, but the local
generation schema is a reconstruction design. It does not claim Gmail deletion
or recover the vendor's storage mechanism.

The action transaction inserts a new server-ID Draft, creation mapping and action
receipt atomically. Each generation is unique per preview; concurrent different
keys converge on that generation. Client keys are unique within an account and
fingerprint account/session/turn/preview/hash/generation. Reusing one for another
intent conflicts. Known-key lookup precedes generation checks and always resolves
its **original** creation, even after a later generation exists. A stale new key
returns `409 ai_draft_generation_changed`. Replays never reapply preview content
over edits or revive the original deleted draft. Prototype single-mapping data
upgrades transactionally to generation zero without changing original mail JSON;
an upgrade failure rolls back schema and action changes.

Persist the full action/key before POST. After ambiguous acknowledgement, recover
by that key; a 404 is not proof the original POST can never arrive. Do not silently
create a new key or generation. Navigation may use an available current draft only
under the frontend's autosave/identity guard. A stale historical response must not
replace a newer generation's UI state. The action performs no Claude request,
provider draft sync, delivery or Calendar write. Create Draft does not enable card
Send; its confirmation/effect remains outside this phase.

Validation errors are `400 ai_draft_invalid_preview`; foreign/missing resources
share `404 ai_draft_not_found`. Conflicts include `ai_draft_preview_changed`,
`ai_draft_request_conflict`, `ai_draft_generation_changed` and
`ai_draft_turn_incomplete`. No new provider credentials or scopes are required.
See [the observed behavior and design ledger](../research/ai-draft-design.md) for
original evidence IDs, cleanup failures and remaining limits.

The later structured-preview offline checkpoint passes 280/280 API tests and
strict TypeScript checks, including six integrated preview/action/migration
cases and thirteen independently owned draft adversarial cases. The independent
review found no remaining actionable issue within its bounded account, generation,
receipt and atomicity scope. The log is
`.local/audits/ai-draft-api-suite-20261028.log`; frozen file identities are in
`.local/audits/ai-draft-api-source-freeze-20261028.json`. No live database,
Claude/mail/Calendar request or restart was performed by these tests. This
checkpoint does not verify browser/original draft-card parity or card Send.

The subsequent explicit artifact Send implementation is documented separately in
[AI-SEND.md](AI-SEND.md). Its queued/attempt ledger does not add any model mutation
tool, and original Undo timing plus live replica Send remain held pending review.

The later artifact-only Undo scope and its provisional timing are in
[AI-UNDO.md](AI-UNDO.md). Cancellation remains an explicit human action; the model
receives no mutation capability.
