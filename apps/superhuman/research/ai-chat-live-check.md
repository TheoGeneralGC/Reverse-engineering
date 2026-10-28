# Isolated synthetic Ask AI API check

Recorded 2026-10-28. This is a bounded check of the reconstruction's live Claude
adapter through its own API, not an original-app comparison or a full parity
claim. Original Ask AI evidence remains in [ai-assistant.md](ai-assistant.md).
The API contract/offline gates are in [AI-CHAT.md](../api/AI-CHAT.md).

## Scope and identity

The root investigator started an isolated API on `127.0.0.1:3003` and confirmed
readiness before execution. The harness never restarted a service, read a key or
environment file, connected a Google account, opened the live mailbox database,
or called a provider directly. Requests went through the local chat API using
only its seeded, explicitly synthetic demo account.

Before each turn, guards asserted exactly one account (`demo`, provider `demo`),
active demo mode, metadata-only bootstrap, all three Google credential names
reported missing, empty delivery approval lists, Calendar disabled/unconfigured,
no Calendar grant, and Claude configured as `claude-opus-5-5`. The local index had
13 projected records and zero pending/error records. The exact owned synthetic
message was read locally and checked before the first model submission.

Provider/model values here describe the configured adapter and observed durable
response state/IDs, not the original Superhuman model or a vendor attestation.
No key, provider request ID, chat/session ID or real account identity is published.

| Frozen component | SHA-256 |
| --- | --- |
| Chat service | `9950c1e7135892c5a520a6102664f95add9228e810a363eb49f3fb51b782ae69` |
| Retrieval/index | `9801ac022491548b166e806f2c6054a73ee5e38f879a7ae90cd88bd363a295f5` |
| Stream parser | `790217edac043ac7c25ab9def4400a77c6fb7d7cba063182202d09ad1fed98c0` |
| Shared Markdown policy | `2d7e4818704c6ef80ec6bdfda858c546a9b037abe239980771cb908671d48502` |
| API router | `de96083141161792aa1afd4f2cb99eb01729f9c2b7395a86472cadec10fd3e66` |

The root checked the handoff source identities before isolated startup. Complete
API source identities are in the private
`.local/audits/ai-api-source-freeze-20261028-v2.json` manifest.

## Preserved failed preflight

Run `ai-chat-20261028-01` stopped because the harness incorrectly assumed at least
15 indexed demo records. The isolated fixture actually contained 13. It made two
read-only local requests and **zero session or turn POSTs**; no model request was
dispatched. This was a test-fixture count assumption, not a product failure.

Its state/failure files remain unchanged in the ignored private run directory.
The separately planned run `ai-chat-20261028-02` required the observed exact count
of 13 plus the exact owned-message baseline. A correction record retains the
earlier failure hash and zero-POST proof. No product source was changed to make
the check pass, and no uncertain paid request was repeated.

## Three-turn result

Run 02 executed from `2026-10-28T17:03:34.092Z` to
`2026-10-28T17:04:03.270Z`. All three submitted turns completed. There were five
recorded upstream model dispatches: one for formatting, three for the
search/read/answer tool loop, and one for the history follow-up. Local traffic was
two session-creation POSTs, three turn POSTs and 66 GETs. The harness only allowed
chat session/turn POST routes; it invoked no mail or Calendar write route.

| Check | Observed result | Dispatches / server turn duration |
| --- | --- | --- |
| Fictional formatting, fresh session, resources `[]` | Heading, at least two bold-label bullets, a two-data-row table with correctly paired fictional values, and inline code. No tools, receipts or citations. Markdown structure was parsed from the API response, not inspected in a browser. | 1 / 2.467 s |
| Imported demo message, resources `['mail']` | Recorded completed `mail_search` and `mail_read` operations. The answer correctly stated the sender, relative timing and requested-feedback order. One citation referenced the exact full-message read receipt; a fresh resolver returned the exact owned target with `available` state. | 3 / 16.304 s |
| Same-session follow-up, resources `[]` | The question omitted the prior sender/timing facts. The answer retained those facts using server-owned conversation history, without a new tool, selected thread, receipt or citation. History GET returned both turns in order. | 1 / 2.639 s |

All final turns had `answer.finishReason='end_turn'` and provider outcome
`response_observed`. Each durable client key was recovered by a GET lookup;
turn ID, dispatch count, provider-ID list, revision and event sequence remained
unchanged. No POST was automatically retried. These specific reads demonstrate
replay without another recorded dispatch; they do not establish universal
exactly-once provider billing/processing.

The factual/structure assertions passed. A separate local review of the saved
synthetic answers also found the requested facts/structures and exact full-read
citation correct, with no contradiction or uncertainty about the requested facts.
This is a small controlled corpus, not a general grounding or injection-resistance
evaluation. Full generated answers remain private.

## Progress evidence and limitations

Formatting retained 11 events, including six real text-delta batches and two
thinking-state events. Two polling observations saw nonempty text while the turn
was still running. The follow-up retained nine events, four text batches and two
thinking-state events; one in-flight partial-text observation was captured.

Retrieval retained 13 events: four state events, four tool start/completion events,
two source receipts, two text batches and one terminal event. Its text batches
arrived close to terminal completion, and no polling snapshot captured nonempty
in-flight text. Therefore this case proves durable received progress/answer data,
not a particular visible token cadence. Server durations include local work and
multiple model rounds; client waits also include polling/private evidence writes.
They are not original-app performance comparisons.

No browser/UI/clipboard/source-navigation interaction or original comparison was
performed by this API harness. Live Stop, cancellation cost behavior, model
refusal/timeout recovery, real-mail retrieval, multiple-account live isolation,
Calendar retrieval and a complete feature denominator remain unverified by this
check. The offline adversarial tests cover structural boundaries separately.

A generated assertion that no actions were taken is answer text, not independent
mutation proof. Evidence here is the harness's route allowlist/request journal,
isolated demo-only readiness/credential guards and observed durable state. This
was not a comprehensive upstream network or provider-write trace, and it has no
REA equality/coverage claim or fabricated REA evidence ID.

## Private artifacts

All paths below are ignored and private; do not commit their full content.

| Artifact | Location / SHA-256 |
| --- | --- |
| Prior failed preflight | `.local/live-tests/ai-chat-20261028-01/failure-report.json`; exact hash retained in run 02's correction record |
| Reviewed harness | `.local/live-tests/ai-chat-20261028-02/harness.mjs` / `aa27530e10604b55495dede636ffa8737153fc5d5f4c57d79a6f03dc0d71a2a0` |
| Full final report | `.local/live-tests/ai-chat-20261028-02/report.json` / `c28ea57cbee7ccebf863dcf591c0be2538ea6cd2f6f9e5f5252dc21db94f448f` |
| Bounded counts/timings | `.local/live-tests/ai-chat-20261028-02/sanitized-summary.json` |
| Independent saved-answer review | `.local/live-tests/ai-chat-20261028-02/independent-quality-review.json`; booleans tied to the full report/answer hashes, with no further API/model calls |
| Integrity check | `.local/live-tests/ai-chat-20261028-02/final-integrity-check.json`; confirms prior failure content unchanged and zero original POSTs |
| Exact local responses/source baseline | Numbered `http-*.json` and `synthetic-source-baseline.json` in run 02 |

The harness refuses to rerun a started run. Further paid tests require a new
explicitly scoped plan; an uncertain request must first be inspected using its
existing key, never silently resubmitted under a fresh one.
