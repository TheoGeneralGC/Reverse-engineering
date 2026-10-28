# Pre-dispatch Undo for AI artifact Send

This is a local reconstruction implementation. Its default **10-second** delay
is provisional policy, not a measured original cutoff. Original manual
Send→immediate Undo is observed in
`ev_980d4d2196add1913d12995c479bbc51204121deed4319014c75db9e5bc7e297`:
16 actions/17 completed steps restore the same controlled draft URL and exact
subject/body, with a Sending undone notification. Missing events and
`equality_eligible=false` mean this does not prove provider nondelivery or reveal
its private scheduling mechanism. Earlier AI-card captures expose transient
Undo affordances but do not establish their exact duration or activation behavior.
A later original AI-card probe,
`ev_2eccab2a7f07e21e78cc40d2a8035df5d7a2c4603452053d31ee65a1bee5a4eb`,
completes 21 retained steps: card Send becomes disabled Sent with a Sending toast;
one Undo opens the same dedicated new Draft with exact controlled subject/body,
then four snapshots show native-disabled Current Draft and Sending undone.
These are UI identity/state observations, with missing events and equality false;
122/172-ms action durations are not provider timing or nondelivery proof.
The exact cutoff remains unmeasured. Live replica Undo and comparison remain
separate root-coordinated gates.

The shared contract is [`ai-draft-send-types.ts`](src/ai-draft-send-types.ts).
Chat status advertises `undo-artifact-send` under
`local-chat-preview-undo-generations-v5` after the cancelled-target generation
refinement. No model tool can cancel or send. Existing
[Send identity](AI-SEND.md) and [marker reconciliation](DELIVERY.md) remain.

## Timing and ownership

Each accepted artifact operation persists an immutable `cancellableUntil`.
Snapshots add server-computed `serverNow` and `canCancel`. The browser can display
time, but cannot authorize cancellation from its own clock. Internal
`createApp({undoWindowMs,scheduler})` allows explicit delay/clock injection; normal
runtime defaults to 10,000 ms. Delay0 is useful for explicitly scoped transport
tests and is not an implemented Instant Send UI/API. Invalid delay configuration
is rejected before opening Store.

The reusable [`delivery-delay.ts`](src/delivery-delay.ts) waits outside the shared
account queue. Its callback rechecks time, and the later delivery claim rechecks
both state and deadline inside the SQLite transaction. Strict predicates are:

- Cancel: operation queued, no attempt, `now < cancellableUntil`.
- Claim: operation queued, no attempt, valid deadline and
  `now >= cancellableUntil`.

At equality cancellation loses. A blocked account queue does not block an
in-window local cancellation; after the deadline it cannot extend that window.
An invalid deadline permits neither action. No provider/token request occurs as
part of the local cancellation transaction. Once an attempt is claimed, the
existing sending/unknown/reconcile rules apply; there is no compensating unsend.

Live owner PID/nonce fencing remains. Dead-owner recovery never enqueues old
work. Graceful shutdown stops unclaimed waits/queued jobs as `not_dispatched`,
cancels their timer handles, and waits for already claimed network work. A stale
queued callback cannot dispatch after confirmed cancellation or shutdown.

## Cancellation routes and durable receipts

| Request | Response |
| --- | --- |
| `POST /api/ai/chat/send-actions/:operationId/cancel` | `AiDraftSendCancelResponse`; scope/key/revision request below |
| `GET /api/ai/chat/send-cancellations/by-request/:clientRequestId?accountId&sessionId&turnId&operationId` | Read-only recovery of the exact immutable cancellation receipt plus current operation/restored-draft resolution |

```ts
{ accountId, sessionId, turnId, clientRequestId, expectedRevision }
```

Unknown fields, malformed keys, nonnumeric/negative revisions fail before action.
Keys share the account action namespace with Send/Create. Fingerprints bind kind,
account/session/turn/operation and the expected revision. Known-key recovery
precedes revision/deadline checks. A changed immutable request conflicts.

One `BEGIN IMMEDIATE` transaction verifies exact ownership, queued state, valid
window/revision and unchanged canonical content. It marks terminal `cancelled`,
records `cancelledAt`/`cancelledFromRevision`, releases the **same** dedicated
Draft to editable `status='draft'`, and inserts the cancellation receipt. Any
restore/receipt write failure rolls back every part. Only after commit does the
local timer abort; a racing claim is fenced by the persisted state.

