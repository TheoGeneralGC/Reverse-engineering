# Ask AI card Send: observed flow and proposed boundary

Recorded 2026-10-28. This is evidence review and implementation design only.
The structured Create Draft API remains at its separately frozen 280-test
checkpoint. No production API, delivery implementation, browser or provider is
changed by this document. [Draft creation](ai-draft-design.md) and
[existing delivery identity](../api/DELIVERY.md) remain separate contracts.

## Observed original flow

The target remains the authenticated Superhuman web client in Chromium
156.0.8078.48; retained source identity and earlier coverage are in
[ai-assistant.md](ai-assistant.md). The operator used one controlled synthetic
preview and the already explicitly approved pair of participants. Real addresses,
account/session/draft/message identifiers and complete captures stay ignored and
private. A chat submit is distinct from the email card's Send control.

| Stage | Retained evidence and result |
| --- | --- |
| Preview/preflight | The owned card has one exact approved peer in To, no second recipient or Cc/Bcc, an exact controlled subject and a short synthetic body. Sender identity is checked in the separate owned composer preflight; no account navigation intervenes in the declared flow. This is bounded UI identity evidence, not a recovered provider-side sender selection contract. |
| First guarded attempt | `ev_bfa21fd963b16ca3ce706f0034d8dee489d4256a3f680f80068db54c3c7e8ada`: ten steps complete, the exact body wrapper guard fails, and the Send step plus three later steps are explicitly cancelled as not executed after the failure. Static descendant text matches the expected 97-byte body; its nested `div`/`br` explains why the wrapper exact-text matcher was unsuitable. This was not an ambiguous timeout during Send. |
| Second guarded attempt | `ev_2853cde7d585b844d3859154b9fec68cbe8fbc0cd354f87a91f6514ca3a4bb8f`, retained as `original-approved-send-reviewed-once.json`, likewise stops at a guard before its declared Send. The final success does not erase either earlier failed capture. No click is inferred from a journal's armed/attempted flag. |
| Successful single Send | `ev_7492ffd2c967ea0678bcb39e11ce2f6a8d0e527df08992b53cde1a7d0edf96ee`, `original-approved-send-descendant-guard.json`: **15 actions/16 retained steps**, all completed. Exact To/no-second-recipient/no-Cc/no-Bcc/body and no-extra-paragraph guards precede one declared card Send click. The step-count correction is deliberate: the retained artifact has sixteen steps, not seventeen. |
| Post-click UI | Four retained snapshots—the Send result and three subsequent waits—each contain the unique owned card, exact synthetic body and one native-disabled `Sent` button. This shows that card's bounded UI transition, without claiming an observed confirmation dialog, Undo activation, error flow or universal terminal state. The retained global AX also exposes a transient Sending/Undo Instant Send toast, then Message sent/Undo Instant Send in the early and middle waits; the later wait lacks it. Card Sent alone therefore does not establish when a provider dispatch or acknowledgement occurred. |
| Independent receipts | The final private GET-only observation report finds one matching provider-backed imported message in each approved account. Both have the exact approved sender, sole approved peer, no Cc, the controlled body facts and the same nonempty Internet Message-ID. The final observation uses five local API GETs, zero POSTs. This is stronger delivery evidence than generated prose or the Sent label alone; it is not a raw-MIME byte-equality test or recovered private send protocol. |

The final receipt report SHA-256 is
`19f054f0d185b9d40f6ad47e9d68905a68a4c8cdb6b9cfe267898db375d1bd1b`.
Its immutable final snapshot matches that hash. The final journal records exactly
one Send click and confirmed sender/recipient observations.

The earlier receipt window reported zero sender matches and one recipient match
while import converged. A bookkeeping assertion incorrectly expected all-zero
matches before archiving it; after the failed assertion, a later observer reused
and overwrote that full report path. The exact earlier summary survives, together
with the final report/immutable snapshot; the earlier full report does **not**.
The private incident record is
`.local/audits/original-ai-send-receipt-reporting.json`. Its observers issued only
GET requests. Subsequent retained-server review shows that the thread-list GET
also starts `wakeSnoozes()`; the observers did not establish whether any due
snooze was present. Zero POSTs therefore does not establish zero incidental
server-side record writes. Future absence audits use a read-only SQLite handle
and no application routes. Temporary imported counts must never be treated as proof a
send failed, and subsequent observations must use exclusive immutable paths.

Independent offline review is retained as
`.local/live-tests/original-ai-send-20261028-01/independent-success-review-v2.json`,
SHA-256 `b5409316e211d40c94173c558064dd824063231b17eb9daf2abfefec1c55a8e4`.
It checks retained JSON and static JSDOM only, without scripts/resources, browser,
provider, live database or state mutation. The first independent report retains
its single failed seventeen-step count assumption; v2 corrects that harness
assumption without changing source captures or delivery assertions.

