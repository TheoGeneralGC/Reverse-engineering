# Explicit Instant Send: private implementation candidate

The original observed flow is REA
`ev_f26f3709c54678ca8d97923f1720c85d55e98c3b8f9948d445e88714af56aa95`:
31 completed steps, one owned synthetic Send and one Instant Send activation.
The notification becomes “Send accelerated!” and loses its action controls.
Missing event coverage and equality ineligibility remain. The root investigator
separately observed one sender/peer receipt pair; exact provider cutoff and
original queue semantics remain unknown. This candidate is a local design and
has not been applied or tested against a live mailbox.

## Common explicit control

`POST /api/delivery-accelerations` accepts the strict browser-safe union in
`src/delivery-control-types.ts`:

```ts
{
  source: 'artifact' | 'composer';
  accountId: string;
  operationId: string;
  clientRequestId: string;
  expectedRevision: number;
  // Artifact source additionally requires sessionId and turnId.
}
```

Composer requests reject artifact session/turn fields. An accepted new control
returns201; an exact key replay returns200:

```ts
{
  source: 'artifact' | 'composer';
  snapshot: AiDraftSendSnapshot | DraftSendSnapshot;
  acceleration: {
    id: string; source: 'artifact' | 'composer';
    accountId: string; operationId: string; clientRequestId: string;
    createdAt: string; priorRevision: number;
    originalDeadlineAt: string; effectiveDeadlineAt: string;
  };
}
```

Recover only through
`GET /api/delivery-accelerations/by-request/:key?source&accountId&operationId`
(and matching sessionId/turnId for artifact). Recovery always selects the same
historical operation. It never creates another intent, selects a newer draft,
restores content, or dispatches again. A missing receipt after uncertain transport
is not proof that the prior request did not arrive.

The account-scoped key namespace includes Create, AI/composer Send, their Cancel
controls and acceleration. A key reused for a different request conflicts. Exact
historical replay is checked before current revision/state requirements.

## Atomic deadline and single attempt

Only an owned queued immediate Send, still within its preclaim Undo window and
with no attempt, may accelerate. Schedules, unknown/sent/sending/cancelled/stopped
operations, another live owner's queue, and expired windows fail. Account/source
scope and immutable draft content/grants/approved recipients are checked before
any transition. No provider write is made by the control transaction.

Receipt insertion and effective deadline update commit together. The operation
keeps `originalCancellableUntil` for audit and adds `accelerationId` and
`acceleratedAt`; current `cancellableUntil` becomes server now and revision
increments. This closes Undo, not the delivery outcome. Queued/sending remains
queued/sending until the existing provider ACK transaction confirms sent.

After commit, the original waiter re-reads its durable deadline. A wake is distinct
from cancellation/shutdown and does not convert the operation to not-dispatched.
Waiting remains outside the account queue. If no waiter exists yet, the accepted
HTTP control starts the same owned operation; the active map and atomic Store
claim allow only one delivery attempt. Key replay does neither action. The
original opaque marker and unknown reconciliation path remain in use, with no
provider retry or alternate send path.

Cancel and acceleration race under the same SQLite write lock. If Cancel wins,
acceleration cannot revive it. If acceleration wins, its effective cutoff and
revision prevent a stale Cancel from restoring a draft. If claim wins, neither
control can become a compensating unsend. Shutdown stops pending immediate work,
including accelerated work; nothing autoqueues after interruption.

## Boundaries and release conditions

The separate retained354 candidate has a known standalone scheduled-service
shutdown race. This downstream copy adds the final claim closing fence; the
independent scheduling regression passes here and remains red on the retained
354 source. It does not alter the retained archive.

No Instant Send parity is claimed beyond these scoped local rules. There is no
hover-paused timer, direct model action tool, external provider test, live source
rollout, or root API edit in this private candidate. Frontend journal/recovery and
native notification comparison remain separate gates. All active API writers
must be upgraded together before sharing the new action-key ledger semantics.

## Offline source checkpoint

The final private candidate passed375/375 API checks and strict NodeNext types:
the325 baseline, thirteen composer core cases, nine independent composer cases,
seven schedule core cases, eight independent schedule cases, five acceleration
core cases and eight independent acceleration cases. The independent scope/mode,
rollback, cancellation, owner, shutdown and unknown-outcome review found no
remaining actionable blocker in its bounded scope. Both earlier independent RED
cases remain retained separately; the retained354 source was not rewritten.
No live message, provider/model call, root source apply or server restart occurred.
