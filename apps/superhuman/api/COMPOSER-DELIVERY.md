# Normal composer Send and Undo (private implementation candidate)

This is an additive local delivery design. It has not been applied to the running
application or exercised against Gmail. The original manual and AI-card Undo
activations are observed; exact provider dispatch timing and normal-composer
end-to-end parity remain unverified. Ten seconds from durable local acceptance
is a provisional local policy, consistent with the observed notification retention
of approximately ten to eleven seconds rather than a measured provider deadline.

## Same draft and explicit intent

`GET /api/drafts/:draftId/send-operations?accountId=...` returns a
`DraftSendSnapshot` (see `src/draft-send-types.ts`). For an editable owned draft,
its `draftRevision`, `contentHash`, and `eligibility.generation` identify the
current intended content. `resolution` and the optional `draft` are account scoped.
The hash includes exact To/Cc/Bcc, subject, plain/HTML, authenticated sender,
attachment metadata and SHA-256 bytes, provider draft container, and the selected
reply parent. It excludes delivery control fields and timestamps.

An explicit Send posts to the same route:

```ts
{
  accountId: string;
  clientRequestId: string; // safe opaque token, 1..128 characters
  expectedDraftRevision: number;
  expectedContentHash: string; // lowercase SHA-256
  expectedGeneration: number;
  scheduledAt?: string; // Explicit-offset ISO; omission is immediate Send.
}
```

The operation insert and same-draft `send_queued` lock commit together. No draft
copy is made. The accepted reply parent is frozen independently of later inbox
arrivals. Existing attachment bytes and provider linkage stay attached to that
same local Draft ID. A fresh acceptance returns202; an exact historical key
returns200 and never starts work again. Changed payload under a used key is409.

An immediate intent starts an owned process-local timer after acceptance. The timer remains
outside the account queue. Only after its immutable deadline may the shared
account queue enter the durable delivery-claim transaction. The existing Gmail
pipeline writes the opaque delivery marker and attempt before any send request;
no provider write retry is added.

## Undo and recovery

`POST /api/draft-send-operations/:operationId/cancel` accepts
`{accountId,clientRequestId,expectedRevision}`. Undo can commit only while the
operation is queued and has no claimed attempt. Immediate Send additionally
requires server time before its immutable Undo deadline. A scheduled intent
can be cancelled until claim, including while overdue behind account work. Its receipt, cancelled state, and same-draft restoration are
one transaction. An account queue blocked by unrelated provider work cannot block
this local cancellation transaction. The restored draft keeps content,
attachments, provider linkage and ID, clears the composer delivery lock, and
increments its editable revision. There is no compensating provider unsend.

Recovery is read only:

- `GET /api/draft-send-operations/by-request/:key?accountId&draftId`
- `GET /api/draft-send-cancellations/by-request/:key?accountId&operationId`

A lost response never authorizes an automatic new key or dispatch. A cancellation
key replay returns its historical receipt and does not restore or overwrite later
edits. After a new intent exists, recovery for an old key returns the old operation,
`latestGeneration`, a locked resolution, and no newer draft body. New Send after
Undo requires a fresh key plus the new current revision/hash/generation. Replaying
the old key forever selects its old cancelled operation.

`POST /api/draft-send-operations/:operationId/reconcile {accountId}` is available
only for `outcome_unknown`. It uses the existing bounded exact-marker Sent check
and never resends. Sent and unknown are locked. Interrupted or shut-down queued
immediate work becomes `not_dispatched` and does not queue on startup. Claimed interrupted
work becomes unknown. Another live PID/owner nonce is left alone; PID reuse is
handled conservatively as live, so manual resolution may be needed rather than
risking a duplicate claim.

## Cross-action boundaries

AI-card and composer operations register separate Store hooks. Exactly one
persistent operation owns any delivery claim, ACK or unknown transition.
Create/AI Send/AI Undo/composer Send/composer Undo request keys share an
account-scoped conflict check under the SQLite write transaction. Generic Store
writes, attachment changes, delete, cloud sync, generic dispatch and native Gmail
send cannot bypass an active composer lock.

After any confirmed AI/composer cancellation, legacy keyless
`POST /api/drafts/:id/send` and scheduling reject with `send_intent_required`.
This prevents a delayed old POST from resending restored content. Callers must
adopt the keyed route for a new intent. Keyless behavior for drafts without any
cancellation history remains for compatibility and is not the final parity path.

The new routes strictly reject extra request fields and malformed/duplicate
query keys. Uniform scoped404 precedes foreign draft JSON reads. Recipient and
sender approval/grant validation occurs before acceptance and again before claim.

## Explicit gaps

- No Instant Send, hover-paused countdown, or generic Send UI has been
  implemented or compared in this backend candidate.
- Existing explicit Gmail draft sync remains a separate, older mechanism. This
  implementation does not add cloud autosave, import existing Gmail drafts for
  editing, conditional cloud updates, a durable cloud-write ledger, or cloud
  deletion. A provider draft replacement already in flight in another process is
  not made atomic by this local delivery ledger.
- Moving a cancelled same-ID draft to another account disables this candidate’s
  delivery eligibility rather than aliasing its prior account’s intent generation.
- A queue that never claimed a provider attempt remains locked if its owner
  exits; no new intent is inferred automatically.
- The current account approval lists remain test-delivery gates. This private
  candidate has made no live API, message, model, or invitation calls.

## Keyed Send later

The same POST optionally accepts `scheduledAt`, a future explicit-offset ISO
instant with at most millisecond precision. It is canonicalized to UTC and bound
to the request fingerprint. The operation declares `mode:'scheduled'`, its
`scheduledAt`, and the same local Draft ID. The Draft stays `scheduled` and
locked. There is no timer spanning the future date; bounded job ticks select up
to20 due owned queued schedules, then use the ordinary account queue and atomic
claim. Cancellation and claim race in the same SQLite write boundary.

Clean shutdown preserves unclaimed scheduled intents. On a subsequent server
startup, only a demonstrated dead owner's intact queued scheduled intent with
no attempt may transfer ownership. The constructor sends nothing; ordinary
jobs resume that previously authorized schedule when due. A live owner is never
stolen. Claimed, sent, cancelled, failed-before-claim and unknown operations are
never automatically retried. An existing other server does not implement hot
failover; takeover occurs at startup. This explicit future-intent policy differs
from immediate Send, which never queues again after interruption.

A historical scheduled key remains recoverable after its original time passes.
It never changes time or dispatches again. Rescheduling requires keyed Cancel
followed by a fresh key/hash/revision/generation. This also supports Schedule
after AI/composer Undo without bypassing the legacy keyless safety guard.

## Offline verification checkpoint

The retained immediate-only347 candidate passed347/347 API tests, including the325-check baseline,
thirteen composer core cases and nine independent adversarial cases. Strict
NodeNext TypeScript passed. Tests used explicit in-memory/temporary SQLite paths
and mocked providers; only test-owned ephemeral loopback listeners were enabled.
The independent review found no remaining actionable blocker in that bounded
scope. No actual mail, draft cloud write, model call, or invitation was attempted.
The root API’s83 baseline files remained byte-identical at that archive time. The additive keyed scheduling candidate has separate
verification records and retains that prior archive. Frontend
adoption of the keyed normal-composer routes is required before live rollout.
