# Keyed Trash backend — private implementation boundary

This separate Trash receipt and inverse protocol is being composed with the
current hosted browser source. Historical741 integration and one approved
Original/isolated reconstruction pair support their bounded functional scopes;
they do not prove this successor's hosted migration, finite motion or full parity.
The current release's own validation and deployment records remain separate.
Archive wire DTOs and the v1 client journal are unchanged. No new Reminder owner,
provider permission or background recovery work is activated.

## Routes and recovery

- `POST /api/threads/:id/trash-actions`: exact object
  `{version:1, action:'trash', accountId, accountVersion,
  expectedSourceVersion, clientRequestId}`.
- `GET /api/threads/:id/trash-action-operations/:key` with exactly one
  `accountId` and `accountVersion` query value.
- `POST /api/threads/:id/trash-action-operations/:key/undo`: exact object
  `{version:1, accountId, accountVersion, clientRequestId}`.

POST input is limited to 8192 bytes, strict UTF-8 JSON, with duplicate keys and
additional properties rejected. Scope versions are lowercase 64-hex; keys are
canonical lowercase UUIDv4. A key binds the complete immutable tuple. Forward
and inverse fingerprints use distinct namespaced versioned objects. Each
accepted forward has at most one immutable inverse key. Tuple conflicts return
409. Missing status returns 404; this does not authorize a fresh intent/key.
There is no fallback to the ordinary legacy actions route.

`TrashEnvelope` has version1, `scopeCurrent`, an optional current scoped Thread,
a Trash receipt, and a separate nullable inverse status. Public states are
pending/confirmed/unknown/refused. Native evidence independently reports mode,
possible issue, durable known acknowledgment and verified effect. The receipt
also exposes its ordinary Undo ID and whether it retains a lock. A past account
incarnation never returns the replacement Thread. Status and exact-key replay
allocate no IDs, write no rows and invoke no provider; POST never resumes work.
A recovered accepted/prepared record stays pending and locked, while a recovered
issued record exposes unknown. No constructor dispatch or automatic cleanup is
present. HTTP returns202 only for pending, otherwise200 for a saved outcome.

A valid, positively present but expired ordinary Undo saves a refused inverse
key and returns200. A missing underlying Undo is unavailable409 before creating an
inverse. Unavailable forward history/current account incarnation also returns409.
Accepted inverse history takes precedence over current incarnation checks. The
first-inverse scope/footprint/expiry/eligibility/key decision is one synchronous
SQL transaction. A positively expired row wins over a new Draft busy condition;
clock crossing is rechecked in that same transaction without a native wait. The original Undo's
thread/before/after bytes are hash-bound by the Trash record; a changed footprint
is not silently adopted. The ordinary five-minute expiry remains independent
of that field-delta proof.

## Storage and native transitions

One `trash_action_operations` table plus a thread index stores scope columns,
per-account sequence, revision, original/inverse keys, canonical JSON and SHA256.
Its composite key and unique sequence/inverse indexes are separate from Archive.
DDL runs in a savepoint. New rows do not adopt legacy actions or drafts. Every
load cross-checks scalar scope/revision/sequence, fingerprints and evidence
coherence. Every update checks the old validated record, then CASes its integrity
and revision. Prepared plans, issue times, acknowledgments, observations and
request/base bindings cannot be replaced or erased by later updates.

Local Trash, ordinary Undo and receipt acceptance share `Store.commitAction`'s
transaction with a fresh current source/identity/grant/eligibility check. The
prepared Google label plan is persisted before native issue. The issued marker
is committed immediately before the sole modify invocation. ACK is saved before
a subsequent source/Stop check. Exact effect readback and confirmation share a
final short transaction. The internal record represents ACK/effect progress as
append-only evidence on its issued stage; it does not expose a second resumable
ack-known/effect-verified dispatcher.

Definite preissue refusal attempts only the owned fieldwise ordinary Undo. It
retains concurrent unrelated metadata. A conflicting local/Undo/source footprint
retains the Undo and a locked `trash_local_conflict`. After possible issue, any
failure remains unknown and locked, retaining any known ACK. It never sends an
inverse as cleanup. Failure of storage/CAS refuses further mutation; it does not
repair corrupted/newer rows. There is no claimed Gmail concurrency CAS: changes
outside this app can race between exact observation and modify.