Different cancellation keys after an already confirmed cancellation can converge
without a second restoration when they reference the cancelled-from or current
revision. The old Send key always returns its cancelled operation and never
requeues; a fresh Send key cannot retry that old generation. A later bounded policy
allows a NEW explicit next generation only after confirmed cancellation and
canonical disappearance of its latest target; see AI-SEND.md. Other tombstones
still block even when records disappear.

Response extends the ordinary Send snapshot:

```ts
{
  preview, creation, operation, eligibility,
  serverNow, canCancel,
  restoredResolution?, // available, unavailable or locked; exact owned draft ID.
  restoredDraft?,      // CURRENT editable content, only for available resolution.
  cancellation: {
    id, operationId, accountId, sessionId, turnId, clientRequestId, createdAt
  }
}
```

The immutable receipt does not freeze later user edits. Repeat cancel/by-key
reads return the current owned editable Draft, without reapplying preview body,
subject, recipients or timestamps. Moved/deleted targets are unavailable; sent,
scheduled or otherwise locked targets expose no editable body. Account scope is
checked in SQL before parsing draft content. Ordinary Send snapshots also carry
restored resolution after confirmed cancellation.

The draft's active artifact link is released only by that cancelled transaction.
It can then be edited, attached, discarded, explicitly provider-synced or sent
from the normal composer under ordinary permissions. Such a composer Send is a
**new human intent**, with a new delivery attempt; it does not change the old
artifact operation from cancelled. History restoration/cancel replay never sends
it. Unrelated current drafts are untouched; opening the restored target still
requires the frontend's existing autosave/navigation guard.

`409 ai_draft_send_not_cancellable` means no cancellation was committed because
the window closed, state changed, attempt exists or target cannot be restored.
It does not advance revision. Reload the server snapshot. Other immutable
revision/key conflicts use `ai_draft_send_conflict`; missing/foreign Send resources
use the existing uniform not-found shape. After uncertain transport, preserve
the cancellation key and recover by GET; do not automatically POST another key.

## Scope and gates

This phase implements Undo for the dedicated AI artifact Send path. **Normal
composer Undo is not implemented**: its existing send endpoint still dispatches
immediately. A later generic implementation needs an explicit request key,
same-current-draft restoration with provider links/attachments intact and the
same no-retry/fencing rules. The shared timing primitives prepare that work but
do not establish generic behavior. Instant Send acceleration/default preference,
hover behavior and the closed-card state after Undo remains a separate bounded comparison; the
original open card Current Draft state is observed.

Tests use explicit memory/temp option+environment paths and mocked providers.
The injected-clock cases cover exact cutoff, blocked queues, no early dispatch,
atomic rollback, receipt recovery, preserved edits, old-key no-resend, shutdown,
scoped reads and invalid configuration before database open. Passing offline
checks will be recorded at source freeze; this document alone is not live
verification, provider nondelivery proof or full parity.

The 2026-10-28 offline source checkpoint passes **317/317** API tests and strict
TypeScript checks: eleven core Undo cases, eight independently owned Undo
adversarial cases, and all existing Send/Gmail/Calendar/chat regressions. The
bounded independent review found no remaining actionable gap in its tested
receipt, deadline, rollback, owner, scope and restoration invariants. Final output
is `.local/audits/ai-undo-api-suite-20261028.log`; exact changed-file and baseline
hashes are `.local/audits/ai-undo-api-source-freeze-20261028.json`. No live
provider/model/database access or server restart occurred in these checks.
This is not live replica verification, exact original timing or normal composer
Undo parity.


A later original manual timing probe,
`ev_85ee54155830444d65ebc2c7ec2860a976e3ed0ce640377b0a606341febe6efc`,
completes 52 steps with one approved-pair Send and no Undo/Instant Send/declared
hover. Retained DOM presence and elapsed/capture timing give a conservative
10.069..11.445s notification-retention bracket from Send action start (sample 20
start through first absence with 332ms unattributed overhead). The earlier 10.591s
lower derivation used an end-of-step time and is superseded. This is passive DOM
presence, not computed visibility or clickability; exit animation can affect it.
These times include capture, not private network timing. The 10s deadline from
local durable acceptance stays a reconstruction policy consistent with one flow,
without claiming the original dispatch/cancellation cutoff or hover units.
