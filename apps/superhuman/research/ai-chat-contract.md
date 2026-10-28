# Persistent Ask AI contract

Recorded 2026-10-28. Approved implementation contract, not a recovered Superhuman
server API. The contact checkpoint released source after this plan was approved;
implementation and its acceptance evidence must be recorded separately.
Original observations and their limitations are in [ai-assistant.md](ai-assistant.md);
the independent adversarial acceptance cases are in
[ai-assistant-adversarial.md](ai-assistant-adversarial.md).

This phase adds persistent, account-scoped conversation history, genuine Claude
response streaming, bounded retrieval from locally imported mail and cached
Calendar data, and source receipts that the server can resolve. It does not add
mail/calendar mutations, live provider retrieval, contacts/web/knowledge-base
search, action cards or voice/handoff. Existing inline writing continues through
`POST /api/ai`; it is not overloaded with the conversation protocol.

## Routes and identity

All routes use the existing loopback-only API/session/origin protections and
`Cache-Control: no-store`. An account ID is explicit on every request. Stored
session, turn, source and selected-thread relationships must match it before any
history, body, cache or model access. Missing and foreign identities produce the
same bounded `404 ai_chat_not_found`; active-account preferences never substitute
for these checks. Client-supplied history, roles, tool calls, source maps and
unknown fields are rejected.

Prefix: `/api/ai/chat`.

| Method/path | Request | Response |
| --- | --- | --- |
| `GET /status?accountId` | Existing account | `{status: AiChatStatus}`; readiness, actual model, policy and local coverage; no context/model call |
| `POST /sessions` | `{accountId}` | `201 {session}`; empty conversation, no model call |
| `GET /sessions?accountId&limit&cursor` | Default 20, maximum 50 | `{sessions,nextCursor,hasMore}`; bounded metadata, no turn bodies |
| `GET /sessions/:sessionId?accountId&beforeSeq&limit` | Default 20, maximum 50 turns | `{session,turns,nextBeforeSeq,hasMore}`; turns ordered ascending within the returned page, latest page by default |
| `POST /sessions/:sessionId/turns` | `AiChatSubmit` | `202 {session,turn}`; durable acceptance, not answer completion. Same-key replay returns that turn, without another dispatch. |
| `GET /sessions/:sessionId/turns/by-request/:clientRequestId?accountId` | Exact scoped client key | `{session,turn}`; read-only recovery after an uncertain submit acknowledgement; a 404 does not prove that an earlier request cannot still arrive. |
| `GET /turns/:turnId?accountId&sessionId` | Exact scope | `{session,turn}`; durable snapshot, never starts/resumes generation |
| `GET /turns/:turnId/events?accountId&sessionId&afterSeq&limit` | Default `afterSeq=0`, limit 100, maximum 200 | `{events,nextSeq,hasMore,turnRevision,terminal}`; ordered durable replay, no model call |
| `POST /turns/:turnId/cancel` | `{accountId,sessionId}` | `{session,turn}`; idempotent best-effort cancellation, no retry |
| `GET /sources/:sourceId?accountId&sessionId&turnId` | Exact scope | `{source,resolution}`; historical receipt plus current local availability, no provider call |

Version-one transport can poll the event route approximately every 250–500 ms
while visible and in flight. It must reflect actual persisted provider deltas;
completed text is never animated to impersonate streaming. A later read-only SSE
transport may replay the same events with `id: seq` and an explicit cursor. It
must retain all four identity checks and must not start or repeat a paid request
when connected/reconnected. Polling support is the initial mandatory contract.

Opaque cursors bind account, query/version and stable `(updatedAt,id)` ordering.
Malformed, oversized or mismatched cursors return `400 ai_chat_invalid_cursor`.
Pagination after new arrivals is stable by key, not an offset guarantee of a
single global snapshot. Session titles are bounded deterministic first-question
text, not a second title-generation call.
Original retained DOM now shows the same session's title condensing later; see
[ai-assistant.md](ai-assistant.md). The current deterministic title is therefore
an explicit remaining history-title parity gap. Its original generation
provenance is unknown; no paid automatic title work is added by this contract.

## Shared TypeScript shapes

