# Automatic Gmail persistence for newly replica-owned drafts

This private candidate builds on root456 and adds automatic cloud draft saves
only to drafts newly created through the replica after this implementation is
installed. Existing/legacy draft JSON and attachments are not enrolled, scanned
for upload, backfilled or automatically deleted. Imported Gmail draft editing
remains a separate gap. No live provider call, user draft or key was used during
implementation; all checks use synthetic memory/temp stores and fake Gmail.

Original evidence is documented in `research/provider-drafts.md` (PD-01–10).
One newly owned recipient-free original draft appeared and changed in Gmail
Drafts, then stopped matching the scoped query after discard. The runtime edit
replacement assertion failed and remains recorded. Gmail draft resource IDs,
private backend writer, conditional-write behavior and exact provider delay were
not recovered. Static client userdata/throttling is separate from our public API
implementation. None of these checks establishes full autosave or cross-device
parity.

## Ownership and persistence

An internal creation-origin call enrolls only a new replica composer, reply,
forward, AI Create Draft or newly allocated AI Send draft in the same SQLite
transaction as creation. Legacy edits, imports, startup, listing and explicit
legacy sync do not enroll. AI Send's dedicated draft starts suspended, preventing
a redundant cloud save; confirmed Undo restores that same ID and enables ordinary
owned autosave. Blank opening performs no provider write. Meaningful structural
rich content is retained even if its plain fallback is empty.

Local edits commit first. A1000ms injected coalescing timer is a local policy
informed by static throttle evidence, not measured Gmail durability latency. The
timer waits outside the shared account queue. Only undispatched work coalesces.
Ownership, exact current draft revision/hash, account and delivery locks are
rechecked before a durable provider claim. Each claimed write persists its exact
MIME BLOB before network, including attachment bytes/hashes. Removing an attachment
or editing later cannot invalidate issued bytes. One operation per draft can be
in flight; another live owner cannot steal it. Proven dead-owner issued work
becomes unknown without replay. Startup can resume queued work only for already
enrolled drafts, never manufacture work for legacy drafts. Indexed metadata
refill selects at most100 pending owned rows and refills after work settles,
so a101st pending draft is not stranded. Default standalone service instances
also serialize account work. Older preflight failures cannot block a newer
corrected revision; only the matching synchronization revision accepts an error.

Draft content identities include authored headers, body/HTML, frozen reply
context and attachment bytes. Initial reply context is scoped and frozen at
creation; incoming mail cannot silently change the hash at the same authored
revision. Earlier revisions and same-revision/different-hash writes are rejected.
ACKs attach verified provider metadata to the current local draft without
replacing its authored fields/revision. An ACK synchronizes its own snapshot only;
a newer authored revision remains queued. Identical canonical content with only
revision churn promotes the synchronized revision without another PUT.

Provider draft container ID, changing provider message ID, thread ID, local ID,
authored revision and synchronization revision are separate identities. Once
known, the provider draft ID never clears or changes for that ownership lifetime,
including terminal states. The local database retains operation metadata/digests.
Obsolete confirmed MIME BLOBs are released after a successor ACK; active/unknown
snapshots and the last synchronized snapshot needed for conflict/deletion proof
are retained. Pending data is not discarded merely because the browser closes.

## Provider and MIME protocol

