# Private durable reminder foundation

This is an experimental storage slice. The standard CLI is unchanged. A factory
may explicitly install `reminderFoundation`, whose default trusted source
resolver returns unavailable. Every browser capability is false, and valid action
POSTs return 409 `reminder_unavailable` before acceptance. No native due worker,
Archive effect, provider observation, returned occurrence or Follow-ups consumer
is installed. It is not ready for a reminder UI or Main rollout.

`src/reminder-contract.ts` is the single browser-safe typed/runtime contract.
It defines schedule/cancel/Undo/check-return requests, views, immutable receipts,
recovery and errors. Clone-first parsers capture both payload and trusted caller
context before an awaited digest. Current routes are:

- GET `/api/threads/:threadId/reminder?accountId=…`
- POST `/api/reminder-actions` (unavailable in this slice)
- GET `/api/reminder-actions/by-request/:key?accountId=…&accountVersion=…`

Views and receipt GETs never allocate refs, adopt accounts, repair state, wake,
read a provider or dispatch a model. Default createApp behavior and legacy wire
shapes remain unchanged. The private factory option does not enable a dispatcher.

## Original evidence and design boundary

The retained original runtime evidence is the owned-row Remind Me popover and
its read-only condition dropdown: `ev_92b1343e6a5408ad7993a07d540e93e99d95105e97c4bc94e1f0d8c789791d4c`
and `ev_38c7f0740f4a2beaa6b13e8dee00ba669200f75e057592d7bf2e7114be51f94c`.
The target was build db8c4288f33febf25ad9, full artifact SHA
`c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`.
The observed selected condition belongs to that account/context, not a proven
universal default. Wire `always` displays as the observed label “regardless”.

Static constants map Someday to 4e12 ms and Never to 5e12 ms. The canonical
contract preserves explicit `triggerKind: at|someday|never`; special kinds require
exact ISO `2096-10-02T07:06:40.000Z` / `2128-06-11T08:53:20.000Z`. Neither is
null or cancellation. Selecting a preset/condition or committing a reminder was
not part of our original inspection. Static `markDone:true` is an Archive intent;
provider Archive/return ACK and timing remain unobserved. Internal acceptance
here changes only the local reminder date, with no folder or provider mutation.

## Storage and internal acceptance

The synchronous `ReminderService` repository accepts intents for isolated tests
and future native integration. It uses seven reminder tables: slots, immutable
instances, keyed requests, wake-attempt reservation, events, returned reservation,
and outbox reservation. There is no method that publishes a return or outbox item
from time, cached labels, row absence or a void provider method.

The account/incarnation authority reuses the existing readiness account/event
tables and the same three account lifecycle trigger names. It has no model,
profile, grant or credential dependency. Existing accounts require explicit
adoption; GET cannot perform it. Meaningful account identity changes and
same-ID delete/re-add change the incarnation. Display/sync metadata does not.

Keys are unique across an account incarnation, including different thread
intents. Existing receipt proof is verified before definite key conflict.
Acceptance checks current account/thread scope, revision/ref, source/anchor
context and fresh clock in one savepoint. The trusted context must independently
establish completeness/freshness, message set, provider mapping and optional
complete self-address identity. Cached Thread alone is insufficient. Model input
or client JSON cannot select this authority.

Slots are anchored to an append-only event chain. Events bind prior/next
snapshots, scope, time/revision chronology and independently stored immutable
instance/anchor digests. Requests bind their exact accepted event. This detects
scoped partial-row contradictions; it does not defend against rewriting the
entire database and every commitment. Historical recovery returns the original
snapshot after newer actions, not a substituted current state.

Undo has the existing five-minute compatibility window. Cancel/resnooze Undo
creates a new UUID/generation with the prior source anchor/time, including an
otherwise overdue time; it never reopens an old wake attempt. Undo-create cancels.
An initial canonical schedule replacing a keyless legacy date privately captures
its exact prior date/retry/error fields, account incarnation and version hash.
Undo cancels the new canonical reminder and restores only that legacy footprint
on the current Thread. Its source event/hash is retained as legacy provenance.
It does not create an adopted canonical generation, return, outbox or model source.
The exact accepted after-projection, revision/ref, token and expiry must still
match; a newer canonical/legacy mutation cannot be overwritten. Terminal instances and prior event snapshots remain retained.

## Store composition and restart