The implementation exports browser-safe types from
`api/src/ai-chat-types.ts`, with no Node imports or secrets. Times below are UTC
ISO strings, numeric revisions/sequences are nonnegative safe integers, and IDs
are opaque server IDs (UUIDs initially). `clientRequestId` is an opaque client
UUID. All human text limits below are UTF-8 byte limits, not JavaScript code-unit
counts; browser and server validation must agree.

```ts
type AiResource = 'mail' | 'calendar';
type AiTurnState = 'queued' | 'running' | 'cancel_requested'
  | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'outcome_unknown';
type AiPhase = 'queued' | 'connecting' | 'thinking' | 'retrieving'
  | 'responding' | 'stopping' | 'finished';

type AiChatSubmit = {
  accountId: string;
  clientRequestId: string;
  expectedRevision: number; // Session history/order revision, not stream revision.
  prompt: string;
  context: {
    selectedThreadId?: string;
    resources: AiResource[]; // Unique values. [] permits no new search tools.
  };
  retryOfTurnId?: string; // Explicit new generation, same account/session only.
};

type AiChatSession = {
  id: string; accountId: string; title: string;
  createdAt: string; updatedAt: string; revision: number;
  turnCount: number; activeTurnId: string | null;
};

type AiChatTurn = {
  id: string; sessionId: string; accountId: string; seq: number;
  clientRequestId: string; retryOfTurnId?: string;
  prompt: string; context: AiChatSubmit['context'];
  state: AiTurnState; phase: AiPhase; revision: number; lastEventSeq: number;
  createdAt: string; startedAt?: string; finishedAt?: string; deadlineAt?: string;
  provider: 'anthropic'; model: string;
  providerRequestIds: string[]; // Actual returned IDs only; absent ≠ undispatched.
  dispatchCount: number; // Persisted before each upstream request.
  partial: { markdown: string; thinkingSummary: string | null };
  answer: AiChatAnswer | null; // Only completed turns have an answer.
  sources: AiSourceReceipt[];
  usage: { inputTokens: number | null; outputTokens: number | null };
  limits: AiTurnLimits; coverage: AiCoverage[];
  error: AiChatError | null;
  cancellation: {
    requestedAt: string | null;
    localStoppedAt: string | null;
    providerOutcome: 'not_dispatched' | 'response_observed' | 'unknown';
  };
};

type AiSourceTarget =
  | { kind: 'mail'; accountId: string; threadId: string; messageIds: string[] }
  | { kind: 'calendar'; accountId: string; calendarId: string; eventId: string };

type AiSourceReceipt = {
  id: string; accountId: string; sessionId: string; turnId: string;
  number: number; // Positive server-assigned display number, local to this turn.
  target: AiSourceTarget;
  basis: 'selected-thread' | 'mail-summary' | 'mail-text' | 'calendar-cache';
  label: string; secondaryLabel: string; excerpt: string;
  snapshotHash: string; fetchedAt: string; sourceVersion?: string;
  sourceUpdatedAt: string | null;
  truncated: boolean; partial: boolean;
};

type AiSourceResolution = {
  availability: 'available' | 'changed' | 'unavailable';
  target: AiSourceTarget | null; // Never a model-selected/arbitrary URL.
};
type AiChatAnswer = {
  markdown: string; plainText: string;
  citations: { number: number; sourceId: string }[];
  sourceIds: string[];
  finishReason: 'end_turn';
  truncated: boolean; // True if retrieval/history coverage was bounded/partial.
};

type AiCoverage = {
  resource: AiResource;
  scope: 'local-imported' | 'local-cache';
  status: 'complete-local-snapshot' | 'partial' | 'unavailable';
  lastUpdatedAt: string | null;
  indexedRecords?: number; pendingRecords?: number; errorRecords?: number;
  range?: { timeMin: string; timeMax: string; timeZone: string };
  reasons: string[]; // Typed allowlist in implementation, no raw provider error.
};

type AiTurnLimits = {
  providerRounds: number; toolCalls: number; summaryHits: number;
  fullThreadReads: number; contextBytes: number; outputTokens: number;
  exhausted: string[];
};
type AiChatStatus = {
  implemented: boolean; configured: boolean; provider: 'anthropic';
  model: string | null; missing: string[];
  capabilities: ('persistent-chat' | 'streaming' | 'local-mail-retrieval'
    | 'cached-calendar-retrieval' | 'source-citations' | 'cancel')[];
  policyVersion: string; coverage: AiCoverage[]; limitations: string[];
};
```