The [Google draft guide](https://developers.google.com/workspace/gmail/api/guides/drafts)
and [resource contract](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts)
describe a stable draft container with replaced message IDs. The candidate uses
public drafts.create/update/get/delete. It does not call vendor private userdata.
Recipient-free MIME is supported; malformed outgoing fragments stay local and
block cloud MIME creation rather than being dropped. Invalid UTF-16 surrogate
fragments are retained locally and rejected before cloud MIME/owned delivery
claim instead of being silently replaced during UTF-8 encoding; valid emoji
and other Unicode remain supported.

The exact installed `postal-mime`4.1.4 parser is pinned (MIT-0, zero runtime
dependencies; official [repository](https://github.com/postalsys/postal-mime) and
[documentation](https://postal-mime.postalsys.com/docs/)). It decodes transfer
encoding, encoded words, recipients and attachment bytes. Proof compares both
saved and provider MIME through the same bounded parser: header multiplicity,
From/To/Cc/Bcc, subject, reply references, plain/HTML and ordered attachment
metadata/bytes. It normalizes CRLF transport endings and header folding only;
it does not trim body whitespace, rewrite HTML or accept marker headers as body
proof. Raw MIME is capped38MiB, attachment totals25MiB/20files, MIME nesting12,
parts64 and headers64KiB. These are local resource policies.

Cloud-save MIME carries an opaque ownership marker, operation ID, revision and
content hash. This is a local proof protocol, not an observed original header
scheme or a live-verified Gmail preservation guarantee. RFC Message-ID is not an
idempotency key. A valid fresh account profile is checked before provider work.
Known-ID writes first compare the expected immutable provider message identity.
Observed remote changes pause work and preserve local content.

The [update API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/update)
exposes no documented draft ETag/precondition in the checked contract. A
GET-before-PUT/DELETE cannot provide cross-client CAS: an external Gmail editor
can race the later request. That limitation remains explicit. No write is
implicitly retried or replaced on missing/changed targets.

## Read status, check and action contracts

Types are browser-safe in `src/provider-draft-types.ts`. Exact selected status is
`{providerDraft:ProviderDraftSnapshot}` with account/draft ownership, monotonic
synchronization revision, desired/synced authored revision/hash, actual provider
IDs, current operation metadata, error and `deliveryBlocked`. Bodies, raw MIME,
attachment bytes, credentials and ownership nonces are not returned.

- Unmanaged: revision0, state unmanaged, null tracking fields/operation/error;
  existing legacy mapping remains only in its existing Draft representation.
- New managed blank: idle, desired revision/hash pair, no operation/mapping and
  no remote request. Pure initial enrollment before its first note has null/null.
- Synced requires a confirmed create/update operation with nonnull result and
  matching-snapshot resolution; actual IDs match that result and desired/synced
  hash/revision match. An older operation revision is allowed only for identical
  content promotion. Saving/unknown/failed/null-result cannot claim Synced.
- Queued can be atomically suspended by a new explicit delivery intent before
  claim. Idle/queued/synced do not themselves block delivery. Every other managed
  state blocks it; existing delivery policy/recipient checks still apply.

Operation prewrite IDs, kind, source revision/hash and creation time are immutable.
A verified result is assigned once and cannot change. Snapshot actual message/
thread IDs can advance with a later verified operation; container ID stays fixed.

| Method/path | Input | Output/effect |
| --- | --- | --- |
| GET `/api/drafts/:id/provider` | one explicit `accountId` query | Status only; no provider call or retry. |
| POST `/api/drafts/:id/provider/reconcile` | `{accountId,expectedSyncRevision}` | Status plus verification; GET-only upstream read phase. |
| POST `/api/drafts/:id/discard-operations` | `{accountId,clientRequestId,expectedDraftRevision,expectedContentHash,expectedSyncRevision}` | `202` accepted/`200` exact-key replay, immutable receipt and current resolution. |
| GET `/api/draft-discard-operations/by-request/:key` | explicit `accountId,draftId` | Historical receipt/current resolution; no retry, delete, upload or retarget. |

Draft create/PATCH ACKs add `providerDraft`; selected GET also retains
`deliveryPending`. Reply ACK adds `providerDraft`. Attachment POST returns
`{draft,attachment,providerDraft}`, DELETE `{draft,providerDraft}`. Lists/bootstrap
are unchanged. Every new managed Draft has authored revision>=1. Its local ACK
is not an immediate cloud durability ACK. Legacy Draft revisions can be absent.
Managed explicit `/drafts/:id/sync` delegates to this ledger; direct one-off sync
cannot bypass it. The unchanged legacy explicit route does not gain automatic
jobs or imported-draft editing.

Errors use the existing `{error:{code,message}}` envelope.400 invalid request;
404 not found;409 revision/request conflict, busy, unknown, remote conflict,
locked, scope changed or deletion-requires-action;413 snapshot limit;503 not
configured/stopping;403 missing draft-write scope;500 corrupt metadata. Exact
codes have the `provider_draft_` prefix. Existing delivery/refusal codes keep
precedence. A malformed500/transport result remains uncertain; never invent a
new action key or automatically retry a mutating request.

## Ambiguity and reconciliation

An issued create/PUT with missing/invalid ACK, interruption, abort or local ACK
commit failure becomes unknown. Local typing is retained, but further provider
writes, delivery and destructive execution stay locked. Read-only checking uses
a fresh same-account profile. Unknown create scans at most2×25 draft candidates,
requests only bounded selected metadata first, then verifies the unique exact
marker candidate against decoded saved MIME. Incomplete/zero/duplicate scans,
missing markers, transformed content or provider errors remain unresolved. A
zero result/404 without a known mapping never proves no create happened.

A positive proof confirms the original operation. The response remains bound to
that operation and truthfully distinguishes desired from synchronized revision.
If a distinct newer revision was authored meanwhile, a NEW operation can resume
later through the ordinary debounce/queue. The reconcile request itself performs
only GETs upstream and never redispatches the old write. Same-content churn needs
no PUT. Send/Undo/discard/shutdown fences still govern the successor.

## Explicit discard and delivery integration

An accepted keyed discard binds one owned local lifetime and exact local/sync
revision/hash. It freezes edits, retains bytes while pending, and waits for any
already-issued create/update outcome. Its receipt's planned delete operation ID
is stable; the current operation can remain the preceding save until ownership
is resolved. Once deletion is claimed/completed, it becomes that planned ID and
never advances again for the discarded draft. Receipt replay cannot resurrect or
select a newer draft/generation.

Before a mapped deletion, fresh account/ID/message and decoded snapshot proof
must still match. A changed remote target is preserved as a conflict. A known
owned target already unavailable can settle the explicit discard without another
DELETE; an unknown DELETE can likewise settle from a fresh exact-ID404 while its
historical issued outcome remains unknown. Absence does not prove DELETE execution
or authorize another create/delete. The [delete API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/delete)
is permanent; this operation is restricted to the newly owned target, not legacy
user drafts. Local data removal and receipt/mapping completion are atomic.
Terminal `discarded` versus `unavailable` resolution never switches later.

HTTP keyless managed DELETE is refused. Trusted internal cleanup retains existing
artifact-generation behavior only for a purely local draft with no mapping and
no issued operation ever: the record removal and local-only tombstone atomically
fence queued timers/claims. Rollback retains both draft and pending work. This
exception performs no provider request and cannot apply to unknown/mapped work.

Store lifecycle hooks compose with both durable delivery hooks. Send/Schedule
refuses active/unknown/conflicted cloud work; acceptance suspends only unclaimed
saves before freezing local revision/content/link. A fresh mapped-target check
precedes claim. Native send uses BOTH stable draft ID and immutable replacement
raw MIME in one drafts.send request; successful send consumes the remote draft.
There is no separate DELETE and no messages.send fallback on a missing/unknown
mapped draft. Interrupted delivery retains the existing marker reconciliation and
no-resend lineage. Consumed drafts cannot be recreated by late autosave callbacks.
Confirmed Undo restores the SAME local draft, attachment bytes and mapping, and
releases only its exact cancelled delivery lock. Identical saved content promotes
without a redundant cloud PUT; a dedicated AI Send draft that had no cloud write
can begin normal owned autosave only after Undo.

Imported draft editing, remote concurrent merges, complete cross-device behavior,
original retry/delay rules and live marker/normalization fidelity remain open.

## Controlled provider-only runtime seam

`createApp` accepts a trusted Node option `providerDraftAutomatic` (boolean,
default follows `runJobs`). For an isolated provider-only lifecycle, use an
explicit temporary database and matching `env.DATABASE_PATH`, `seed:false`,
`runJobs:false`, `providerDraftAutomatic:true`, and an injected scheduler that
holds callbacks until the parent-owned durable plan permits each phase. No
mailbox sync, Calendar, Knowledge resume or AI index jobs are enabled by that
autosave-only override. Seed only the validated account, existing MAIL grant
and sealed MAIL secret into that empty isolated App. No user draft is copied.

Omit `providerDraftTransport` for native public Gmail operations; supply it only
for explicit synthetic tests. A guarded `app.google.fetcher` set before draft
creation intercepts both Gmail calls and any OAuth refresh. A live harness must
refuse unapproved endpoints/refresh or stale credentials, never use them as a
reason for an automatic mutating retry. New-owned status, automatic timers,
reconciliation and keyed discard use the same service/routes as the product.
This is a controlled harness seam, not automatic authorization to perform a
live lifecycle or to claim provider fidelity from offline results.
