# Explicit AI artifact Send

This is the reconstruction's durable delivery design, separate from the model's
planning-only `propose_email_draft` tool. It does not recover Superhuman's private
send protocol. Original bounded card/receipt/Undo observations and remaining
unknowns are in [the design ledger](../research/ai-draft-send-design.md).
Live replica Send is still held pending the original Undo investigation and
root-coordinated offline/browser gates. No test in this phase sends real mail.

Browser-safe types are [`ai-draft-send-types.ts`](src/ai-draft-send-types.ts).
Chat status policy `local-chat-preview-send-v3` advertises `send-artifact`; that
means implemented capability, not account permission or successful delivery.
Eligibility is evaluated separately for the exact account and preview. Sending
an already generated preview does not call Claude or require another model turn.

## Routes and immutable request

All responses use no-store and the usual `{error:{code,message}}` envelope. The
scope is always account + session + turn + preview. Missing and foreign Send
resources share `404 ai_draft_send_not_found`, before reading any Draft body.

| Request | Result |
| --- | --- |
| `GET /api/ai/chat/artifacts/:previewId/send?accountId&sessionId&turnId` | `AiDraftSendSnapshot`; no provider call, draft creation or dispatch |
| `POST /api/ai/chat/artifacts/:previewId/send` | Strict request below; `202` for new durable queued acceptance, `200` for exact known-key recovery |
| `GET /api/ai/chat/send-actions/by-request/:clientRequestId?accountId&sessionId&turnId&previewId` | Historical operation recovery; never dispatches |
| `POST /api/ai/chat/send-actions/:operationId/reconcile` | Exact `{accountId,sessionId,turnId}`; snapshot plus `reconciliation`, using the existing bounded provider-read-only Sent check |

```ts
{
  accountId, sessionId, turnId,
  clientRequestId,       // Account-wide immutable action key, 1..128 safe chars.
  expectedPreviewHash,  // Exact server-issued SHA-256.
  expectedGeneration   // JSON integer, not a numeric string.
}
```

Unknown fields are rejected. Client mail fields, Draft/provider IDs, From,
attachments, schedules, markers and arbitrary operation names are not accepted.
Known-key lookup precedes current generation/policy checks; a changed immutable
request conflicts. A key already used for Create Draft cannot become Send, and
vice versa. Recovering an old Create key after Send still returns its original
historical mapping, without another creation or send.

The snapshot is:

```ts
{
  preview,
  creation: AiDraftCreation | null,
  operation: AiDraftSendOperation | null,
  latestGeneration: number | null,
  eligibility: { eligible: boolean, createGeneration: number | null, reason: string }
}
```

No-operation is explicit `operation:null`. Operation includes exact scope,
preview hash/generation/key, creation/Draft IDs, revision/times, delivery-attempt
and provider resource IDs and a sanitized error. Keys, IDs and body content are
never logged. The response never supplies an editable Draft or the unrelated
current composer.

Eligibility requires a completed owned preview, no existing editable creation in
that generation, no accepted Send for that preview, a real Google account,
configured provider, a locally recorded mail-send grant/token presence, strict
nonempty recipients and the configured approved sender/recipient policy. Local
grant/token presence does not prove a future network request will succeed;
refresh, authorization or delivery can still fail. Demo accounts cannot deliver.
No new scopes, credentials or automatic authorization flow are introduced.

## One generation, one explicit intent

An eligible generation initially starts at zero. A canonically deleted
compose-only generation can offer the next generation, under the existing
Create Draft lifecycle. A moved-to-another-account target still exists and is
not eligible. Existing Current Draft/Go To Draft content is never selected or
sent by artifact Send.

One short SQLite transaction creates a **new** dedicated local Draft, generation
mapping and Send ledger. The Draft contains the canonical immutable preview,
empty attachments, no thread/provider-draft link and `status='send_queued'`.
Current sanitization must preserve the exact canonical payload; a changed policy
that would alter an old preview causes rollback and requires new review. Create
and Send contend for the same generation slot under the database write lock.
Whichever wins prevents the other from generating a second draft.