`resources: []` disables new mail/calendar tools; an explicit selected thread is
still permitted context. A continuing conversation can already contain prior
mail-derived answers/receipts. A truly context-free synthetic prompt requires a
fresh session, no selected thread and empty resources. Resources are permissions
for the turn, not a claim that a tool ran. A newly selected visible thread never
retargets an already accepted turn. Questions remain questions; selecting a
thread does not silently change a question into summarize mode.

### Events and errors

Events are persisted before publication. `seq` is strictly increasing within
one account/session/turn; it is not a global stream or a provider event number.
Snapshot revisions and event sequences make late/repeated polling idempotent.

```ts
type AiProgressPayload =
  | { kind: 'state'; state: AiTurnState; phase: AiPhase }
  | { kind: 'text_delta'; text: string }
  | { kind: 'thinking'; state: 'started' | 'finished' }
  | { kind: 'thinking_summary_delta'; text: string }
  | { kind: 'tool'; callId: string;
      tool: 'mail_search' | 'mail_read' | 'calendar_cache_search';
      state: 'started' | 'completed' | 'failed'; resultCount?: number;
      errorCode?: string }
  | { kind: 'source'; source: AiSourceReceipt }
  | { kind: 'limit'; name: string }
  | { kind: 'terminal'; state: AiTurnState; revision: number };
type AiChatEvent = {
  accountId: string; sessionId: string; turnId: string;
  seq: number; revision: number; createdAt: string;
  payload: AiProgressPayload;
};
type AiChatError = {
  code: string; message: string;
  retry: 'none' | 'explicit-new-turn';
  providerOutcome: 'not_dispatched' | 'response_observed' | 'unknown';
};
// Immediate HTTP failure before turn acceptance uses the existing API envelope:
type AiChatHttpError = { error: { message: string; code: string } };
```

Thinking state comes from a real provider thinking block; summary text is only
the provider's explicitly displayable summary when that mode is supported and
configured. Raw hidden reasoning/signatures are not a browser transcript.
Without a displayable summary, show a progress label only. Tool progress comes
from actual server execution and exposes tool name/count/state, not prompts,
addresses or arbitrary argument JSON. Provider errors are sanitized; no keys,
workspace IDs, raw diagnostics, prompts or message bodies are logged by default.

| HTTP/code | Meaning |
| --- | --- |
| `400 ai_chat_invalid_request` | Unknown fields, invalid types/IDs, empty/oversized prompt, duplicate resources or malformed bounds |
| `400 ai_chat_invalid_cursor` | Invalid or mismatched paging/replay cursor |
| `404 ai_chat_not_found` | Unknown or out-of-scope account/session/turn/source/context identity |
| `409 ai_chat_revision_conflict` | Session revision changed; refetch before intentional submission |
| `409 ai_chat_turn_in_progress` | Another nonterminal turn holds the session slot |
| `409 ai_chat_request_conflict` | Client key reused with a different immutable request |
| `503 ai_chat_not_configured` | Missing/unsupported Claude configuration; no provider call |
| `503 ai_chat_capacity` | Bounded local concurrency is full; no turn/provider dispatch accepted |

After acceptance, provider refusal, malformed/incomplete stream, authentication,
rate limit, deadline, budget exhaustion and cancellation are durable turn states
with sanitized `error.code`. They are not successful assistant answers. A known
HTTP rejection can be `failed/response_observed`; a dispatched request whose
response cannot be established is `outcome_unknown`. No error advertises an
automatic retry. Existing failed text is retained as explicitly partial output,
with no completed-answer/source-grounding claim.

## Durable execution and Stop

1. Validate the account/session, context ownership, strict payload and byte
   bounds. Check the scoped idempotency key before revision/busy checks so a
   retry of the same accepted HTTP request can recover its turn.
