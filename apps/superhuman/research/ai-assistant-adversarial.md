# Persistent Ask AI: adversarial acceptance requirements

Recorded 2026-10-28. This is an independent review of the existing replica and a
proposed test contract for its next implementation. It adds no product behavior,
provider calls, authorization, or original parity claim. All fixtures below use
reserved addresses and isolated storage. Original runtime/static findings remain
in [ai-assistant.md](ai-assistant.md); writing is a separate workflow in
[ai-writing.md](ai-writing.md).

## Reviewed baseline and concrete gaps

| File | SHA-256 at review |
| --- | --- |
| `api/src/ai.ts` | `373f32b35ad8fa3afa365b0b368a59c1e2e817a3705bf3a2a4dd41b1aea967cd` |
| `api/src/server.ts` | `d991fa8b3109cda235e3534e4bc09732610e5411df41f1b31204d09cc01ff2e6` |
| `web/src/App.tsx` | `a3f8c6f6eb8a77064bed2146632b7b895c346ae1dafa8eb6401945373cee9a78` |

The legacy `/api/ai` accepts one prompt and optional global `threadId`, with no
account/session identity. `AiProvider.generate` loads that thread directly.
An isolated `Store(':memory:', false)` control with a synthetic account-B thread
confirmed that its marker reaches the mocked provider when referenced by ID;
one mocked request, zero live requests. This establishes a missing scope check,
not a breach of any real account. The new scoped service must enforce ownership
before every read or model request; client selection alone cannot enforce it.

The frontend rejects late answers by account/thread/draft/pane identity and aborts
on context changes. Its unsent `aiPrompt` is one global state value, however, and
is not cleared or scoped on account change. It renders plain text, has no durable
conversation, and cannot validate citations. An open thread currently chooses
`summarize` mode regardless of the question. The new assistant should distinguish
the user's question from optional selected-thread context.

The existing provider already bounds selected-message text and headers, extracts
HTML-only text without remote loading, labels email context untrusted, requires
a complete response, and has a request deadline without automatic provider
fallback. Those protections need to survive the new multi-turn/tool path.

## Required identity and persistence contract

These are local design requirements, not recovered original server contracts.

- A session belongs to exactly one existing account. Each session/turn/source
  route requires that account and checks the stored relationship. Unknown and
  mismatched IDs return the same bounded not-found response, before context
  reads or provider calls. Switching the application's active preference is not
  sufficient authority for a request captured under another account.
- The server owns history roles, turn order, tool results and source maps.
  Clients submit a question, explicit optional context identities, expected
  conversation revision and an opaque client turn key. They cannot inject prior
  `system`, `assistant` or tool messages, provider credentials, source receipts,
  or a replacement account identity inside a model tool argument.
- Persist a turn before dispatch, including its immutable request fingerprint.
  Scope the key to account/session and bind it to the literal question, mode and
  selected context. Duplicate same-key requests share/read one turn; a changed
  payload with that key conflicts. Serialize turns in a session or reject a
  stale expected revision so concurrent tabs cannot invent history order.
- Commit completion, answer and validated source receipts atomically before
  acknowledging HTTP success. A lost HTTP response can then be recovered by
  reading the existing turn. Restart recovery of a dispatched but uncommitted
  model request must report interrupted/unknown; it must not silently dispatch
  again. This does not claim exactly-once processing by the external provider.
- Cancellation and duplicate submission are separate actions. An explicit retry
  may create a new turn/key, visibly related to the failed turn. It is never an
  automatic consequence of timeout, reload, account switch or closing the pane.
  Failed requests remain visible as failed, not fabricated assistant answers.

## Concrete offline acceptance matrix

Each row needs an automated assertion against the actual implementation. Mocked
provider tests establish structural enforcement, not model factuality. API tests
must select actual `databasePath: ':memory:'` or a temporary path; when supplying
an environment, set `env.DATABASE_PATH` to that same path. Never construct an app
or Store against the development database.