There is at most one accepted Send operation per `(preview,generation)`. Queued,
sending, sent, unknown and not-dispatched tombstones block fresh generations even
when their Draft disappears. A confirmed cancelled generation is the bounded
exception: after its latest Draft is canonically absent, a fresh explicit
key/next-generation action may Create or Send. A moved target still exists and
never qualifies. Old keys cannot re-arm their historical operation. In this phase,
even known pre-dispatch interruption requires status/review rather than an
automatic retry or a fresh-key workaround. A different message intent requires a
separate explicit preview. This is a conservative local policy; original retry
and Undo timing remain unverified.

## States, locks and recovery

| Operation | Meaning |
| --- | --- |
| `queued` | Durable acceptance; provider attempt not yet claimed. The Draft is already locked while it waits for account work. |
| `sending` | Draft, operation and delivery attempt were atomically linked before the Google send call. |
| `sent` | Valid provider resource ACK committed, or exact opaque-marker reconciliation proved a unique Sent match. |
| `not_dispatched` | Accepted operation stopped before any durable attempt. It will not automatically queue on restart or GET/replay. |
| `outcome_unknown` | A claimed attempt may have reached Gmail. It remains locked; Check Sent is the only recovery action in this phase. |

`Store.saveDraft`, `put`, `remove`, `deleteDraft`, attachment operations, provider
Draft synchronization and public PATCH/delete/schedule/cancel/generic Send routes
cannot reuse or mutate a linked artifact Draft. Only internal delivery lifecycle
writes can advance it. A second immutable hash/sender check and current delivery
policy check occur inside the attempt claim transaction. Raw SQL or old binaries
are outside these JavaScript guards; root stops old processes before first
migration. The pre-claim immutable hash detects changed queued content, and the
persistent ledger prevents absence alone from rearming a noncancelled Send. This is not a database
access-control boundary against a hostile local database operator.

The existing account queue serializes provider work in a process. The durable
operation and `beginDelivery` transaction supply the cross-process claim fence:
exact operation, owner nonce, queued state, no prior attempt and immutable payload
must all match. A second live owner can read status but cannot claim the first
owner's accepted job. Across processes, recovery conservatively treats a live
PID as live; same-process owner nonces distinguish another live service from a
closed service. PID reuse/unknown liveness can leave an operation locked rather
than risk dispatch. There is no lease-based takeover or automatic resume.

Dead-owner queued work becomes `not_dispatched`; an interrupted claimed attempt
becomes unknown. Recovery never calls the queue or Google. Startup may first
recover existing Draft delivery state; the artifact service then restores the
linked ledger consistently. ACK, unknown and explicit reconciliation transitions
commit the operation with the existing Draft/attempt updates. Unknown transitions
re-read under the write lock and cannot downgrade a concurrently committed ACK.
Late old-owner completion cannot overwrite a recovered terminal operation.

The delivery marker, requested RFC audit ID, provider resource ID and optional
final provider RFC ID keep their existing distinct meanings. See
[DELIVERY.md](DELIVERY.md). Missing/duplicate markers, incomplete scans or temporary
empty imported search results never authorize a resend. Both artifact and generic
Draft reconciliation routes update the same ledger only after the existing exact
account/Sent/marker proof. Optional metadata enrichment cannot downgrade sent or
repeat the write. Shutdown waits for owned queue/delivery work.

Persist the exact key/hash/generation before POST. After uncertain HTTP transport,
read by that key; a 404 is not proof the old request cannot arrive. Do not silently
POST again, create another key or open the unrelated composer. Only confirmed
local `sent` renders authoritative Sent. The original card showed Sent while
transient Sending/Undo notifications remained visible; that does not establish
its private ACK timing. Original manual and AI-card Undo activation is now observed; exact provider
timing/cutoff remains unknown. The subsequent artifact-only preclaim Undo is
documented in AI-UNDO.md and never attempts a compensating unsend after claim.

## Offline validation boundary