The original capture retains incomplete event-family coverage and is not
eligible for strict equality comparison. One successful approved-pair send does
not establish retry/idempotence, server queueing, account-wide sender semantics,
rich MIME, attachments, Undo activation/cancellation window or provider dispatch timing, Send after Create Draft, edited-draft handling or original
backend storage. These remain unknown. The existing reconstruction's explicit
opaque-marker protocol is independently evidenced and must not be attributed to
the original app.

## Proposed implementation scope

The next local feature is an **explicit artifact Send action**, with its own
durable operation ledger and the existing delivery pipeline. It is never a model
tool. `propose_email_draft` remains planning-only; retrieved messages, generated
Markdown and historical previews cannot authorize Send. No new model request is
needed to send an already reviewed immutable artifact.

Initially Send is offered only while a preview has a currently eligible,
**uncreated** generation, matching the original pre-creation card shape. An
existing Current Draft/Go To Draft mapping has one navigation action; it cannot
silently send its current edited content or the old preview. Card Send must never
call the application's current-composer send callback, choose a current Draft ID
or autosave preview fields over another draft.

The send action consumes the same `(preview,generation)` creation slot as Create
Draft. Both paths run under SQLite `BEGIN IMMEDIATE`: whichever commits first
wins. A concurrent opposing action receives a conflict and reloads the existing
mapping; it cannot produce a second draft or send the mapped edited draft. A
canonically deleted compose-only generation may offer its next generation under
the existing deliberate re-creation policy. A generation claimed by Send retains
its send tombstone even if its local draft later disappears; it does not restore
Send/Create merely from absence. Repeating the message after an accepted Send is
a separate future explicit intent, not a new key masquerading as recovery.

No provider-draft sync occurs in preparation. The transaction creates a **new,
dedicated** server-ID local Draft from the canonical preview, with no attachments,
signature additions, schedules or existing-draft linkage. It records the immutable
payload hash, selected account, observed generation and sender identity snapshot.
It marks that draft queued/locked immediately, before asynchronous queue waiting.
The exact model-supplied field set is not reinterpreted at dispatch.

## Proposed typed transport

The following names are a plan, not currently implemented exports or endpoints.
This section preserves the pre-implementation proposal. The subsequent implemented
transport and offline gates are authoritative in [AI-SEND.md](../api/AI-SEND.md);
Create Draft remains a separate action and never becomes a model tool.

```ts
type AiDraftSendState =
  | 'queued'             // Durable acceptance; no provider attempt yet.
  | 'sending'            // Durable attempt exists before provider call.
  | 'sent'               // Durable valid ACK or exact marker reconciliation.
  | 'not_dispatched'     // Interrupted/preflight failure before an attempt.
  | 'outcome_unknown';   // Attempt may have reached Gmail; never auto-retry.

type AiDraftSendOperation = {
  id: string;
  accountId: string; sessionId: string; turnId: string; previewId: string;
  generation: number; creationId: string; draftId: string;
  clientRequestId: string; payloadHash: string;
  state: AiDraftSendState; revision: number;
  createdAt: string; startedAt: string | null; confirmedAt: string | null;
  deliveryAttemptId: string | null;
  providerMessageId: string | null;
  error: null | {
    code: string; message: string; retry: 'none';
    providerOutcome: 'not_dispatched' | 'unknown' | 'confirmed';
  };
};
type AiDraftSendRequest = {
  accountId: string; sessionId: string; turnId: string;
  clientRequestId: string;
  expectedPreviewHash: string;
  expectedGeneration: number;
};
type AiDraftSendResponse = {
  preview: AiDraftPreview;
  creation: AiDraftCreation;
  operation: AiDraftSendOperation;
};
```

| Proposed route | Behavior |
| --- | --- |
| `POST /api/ai/chat/artifacts/:previewId/send` | Strict request above. `202` durably accepted queued operation; same exact known key returns its original current operation without another queue dispatch. Clients do not infer successful delivery from 202. |
| `GET /api/ai/chat/artifacts/:previewId/send?accountId&sessionId&turnId` | Current send operation, or explicit no-operation state. No dispatch, retry, new draft or provider request. |
| `GET /api/ai/chat/send-actions/by-request/:clientRequestId?accountId&sessionId&turnId&previewId` | Read-only lost-ACK recovery of the exact historical operation. A 404 is not proof the old POST cannot arrive. |
| `POST /api/ai/chat/send-actions/:operationId/reconcile` | Explicit scoped provider-read-only reconciliation through the existing draft delivery protocol; returns operation plus bounded scan result. It cannot send or prepare a replacement. |

The final implementation must align route naming with frontend before publication.
Every path verifies account/session/turn/preview/operation/generation relationship
before reading a Draft or attempt. Foreign/missing identities share one bounded
not-found shape. Unknown body/query fields, malformed keys, numeric-string or
negative generations and changed hashes fail before acceptance.

The ledger enforces unique `(preview,generation)` Send and account-scoped client
key/fingerprint. The fingerprint includes action kind, account/session/turn,
preview, generation and immutable hash. Reusing an existing action key for another
kind/intent conflicts. Replays resolve their original operation before current
generation/capacity checks, never a later generation. Client-supplied mail fields,
From, Draft IDs, provider IDs, attachments or delivery marker are not accepted.