| ID | Adversarial setup/action | Required assertion |
| --- | --- | --- |
| AI-ISO-01 | Account A calls session list/detail/turn/status/source routes with B's IDs; repeat with nonexistent IDs. | No B content or distinguishing private metadata; zero provider/retrieval calls; bounded not-found shape. |
| AI-ISO-02 | A's session requests B's selected thread/message/calendar ID or returns B's source ID from a mocked tool/model. Include colliding message IDs under different accounts. | Reject before body/provider access; all joins and navigations check account plus exact parent identity. |
| AI-ISO-03 | Complete A's answer, switch to B, then resolve A's delayed session list/detail/error/answer/source request. | B renders no A prompt, history, citations, errors or completion; A's completion cannot clear B's busy state. Returning to A restores only A's durable conversation. |
| AI-ISO-04 | Type an unsent question under A, switch B, create/select sessions, then return A. | Input is keyed by account/session or deliberately cleared; no A text appears in B. Session creation never inherits a pending question from another identity. |
| AI-HIS-01 | Client submits forged history roles/source maps; retrieved email says “ignore prior instructions”, embeds JSON/tool syntax, fake source IDs and another account ID. | Strict route/tool schemas reject unsupported fields; server-authored history stays authoritative; no expansion of account/tool scope. Email text remains visibly marked untrusted data in the provider payload. |
| AI-HIS-02 | Very long old turns, HTML-only mail, forged From/date fields, script/style/remote image bodies and Unicode/control characters. | Deterministic whole-context and per-field bounds; omission/truncation receipts; no credential fields, raw HTML execution or remote asset fetch. History summaries cannot silently present omitted content as complete. |
| AI-RET-01 | Ask for mail without selected thread; instrument Store/full-body reads and return many matches. | Search uses bounded metadata first; only deliberately selected result IDs load bounded text. No entire mailbox serialization or full body parse for every search row. No provider sync/OAuth/browser activity is triggered by retrieval. |
| AI-RET-02 | Mock tool requests excessive limits, page loops, duplicate calls, unrelated account IDs, unsupported tools or writes named like search. | Server enforces fixed allowlist, parameter bounds, dedupe and shared budgets; no send/draft edit/archive/label/calendar write/action execution method is reachable. Tool names alone do not define capability. |
| AI-RET-03 | Deadline/budget expires between model/tool rounds, search fails, sync is incomplete or one selected source is unavailable. | Stop within the remaining deadline; no background continuation/retry; answer/status describes partial or unavailable scope. Zero matches means “no matches in searched imported scope”, never “no such email exists”. |
| AI-CIT-01 | Model cites unknown IDs, a prior turn's unavailable ID, duplicate IDs, B's IDs, raw numeric `[1]` text or provider-invented URLs. | Only server-issued receipts from authorized retrieval/context become interactive citations. Unknown references are rejected or shown as unverified plain text; no fabricated source row or guessed navigation. |
| AI-CIT-02 | Model pairs source A's ID with source B's subject, arbitrary preview text or a malicious URL. | Label, target identity and preview come from the server's source snapshot, never the model's claims. Citation numbering/order is deterministic after validation; duplicate citations do not create duplicate false sources. |
| AI-CIT-03 | Source is deleted, moved, changes account accessibility or loses calendar permission after the turn; reload a persisted answer and click its citation. | Preserve the historical receipt with an unavailable/stale indication; resolve current access before navigation. Do not silently substitute a similarly named source or use active account defaults. |
| AI-MD-01 | Answer contains raw `<script>`, handlers, SVG, forms, iframes, HTML comments, escaped Markdown, nested lists/tables/code, fake citation links and malformed tags. | Markdown output is sanitized with an explicit element/attribute policy. No script, event handler, editable control, active embed or CSS execution survives. Code/literal bracket text cannot manufacture a citation control. |
| AI-MD-02 | Links/images use `javascript:`, `data:`, `file:`, `blob:`, protocol-relative URLs, credentials, controls or remote tracking images. | No image/asset fetch; unsafe schemes blocked. Allowed external links cannot become internal source actions, use safe new-window relationship when applicable, and do not embed private source text in URLs. |
| AI-IDEM-01 | Double submit before React rerenders; concurrent identical HTTP POSTs; replay after completion; reuse key with altered question/context. | One durable user turn and at most one dispatch for the key; replay returns same status/result; changed fingerprint conflicts. UI locks synchronously, independently of button-render timing. |
| AI-IDEM-02 | Restart before dispatch, while dispatching, after provider response but before commit, and after commit before HTTP acknowledgement. | Explicit durable outcomes at each boundary; no automatic repeat of an ambiguous dispatch; completed atomic result survives. Test failure injection, not real sleeps or real provider requests. |
| AI-UI-01 | Start request, then close/unmount, switch account/session, select a newer conversation or submit a new turn; resolve old promises despite abort. | Account/session/turn revision and mounted-state checks reject stale success/error/finally. Unsent new input and newer busy state survive. Abort is best effort and never described as proof that provider computation stopped. |
| AI-UI-02 | Switch open mail thread/draft during a persistent Ask AI conversation; click an older citation while unsaved compose content exists. | Snapshot the exact optional context used per turn; no silent retargeting. Citation navigation follows existing draft-save/view-generation guards. Persistent conversation identity and ephemeral selected context are separate. |
| AI-UI-03 | Stop during retrieval/response, reload/reopen pane, then retry; late answer arrives after cancellation. | Read status for the same turn; no false completed answer, no partial Markdown insertion, no duplicate question/model dispatch. Stop/retry labels state whether the local request or durable job was stopped. |

## Bounded retrieval policy to finalize before implementation

Choose and publish numeric ceilings in one server policy, then test the exact
boundary and one-over-boundary case. A candidate starting policy is at most four
provider rounds, eight read-only tool invocations, fifty summary results, eight
full-thread reads, ten messages per selected thread and 4,500 text characters per
message, with a shared 96 KiB serialized-context ceiling and a 60-second whole-turn
deadline. These are proposed limits, not observed Superhuman values or a claim
that every allowance can be consumed simultaneously. Stop when any shared limit
is reached. Existing request bounds must not multiply unchecked across tools or
history. Calendar/date searches additionally require explicit bounded ranges and
timezone semantics; unknown free/busy results never imply availability.