Demo uses local confirmation/inverse without any provider. Google uses a
separate MAIL adapter, not generic `updateThread` or Reminder transport:

1. Profile and FULL before Trash; verify current owned identity, exact cached
   normalized source/message set and complete per-message labels.
2. One threads.modify adding TRASH and removing INBOX only if uniformly present.
3. FULL readback verifying every expected label set and unchanged source.
4. At delayed Undo, a **fresh** FULL observation; optional sixth GET refreshes the
   profile only if the sealed token/incarnation changed or identity is older than
   60 seconds. The earlier post-Trash observation is never reused for issue.
5. One inverse modify for the owned delta and FULL readback. New unowned labels
   observed immediately before Undo are preserved.

This is normally5GET/2modify for the full pair, capped by the fixed call graph at
6/2. Each native transport has a20s abort/race/body bound, each live forward or
inverse a60s deadline. FULL is capped4MiB/50 messages, ACK/profile256KiB. Redirects,
missing bodies, DRAFT, nonuniform relevant memberships, source drift, unsupported
labels/identities and invalid ACKs refuse or remain unknown according to issue.
There are no HTTP retries, list/history/contact/attachment fetches, Send, Draft,
Calendar, label-creation or collector calls in this adapter. Existing Google
quota pacing is reused through a quota-only helper with no transport authority.
Tokens use the existing MAIL refresh path. Captured current account incarnation,
semantic grant mutation epoch and in-memory sealed credential equality are
rechecked after waits. No credential bytes enter the Trash ledger.

Google documents that TRASH is manually applicable and threads.modify affects
existing messages, while later messages do not inherit thread labels. These
support the exact delta, not atomic cross-client concurrency guarantees:
[labels](https://developers.google.com/workspace/gmail/api/guides/labels) and
[threads.modify](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/modify).

## Shared boundaries and truthful sync

The existing account OperationQueue is shared by Archive, Trash and owned cloud
work. Persisted Archive locks are consulted by Trash; Trash locks are consulted
by Archive, provider-facing legacy actions/Undo and Store mutation frontiers.
Archive DTOs, parser, journal and prior reason semantics remain intact. Every
Trash-owned ordinary Undo ID requires its specific integrity-bound inverse or
rollback permit, including settled history; legacy Undo cannot consume it.

Trash repeats its current same-thread Draft/cloud/Send/generation predicate at
acceptance, preparation, issue, confirmation, inverse and rollback. Reciprocal
Store Draft creation/conditional claim, generated admission/publication, cloud
enrollment/claim/publication and delivery/native checks prevent the Draft race.
Owner Thread permits never grant Draft/generation authority. Unrelated drafts
and mail remain usable. Positively validated Sent/consumed history may remain;
late positive settlement/unknown preservation is allowed without reactivation.
The predicate is read-only and uses constructor-free facades limited to existing
repository/foundation read validators, with zero-write tests. Associated old
not_issued Delivery records conservatively refuse. This is a bounded historical
eligibility policy, not a universal lifecycle migration.

A locked target must not starve account history sync. Google alone receives a
one-use producer permit for an exact canonical Thread payload/removal. It is
consumed before callbacks and has no ambient asynchronous context. Genuine
provider observations may advance the Thread source and pending/history proofs;
they do not settle the Trash record or grant Draft, cloud, Send or mutation
permission. A stale Trash continuation then refuses before issue or stays
unknown after issue. A source already restored to the old placement can make
owned rollback conflict; it remains locked rather than overwriting the newer
canonical row. The synthetic regression completes locked T then unrelated U
through actual Google pending checkpoints while preserving the unknown ledger.

Reminder schedule/change/cancel/Undo admission and native prepared/issued
frontiers also compose the shared conflict check. TrashV1 rejects any selected
Reminder slot/history or legacy snooze. Existing native capability and optional
mounting remain unchanged. No common transport or permission is introduced.