2. In a short transaction, persist the immutable request/fingerprint, user turn,
   session revision and active slot. Fingerprint the canonical literal prompt,
   context, expected revision and optional retry relationship; do not trim or
   normalize an accepted prompt into a different key binding.
3. Before each upstream call, persist a dispatch attempt with its round number
   and timestamp. Then issue one Claude request using the remaining whole-turn
   budget. Persist actual upstream request/message IDs when received; preserve
   absence honestly. No automatic HTTP retry, provider fallback or live tool call.
4. Parse provider SSE incrementally; execute only complete validated tool inputs
   after the corresponding block closes. Persist real output/progress in bounded
   batches (target no more often than 100 ms or 2 KiB of new text), flushing at
   tool/state/terminal boundaries. No DB transaction or mail account queue stays
   held across provider IO. The durable snapshot is the replay authority.
5. Only a valid final `end_turn` stream completion can commit `answer`, validated
   citations and completed state atomically. A tool-use stop continues with
   matching tool results within the remaining rounds/deadline; other stop
   reasons remain noncompleted. Completion may have partial retrieval coverage,
   which is explicit in both coverage and answer flags.

`queued` transitions to `running` only in the owning process. On process restart,
an undispatched queued turn becomes `interrupted/not_dispatched`; an unfinished
dispatched turn becomes `outcome_unknown/unknown`. Neither is automatically
resumed. A completed commit survives a lost HTTP response. The unique key and
session slot must also prevent two API processes from dispatching the same turn;
SQLite ownership/claim tests are required, not just an in-memory mutex.

Stop persists `cancel_requested`, aborts the local request/tool loop and releases
the slot only after local work is fenced from committing a late result. It then
becomes `cancelled`, retaining partial text plus the true provider-outcome flag.
Cancellation before dispatch proves no request was sent; cancellation after
dispatch does not prove the provider stopped computing or billing. Closing the
pane, aborting polling or switching account is not a new generation/retry.
Terminal states never become completed from late callbacks. An explicit Retry
uses a new key plus `retryOfTurnId`; reusing the old key only reads the old turn.

No cross-account chat context is sent to Claude. Within a session, the server
constructs bounded history from its own accepted/completed turns; failed,
cancelled or unknown partial answers do not become assistant facts. Only the
last 12 completed turns are candidates, then oldest context is omitted to fit
the shared byte budget with an explicit omission count. Prior source receipts
must be revalidated/reoffered under the current turn before receiving a current
citation number. Deletion/unavailability must not be concealed by history replay.

## Retrieval and shared budgets

These are local starting policies, not observed Superhuman limits. Stop when
any shared budget is exhausted; the allowances cannot all necessarily be spent
simultaneously. One monotonic 60-second deadline covers queue start, context,
all model rounds and tools; it is never reset per request. Admission/accepted
queue wait should be short, and a persisted UTC deadline supports honest restart
status rather than resumption.

| Resource | Hard initial ceiling |
| --- | --- |
| Prompt | 10,000 UTF-8 bytes, nonempty after whitespace check |
| History | Last 12 completed turns, with omissions reported |
| Whole provider context | 96 KiB serialized UTF-8 per dispatch, including system instructions, history, prompt, tool schemas/results and selected data; cumulative tool/context production also bounded to 96 KiB per turn |
| Provider rounds/tool calls | Four upstream requests; eight local tool executions total |
| Search | 50 summary hits across the turn; maximum ten returned per tool call |
| Full mail reads | Eight thread reads total; latest ten messages per thread; maximum 4,500 UTF-8 bytes per message text; omitted messages/bytes explicit |
| Source labels/excerpts | Label 1,000 bytes; secondary label 500; excerpt 4,500; maximum 64 receipts |
| Calendar | Explicit offset-bearing range up to 31 elapsed days, IANA display zone; maximum five authorized calendars/50 events per call, constrained by the same shared context budget |
| Model output | 4,096 output tokens shared across rounds, using remaining allowance on each call; 32 KiB persisted answer text and 16 KiB displayable thinking summary; incomplete over-limit output is not completed |
| Durable progress | Maximum 1,024 events and 1 MiB serialized event data per turn; overflow ends locally with a limit status, never an unbounded log |
| Active work | One turn/session, one running turn/account, maximum two local model turns overall; capacity rejection before provider dispatch |