Readiness must distinguish implementation/configuration from per-preview delivery
eligibility. Send requires a real Google account, complete valid nonempty outgoing
recipients, configured sender and recipient approvals and current OAuth readiness.
No approval/key values are returned. Missing scope or credentials produce honest
setup errors; demo mode cannot report successful delivery. Policy is checked
before acceptance and again before durable attempt claim to catch changed
permissions/configuration. A card being syntactically valid is not permission to
send it.

## Durable queue and delivery integration

1. In one short transaction, recheck owned completed artifact, fingerprint and
   eligible generation; validate all outgoing header fragments and delivery
   policy; insert the dedicated queued Draft, creation slot and Send operation.
   No external request occurs in this transaction. A lost local commit/ACK is
   recovered by the original key; partial Draft/operation state rolls back.
2. Enqueue only this newly accepted operation in the existing account operation
   queue. Different requests and GET/poll/replay paths never enqueue it again.
   A live worker owner/fence prevents a second process from claiming it. Gmail
   sync slices and other account actions continue using the same queue.
3. Immediately before dispatch, re-read the operation/Draft/account and compare
   canonical content and account identity to the immutable artifact hash. Reject
   any changed payload. Queued drafts are locked against PATCH, autosave,
   attachment, schedule, delete, provider-draft sync and competing send routes,
   including the waiting period before provider `sending` is persisted.
4. Extend the existing `beginDelivery` transaction internally so it atomically
   links the Send operation and its delivery attempt, advances `sending`, and
   persists the requested RFC audit ID and opaque marker **before** a Gmail send.
   The current Store method owns its transaction, so nesting another transaction
   is unsafe; use a typed internal commit hook or a single shared transaction
   helper. Existing callers remain compatible. No hook is client supplied.
5. Invoke the existing Google send/MIME path once. It already validates approved
   sender/recipients and uses no automatic mutation retries. A valid ACK commits
   Draft, attempt and artifact operation `sent` atomically. ACK-commit failure,
   disconnect, malformed ACK or crash after attempt claim remains unknown;
   neither the original key nor a new key sends again.
6. Extend unknown/completion/reconciliation transactions to update the linked
   ledger atomically. A crash after acceptance but **before** any durable attempt
   is `not_dispatched` on dead-owner recovery; it is not automatically resumed
   after restart. Initial scope offers status/recovery, not an unreviewed Retry
   button. A live accepted job may finish under its original owner. Any future
   explicit continuation must prove no attempt exists and keep the same operation.
7. An unknown operation can become sent only from the existing valid ACK or exact
   opaque-marker/Sent/account reconciliation. Requested RFC-ID, subject/body,
   temporary search absence or the original app's UI text are not proof. The
   current bounded complete-scan/duplicate/missing-marker rules remain intact.

A new explicit queued status or an equivalent durable operation lock is needed;
reusing `scheduled` with an immediate due time would wrongly expose this message
to timer resend paths. All writer routes must honor that durable lock before the
feature is enabled. Original source JSON is not rewritten in migration; ledger
schema/migration/recovery tests must use memory/temp databases, with running
processes stopped by root before first live migration. No UDF triggers are needed.

## Frontend and acceptance gates

The card displays the exact canonical To/Cc/Bcc, subject and body to be sent.
A capability/eligibility response controls whether explicit Send is available.
The user action journals the exact key/hash/generation before POST; it never
reads the unrelated current composer. Account/session/preview/generation and
request revisions guard every late response.

Queued/sending displays pending and disables Send/Create; unknown displays an
honest delivery-unknown status and explicit Check Sent reconciliation. Only
confirmed operation `sent` renders native-disabled Sent, matching the observed
bounded final state. `not_dispatched` is explicitly distinct and still does not
automatically create a fresh key or replay. The current composer/autosave guard
must preserve unrelated user draft content. Polling and history restore are
read-only. Model-generated claims cannot change these action states.

Before live use, require isolated tests for:

- Model proposal/Markdown/history cannot invoke Send; missing approvals and demo
  accounts have zero accepted operations/provider writes.
- Send/Create races, duplicate/different keys, two SQLite owners and late historical
  responses produce one generation and at most one durable dispatch claim.
- Artifact content remains immutable; an edited/current/foreign Draft is never
  selected or overwritten, and queued payload mutation is blocked/detected.
- Acceptance, attempt claim, ACK and reconciliation failures each roll back or
  preserve explicit uncertainty; old keys never resend after crash/unknown.
- Strict headers, rich MIME and exact marker identity reuse existing tested paths;
  no weakened recipient parser, body/subject proof or mutation retry is introduced.
- Fresh explicit scope/account checks precede reads; cancelled navigation and
  lost-ACK recovery do not open another contact/account's message or issue POST.

Only after code review, offline API/UI gates and the current Create Draft
checkpoint should root authorize one separately journaled synthetic approved-pair
replica Send, with durable key, preflight review and independent counterpart
receipts. Preserve failures and use immutable observer outputs. The original
single successful Send comparison is a bounded reference, not full parity.