Source receipts should contain an opaque source ID, account ID, source kind,
exact local/provider parent IDs, fetched-at/revision, bounded authoritative label
and snippet, and truncation/availability flags. Persist those with the turn.
Only an allowlisted read resolver may turn a receipt into a current destination.
The model can choose among offered IDs; it cannot mint IDs or choose arbitrary
URLs/SQLite queries/HTTP endpoints. Log counts, timings and sanitized error codes;
do not log prompts, mail bodies, tokens or raw provider diagnostics by default.

## Grounding and original comparison gates

Deterministic validation can prove citation identity membership, account scope,
safe rendering and capability limits. It cannot prove that an answer's sentence
is supported by its citation, nor that prompt injection never influences model
wording. Add a small reviewed synthetic corpus: contradictory dated messages,
an absent exact marker, a forged instruction in one message, an older corrected
fact, a truncated thread, duplicate subjects and a missing source. Require
correct source selection, uncertainty when evidence is absent, and preservation
of the corrected chronology. Record provider/model, prompt, retrieved IDs,
budgets, result and a reviewer judgment; keep any real-mail material private.

Root's original probes are separate evidence. Compare fresh/persistent session
behavior, optional selected context, answers/Markdown, citations/source expansion
and source navigation against controlled original observations before marking
those features verified. Existing selection rewriting and plain-text synthetic
Claude successes do not establish persistent Ask AI, retrieval or citation parity.

## Offline implementation review after the frozen contact checkpoint

The next implementation is separate from the frozen 380-step browser run.
The concrete transport/storage contract is now in
[ai-chat-contract.md](ai-chat-contract.md); its UTF-8 byte ceilings and state
vocabulary supersede the candidate limits above. No real-mail/Calendar/provider
request or original browser comparison was performed by these tests.

| Independent test file | Focused result / boundary |
| --- | --- |
| `api/test/ai-chat-adversarial.test.ts` | 20 passed: ownership, key replay, two SQLite owners, restart/late-completion fencing, event limits, source versions/provenance, atomic dispatch receipts, unserved citation guesses, timezones, fixed whole-turn deadline, history isolation, completion rollback and legacy SQLite REPLACE invalidation. Storage is memory or explicit temporary SQLite; provider responses are synthetic streams. |
| `api/test/ai-stream-adversarial.test.ts` | 14 passed: byte/frame splits, CR/LF framing, tool JSON/lifecycle, abort, byte/event limits and genuine thinking progress. No model calls. |
| `web/test/ai-markdown-adversarial.test.ts` | Six passed, alongside seven renderer checks: HTML literals, unsafe/nested links, loopback URL forms, exact source maps and receipt mutation. Rendering uses fixed React elements. |
| `web/test/ai-chat-adversarial.test.ts` | Nine controller checks passed: account/session/prompt isolation, unknown-POST/404 recovery, immutable key replay, response identity, stale session/source results, storage failure, citation-map consistency and selected context captured per turn. This does not by itself prove App integration. |

The reviews reproduced concrete defects before correction: event overflow did
not terminate locally; source changes could be hidden behind unchanged message
dates; draft-only source navigation stayed available; unsubmitted tool receipts
could become citation candidates; HTML/invalid-link literals could mint citation
controls; mutable receipt arrays retained old bindings; and SQLite REPLACE with
recursive triggers disabled left obsolete indexed text available. The corrected
controls pass without weakening their intended outcomes. The index upgrade is a
versioned derived-data rebuild; original message records are preserved.

Shared browser-safe token policy lives in `api/src/ai-markdown-policy.ts`.
HTML is recognized to keep complete tag/comment/container literals inert, then
converted to text tokens. Unsafe link syntax is recognized to keep its labels
out of citation prose, then its destination is removed. No provider string is
inserted as raw DOM HTML. Both server citation extraction and the React renderer
use that policy; source resolver authorization remains a separate boundary.

These are structural, synthetic controls. Real model factuality, original
streaming/session/citation presentation, live retrieval quality, browser UI
integration and original feature parity still require separately recorded
evidence. The earlier complete contact browser run remains valid only for its
recorded source hashes.

The final offline integration gate subsequently passed **261 API tests and 208
web tests**, plus build and strict types. Two additional independent actual-Pane
tests proved navigation loses authority on unmount and immediately after a newer
source click, including when its resolver is still pending. Actual-App tests
also cover draft-save/session/close races; Calendar-source tests cover exact
identity/date, stale targets and unavailable sources. App SHA-256 is
`b001de087ff92843762bee58a8663d3cb71a36c7dcad6f5e24baa5108bf5f366`.
These integration tests remain offline; no new browser comparison, live model
call, main API restart or real database migration was performed by these agents.