Thread/account put/remove hooks run inside the Store savepoint. They compose
with the existing contact/split/provider/Auto Draft hooks. A later write/hook
failure rolls the reminder event and source record back together. Committed
legacy reminder-affecting actions fence the current canonical generation and
link the legacy Undo ID. An exact linked Undo may restore a fresh reminder;
unlinked or stale Undo cannot overwrite newer canonical state. Read/star/label
and ordinary sync metadata do not re-anchor the reminder.

Owned canonical projections are excluded from legacy GET-triggered wake. If a
Store is reopened or the reminder authority is closed, canonical scopes remain
fenced: no legacy wake or reminder-affecting mutation can silently take over.
On account replacement, the exact old canonical date projection is cleared
inside the account savepoint. Mismatched date fields are quarantined by an
event commitment and stay excluded from legacy wake across incarnation changes,
close and restart. Only an actual trusted reminder action can replace that quarantine; generic
Thread.put cannot transfer ownership, even if a copied date/retry field changes.
An explicit legacy snooze, including one with identical date bytes, is identified through the server-internal
prepareAction→commitAction object context; client JSON cannot select this lane.
A genuinely newer legacy same-byte/date-ABA intent is preserved. Read/star/sync
metadata cannot release a quarantine. Quarantined dates are not exposed as
legacy in the view.

Unowned historical reminders/Undo keep their existing path, including before
account adoption. Raw SQL outside the actual Store API is not a complete writer
integration claim.

The old provider-await-before-legacy-commit path is not a new canonical native
issue protocol. The next slice must add the durable native claim/issue/unknown
lane, fresh credentials/grant/context checks after awaited preparation, positive
exact-thread INBOX observation, atomic return/outbox publication, and close/
restart/late-ACK fencing. Existing `google.updateThread():void` is insufficient
proof. No model wait belongs inside SQL or the provider account queue.

## Verification

39 inherited reminder controls plus eight new Store/HTTP Undo-concurrency
controls and 29 affected legacy controls pass together (76). Two existing
backend Undo purposes pass separately. All seven unchanged outside probes
(six scoped reminder controls plus the standalone lost-update probe) pass
through an import-only redirect. The earlier V2
51 affected checks remain historical; the full884 was not rerun. The shared
contract is byte-exact to H1, whose eight outside parser controls/review remain
bound to that exact source. All API source/test type checks and
browser types[] contract checks pass. Tests use explicit memory/temp databases,
matching App env when supplied, jobs/provider automatic off and network denial
preloaded before imports. There are no sockets, real credentials, external
calls, Main reads, provider writes or model dispatches in these controls.

The full inherited 884 suite was not rerun. Full native delivery, due/return,
original timed comparison, UI focus/navigation and Follow-ups parity are not
claimed. Three pure parser REDs and early owner setup/Undo scope failures remain
retained privately, with the unchanged parser tests now passing.

The new Root-owned timed original test additionally observed a reminder service
email, not just Inbox restoration. Its triggered-reminder source/last-message
headers require a separately reviewed native/system-trigger contract before
full behavior comparison. This V2 does not implement mail injection, vendor
sender spoofing, a native adapter or positive return publication.

## V4 ordinary Undo concurrency correction

Store.commitUndo no longer commits a previously prepared whole Thread. It
recomputes pendingUndo inside the actual write transaction, validating the
stored before/after receipt scope and current/caller account/thread identity.
The original operation's affected fields and label membership differences must
still match their accepted after-projection. Only that delta is restored on the
latest record. Semantic reminder ownership is rechecked inside the same unit,
then its hook may allocate the fresh reminder identity before the fresh merged
Thread/Undo deletion commit together.

A concurrent read/star, unrelated provider label, new message or sync metadata
is preserved, and the later read Undo remains usable. A competing related folder
or changed-label projection, newer reminder, expired receipt or moved account
refuses without writes. A failure rolls the fresh identity and Undo deletion
back together. The HTTP response contains the actual merged committed Thread.
No server/native request, schema or wire DTO changes are made by this fix.

This remains field-wise CAS for ordinary keyless Undo, not a new monotonic
per-field authoring ledger. An ordinary field changing away and back to exactly
the same bytes is not a new demonstrated guarantee; canonical reminder ABA uses
its existing independently committed semantic revision/identity. Native provider
issue/ACK concurrency is a separate lane, not proved by a fake awaited callback.