All fixtures use explicit memory/temp `databasePath` and matching
`env.DATABASE_PATH`, synthetic accounts/grants and mocked providers. No test
constructs the live Store, sends email, calls a model or changes a calendar.
Focused cases cover acceptance rollback, generation/action-key exclusion, queued
public and central Store locks, exact canonical content, unknown/ACK-commit
failure, marker reconciliation, two live owners and closed-owner recovery. Full
suite/type/review results will be recorded at the source freeze; this document
alone is not a completed gate or original-parity claim.

The 2026-10-28 source checkpoint passes **298/298** API tests and strict
TypeScript checks, including eight core Send cases and ten independently owned
adversarial cases. The bounded independent review found no remaining actionable
issue within its scope/account/claim/atomicity/recovery checks. Final test output
is `.local/audits/ai-send-api-suite-20261028.log`; file identities and baseline
changes are `.local/audits/ai-send-api-source-freeze-20261028.json`. This is an
offline code checkpoint, not a live replica Send, Undo or original-parity result.
No server restart, live database or provider/model operation occurred in these
checks. The earlier focused sandbox run's one loopback `listen EPERM` was an
execution-permission failure; the approved ephemeral-loopback full run passes.

The subsequent pre-dispatch artifact Undo implementation is documented in
[AI-UNDO.md](AI-UNDO.md). It adds a provisional injected 10-second delay,
server-owned cancellation eligibility and terminal cancelled/restored-draft
receipts; the earlier immediate-only298 checkpoint remains retained above.
Normal composer Undo, Instant Send and exact original timing are still gaps.


## Cancelled-target disappearance and next explicit generation

Later original cleanup/reload `ev_61128f1a7cc1da06176269ab080fc45614f151f52ce1f6f4c16be20b43060d40`
completes 22 actions/23 steps. Only the controlled restored AI draft is emptied and
discarded; restoring its same card offers enabled Send/Create Draft. No second
Send is clicked. Missing events/equality=false leave provider deletion and a
second delivery unproved. This supersedes the prototype's blanket one-Send-per-
preview restriction; it does not authorize automatic continuation.

Current GET uses the **latest creation generation**, with only that generation's
Send operation. A missing cancelled generation0 can therefore return its cancelled
operation0 and `eligibility:{eligible:true,createGeneration:1,...}`. A new explicit
Send1 gets another operation/Draft; a new explicit Create1 makes current Send
GET return `operation:null` with creation1. Create and Send still compete for the
same new generation; different keys cannot make two actions in that generation.

`latestGeneration` reports the server's current creation generation on every
snapshot. Send-key and cancellation-key recovery always return their ORIGINAL
operation, creation and restored target. If a newer creation exists, those
historical snapshots have `eligible:false`, `createGeneration:null` and
`reason:'historical_operation'`; they never select its newer Draft. A known old
POST remains recovery-only. The browser must not regress current state or clear
a newer journal when an older generation response arrives late.

The old one-preview uniqueness schema upgrades transactionally to explicit
`generation` and `UNIQUE(preview_id,generation)`. Existing operation JSON, IDs,
fingerprints, cancellation receipts and original mail JSON stay unchanged.
Malformed legacy generations roll back table/index migration. The retained317
API-only checkpoint archive is
`.local/source-checkpoints/api-317-before-cancel-rearm-20261028T191301Z.tar.gz`,
SHA-256 `a83a45e06bf37b5c2bedbdfbee3cd61b987fc97cbfba5bbb3eb05957dbab2589`.
The prototype checkpoint remains evidence of its earlier policy, not the final
cancelled-target affordance.

The cancelled-target generation refinement passes **325/325** offline API tests
and strict TypeScript checks. It adds three migration/two-owner cases and extends
the independently owned Undo adversarial suite to thirteen passing cases. The
bounded independent review reports no actionable generation/history gap. Final
output is `.local/audits/ai-cancel-generations-api-suite-20261028.log`; source
identities and 317 baseline differences are
`.local/audits/ai-cancel-generations-api-source-freeze-20261028.json`. No live
Store/provider/model/server restart was used; this is not live replica parity.