UTF-8 truncation never splits a code point. HTML-only mail is sanitized and
converted to visible plain text before bounded context projection; attachments,
raw HTML/remote images and OAuth/credential fields never become tool payloads.
All model/retrieved text is untrusted data. It cannot redefine tool schemas,
account ownership, system policy, budgets or source maps.

| Tool | Strict input and implementation boundary |
| --- | --- |
| `mail_search` | `{query,limit?}`; query at most 512 UTF-8 bytes, limit 1–10. Account is supplied by runner, never model input. Indexed local text/metadata search returns bounded summaries and receipts; it does not materialize every thread JSON/body. |
| `mail_read` | `{sourceIds}` with 1–4 unique source IDs already offered by this turn, plus optional explicitly selected-thread registration. Exact account/thread membership is checked before bounded body loads. Reading a different snapshot yields a distinct immutable receipt. |
| `calendar_cache_search` | `{query?,timeMin,timeMax,timeZone,calendarIds?}` with strict date/range validation and calendar-role checks. Searches only the selected account's current local caches; no sync/OAuth/freebusy/provider request. |

Tool schemas disallow additional properties. An unsupported name, foreign ID or
over-budget argument is a bounded tool error, never a reason to broaden scope.
Parallel tool requests still consume the same counters and deadline; reserve
budget before starting, and return a result/error for every accepted tool-use
ID. Exposed repository interfaces have no send, draft-write, action, arbitrary
SQLite/HTTP, shell, browser or connector methods.

### Mail indexing and Calendar coverage

Implement an account-scoped persistent FTS5/plain-text projection and membership
lookup, maintained by pure SQL invalidation plus bounded projection work. Keep
existing summary endpoints/body performance intact. Search cannot call the
legacy full-thread `q` fallback. Initial index construction is a versioned,
transactional/restartable local migration/backfill with observable counts and
coverage; original mail JSON remains unchanged, no connection-local UDF triggers.
Tests use explicit `:memory:`/temporary paths in both application options and
environment. Parent stops existing API processes before the first live migration.

“Complete local snapshot” means a complete projection of currently imported local
records, not complete Gmail history. Import/backfill/index errors and freshness
are separate coverage reasons. No result means no match in the searched imported
scope. Retrieval must not claim that a missing message does not exist remotely.

Calendar canonical records and single-event visible-range caches have different
coverage. Only complete, nonexpired matching-range caches can claim range
coverage; partial pages, missing/expired ranges, revoked roles and canonical-only
recurrence data remain partial/unavailable. A cache miss is not free time, an
absent calendar event or verified availability. Phase one can report indexed
events with these limits; it does not expand recurrence incorrectly or trigger
live Calendar reads to hide missing coverage.

## Authoritative citations and rendering

The server creates and persists source receipts only for authorized data
actually offered to that turn's model. The model cannot mint a source by writing
an ID, label, URL or plausible subject. Each receipt snapshots bounded
server-derived label/excerpt, locator, hash and coverage. Identical locator and
snapshot dedupe; different snapshots remain distinct. Source numbers are assigned
deterministically on first offering and only within this turn. Numeric membership
proves receipt identity, not that the model's sentence follows from the evidence.

Reserved **internal** model markup is `[cite:1]`, displayed as a numbered bubble
only after resolving number 1 in the current offered receipt map. This is a local
protocol choice, not the original client's recovered syntax. Plain `[1]`, unknown
numbers, escaped markers, code/fences, link labels/URLs, raw HTML and literal text
must never create navigation. A Markdown parser/token pipeline handles citation
markers only in unescaped prose tokens; regex replacement over raw Markdown is
insufficient. Incomplete streaming markers remain text until structurally valid.
`citations`/`sourceIds` contain only validated used receipts, while turn `sources`
can also retain offered-but-unused retrieval evidence for audit.

The shared parser recognizes raw HTML only to preserve it as literal text;
the frontend emits a fixed React element/attribute allowlist, with remote
images/assets disabled. Headings, lists, bold/emphasis,
tables and code are comparison targets; scripts, active SVG, embeds, forms,
handlers and arbitrary style are excluded. Any permitted external link is a
separate safe-scheme link, never a source resolver or automatic fetch. Internal
citation targets come only from the scoped resolver. Copy uses rendered plain
text and sanitized rendered HTML, so reserved raw markers do not leak into
copied content; exact original clipboard fidelity remains unverified.

Clicking a citation expands/highlights its server source row; clicking the row
resolves current account access and then uses a typed local navigation action.
If a source changed or disappeared, retain its historical receipt and disclose
changed/unavailable state; never guess a similar source or silently use the
current active account. Navigation follows existing draft-save/view-generation
guards and must not discard a user's draft. Chat/source results are keyed by
account/session/turn/revision so delayed requests cannot render across identities.

## Claude protocol and implementation sequence

Current official documentation checked 2026-10-28 describes Messages SSE text,
thinking and tool-input blocks with a final message-stop lifecycle. The adapter
must assemble fragmented UTF-8/SSE frames, validate complete tool JSON, distinguish
transport completion from an `end_turn`, and handle error/unknown event types
without inventing success. This is new-adapter work; the existing nonstreaming
inline request is not a streaming implementation. See
[Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming).

Client tools have named JSON schemas. A tool-use response is followed by matching
tool results in subsequent conversation input; preserve the provider's content
blocks/IDs server-side, validate them and never accept client-forged history.
See [tool definitions](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)
and [handling tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls).
The current configured model is explicitly `claude-opus-5-5`, and the working
adapter uses version header `2026-10-21`; implementation must verify the current
official request fields/header contract again before changing its transport.
No model key or provider request is required for offline protocol tests.

1. After the contact checkpoint releases source, add shared types, isolated
   persistent schema/state machine, scoped routes and legacy `/api/ai` account
   checks. Keep existing inline behavior and mail/calendar write paths separate.
2. Add the indexed local projection/retrieval, exact source receipts and coverage
   tests. Prove query bounds and zero unrelated/full-mail body parsing in a large
   synthetic fixture; migrations must roll back and support legacy-writer
   invalidation before a controlled process restart.
3. Implement native-fetch streaming Claude client with injected fetch/clock,
   durable progress, cancellation and whole-turn limits. No SDK retry defaults;
   no upstream calls in ordinary tests. Coordinate package-lock ownership before
   any Markdown dependency; confirm its official parser/sanitizer documentation.
4. Run the 19 adversarial cases plus restart/failure injection, split-frame SSE,
   wrong-source/unknown-tool, replay pagination, account-switch and shared-budget
   boundaries. Provider mocks prove enforcement, not model factual accuracy.
5. Integrate frontend behind the finalized contract, then compare controlled
   formatting/history/citation/source navigation with original evidence. A later
   root-dispatched synthetic-only Claude check can review actual model grounding
   and stream/Stop presentation; no real-mail test is implied by this plan.

The original backend's complete retrieval denominator, multi-account policy,
model identity, private tool schemas, general action confirmation behavior and
all citation semantics remain unknown. None of this plan establishes full parity.

## Implementation checkpoint

The API implementation and its 261 passing offline tests/strict TypeScript gate
froze at 2026-10-28T07:46:50.189Z. Exact source identities, the superseded checkpoint,
local-index benchmark and remaining live/comparison limits are recorded in
[AI-CHAT.md](../api/AI-CHAT.md). The browser-safe shared types are now exported.
The working stream helper is `api/src/ai-stream.ts`; no separate
`anthropic-stream.ts` was added. It uses native fetch/SSE with no automatic retry.
The shared parser is official `markdown-it` 15.0.3, already pinned by the web
workspace and now explicitly declared by the API; its token-rule API is described
in the [official documentation](https://markdown-it.github.io/markdown-it/).

Known provider-DRAFT message text and draft-derived previews are excluded from
implicit retrieval/context, with omission counts. Initial index work is a bounded
background task, not a full-mail scan on a search request. Projection failures
remain explicit pending/errors without blocking other rows. V4 pure-SQL insert
invalidation handles legacy `REPLACE` even with recursive triggers disabled.
These are local implementation choices and structural checks. No new persistent
chat call was made to Claude, no live database was opened by these tests, and no
original chat/sidebar comparison was run for this implementation checkpoint.
