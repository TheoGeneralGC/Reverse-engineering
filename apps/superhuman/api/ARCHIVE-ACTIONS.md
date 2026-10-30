# Optional keyed Archive and Undo candidate

This is a private implementation/design contract. Owner offline controls pass;
independent peer, merged broad gate, UI physical evidence and comparison of rapid
Done against the original remain pending. No feature is marked verified and no
Main/mail/provider/model/browser action occurred during preparation.

The ordinary action path is separate from Reply FULL/header authority and native
Reminder transport. E can reserve/remove/advance in the browser synchronously
using metadata already delivered in mailbox responses; no context GET, hydration
or extra user step is part of accepting an Archive request.

## Wire

Bootstrap includes `archiveAccountVersions: Record<accountId,64hex|null>`, even
with includeThreads=false or an empty mailbox. Bootstrap/list/summary/full/hydrate
Threads include `archiveBasis:{version:1,accountVersion:64hex,sourceVersion:64hex}|null`.
Wire lookup reads indexed metadata heads and the existing shared identity only;
it does not deserialize full Thread bodies or allocate/adopt authority. Missing
or invalid authority/MAIL permission produces null. A replacement account under
the same ID changes its version, including empty-mailbox UI scopes.

POST `/api/threads/:threadId/actions` may use this exact optional keyed body:
`{action:'archive',accountId,accountVersion,expectedSourceVersion,clientRequestId}`.
IDs are explicit, versions64hex and clientRequestId UUIDv4. Legacy unkeyed inputs
and their successful response shapes remain unchanged.

Keyed response:
`{thread?,undoId:string|null,receipt:{version:1,clientRequestId,accountId,accountVersion,threadId,action:'archive',state,undoId,reason:string|null},undo:null|{version:1,clientRequestId,state,reason}}`.
Public state is pending/confirmed/unknown/refused. Thread is included only when
its current account incarnation matches the request. It carries current basis.
Receipt refusal is explicit scoped zero-native-issue for that operation, even
when a concurrent change prevents safe local rollback. In that case reason is
archive_refused_local_conflict and the retained local Undo remains locked; the
client must not transplant an old row into newer/account-replaced context.

GET `/api/threads/:threadId/action-operations/:archiveRequestId?accountId=...&accountVersion=...`
returns only exact saved status/current scoped Thread. It never executes native
work, allocates IDs, repairs heads, or replays an accepted/issued operation.
Known pending can return202; other receipt states200. GET404 cannot authorize
another POST: the original request could still be entering the account queue.
Repeated exact POST returns its existing receipt without replay; a changed tuple
under that key is409 archive_key_conflict, not proof of native absence.

POST `/api/threads/:threadId/action-operations/:archiveRequestId/undo` takes exactly
`{accountId,accountVersion,clientRequestId:undoUUID}` and returns the same envelope
with scoped undo status. It requires the original confirmed receipt/linked UndoID.
The original and Undo each have one irreversible native issue boundary. Duplicate
exact Undo/status GET never reissues. Newly keyed-owned UndoIDs cannot bypass this
ledger through legacy `/api/undo`; old unkeyed Undo behavior/shape stays intact.
Malformed/key-conflict/corruption/stopping/unavailable errors are ordinary error
envelopes. A client cannot infer native absence merely from generic HTTP400/409.

## Acceptance, issue and concurrency

All work joins the existing per-account OperationQueue, including Undo and legacy
provider-facing actions. The browser can still reserve many distinct targets
before any network response. Accounts remain independent. The keyed request,
fingerprint, selected target, local Archive and linked ordinary Undo row commit
in one Store transaction. Inside that transaction the actual account/source/grant
fences repeat and Archive is re-prepared against the current Thread. Late read/
star/display metadata therefore survives; a true changed source refuses.

The model-independent source head changes on actual message IDs/author/date/RFC/
body/attachment changes, placement folder/Inbox/Trash/Spam or legacy reminder date
fields. It ignores read/star, unrelated labels, contact/display names, snippet,
tracking/presentation/header-cache renewal. A bounded monotonic epoch plus fresh
nonce changes sourceVersion, including source/folder delete-reinsert ABA. Initial
heads are seeded only when this schema is first installed, never repaired by GET
or subsequent construction. Acceptance/native gates verify the stored semantic
facts against the actual Thread, rather than trusting caller versions alone.

Receipt writes use an integrity-hash CAS so another owner cannot overwrite a
newer pending/issued/ACK state. Native Archive removes onlyINBOX; Undo adds/removes
only the inverse own INBOX delta. Demo/no-membership-change paths are local and
confirmed without provider calls. Native issue is persisted immediately before
fetch; an outer transport invocation before that point is not itself native issue.
After issue any timeout/error/mismatched ACK/Stop/source fence becomes unknown,
keeps local state and cannot replay. Decoded coherent ACK is retained before a
later Stop or source failure. No blind rollback occurs after possible issue.

A definite preissue refusal applies only the own ordinary Undo delta, using the
live row inside its transaction. It preserves newer unrelated metadata; conflicting
folder/reminder/account changes remain refused+locally locked. Keyed unknown or
pending operations lock further placement work for that Thread. Legacy placement
and Undo check this inside their account queue, so a queued operation cannot pass
an earlier stale lock check. Read/star/unrelated metadata stays usable.

Undo reserves its own immutable key/status before transport. Its final Store
commit re-evaluates the existing fieldwise Undo against the current row and
atomically records confirmation. A lost Undo ACK leaves the original local state
and exact Undo row locked unknown. GET does not reconcile against Gmail and no
provider retry/recovery path is invented. A saved not-issued pending state after
restart remains pending; an issued state is exposed as unknown. There is no
startup dispatch or automatic retry.

## Native adapter

Dedicated ordinary label adapter, no Reminder command reuse. One POST to the
selected account's exact `threads/:providerId/modify`, exact INBOX-only delta,
MAIL token, manual redirects, omit credentials,20second abort bound and256KiB
response limit. It has no read retry, Send/draft/Calendar/model route or lookup.
Only a coherent200+same-thread ACK is known. Positive ACK is recorded before a
later Stop check. Oversized/foreign/error responses remain unknown after issue.
Large provider responses can therefore conservatively remain unknown; no claim
of unbounded Thread support or global Gmail compare-and-swap is made.

## Startup identity/migration

The constructor uses the EXISTING model-independent shared account authority.
Only eligible demo or Google accounts with a current valid stored MAIL grant/
scope/identity may adopt an absent head once. Existing valid heads are validated
unchanged; invalid existing heads are never reset. Denied/missing grants remain
unavailable. This is lifecycle identity, not fresh Gmail/profile/FULL/Reply proof,
consent or model activation. Cached GET never adopts, even after a later grant.
A credential refresh captured before this adoption tolerates adoption-only noise
under the existing maintenance contract, preserving service authority.

Installation/adoption/metadata seeding is one savepoint; a schema failure rolls
it back. New schema: archive_action_heads, archive_action_operations, three source
triggers and one scoped operation index. No account/source mail record is rewritten.
The synthetic migration control proves existing schema and records/draft attachment
bytes exact; only eligible missing shared heads + account-adoption event suffix/
its sqlite_sequence are added. Current Main's two already-established Google
heads are expected to remain exact; actual Main migration remains Root's audit.

## Validation and limits

25 new purposes +8 unchanged Store Undo guards pass, as do all API source/test
strict+erasable checks. Controls include real-shaped HTTP metadata/Archive/Undo,
unknown/no-replay/restart, preissue rollback, source/account ABA, atomic receipt
failure, live re-preparation, separate-owner pending Undo, per-account FIFO,
late read/star, legacy isolation/queued lock recheck, exact key conflict,
positive ACK retention, bounded native response refusals, scoped adoption and
credential maintenance noise, zero-write cached reads and atomic schema rollback.
All test processes preload denial before imports and inject synthetic transports;
no credentials or live mailbox are needed. Existing initial failures remain:
incorrect demo Reply-availability test assumption, missing synthetic credential
fields, and the expected legacy DTO extension comparison, corrected by scoping
new metadata to the specified routes. Initial strict-narrowing errors are retained.

Original rapid-key timing, motion, response latency/provider behavior and full
parity are not established here. Browser reservation/motion belongs to a separate
owner. This module cannot make a finite cached source check a provider-wide CAS,
and it does not claim unknown means absence or that a local Archive no-op proves
an original Inbox transition.

## Narrow routing correction AAR01

The initial held3abc candidate dispatched keyed parsing only when clientRequestId
or expectedSourceVersion existed. An independently preserved request containing
only the new accountVersion marker incorrectly reached legacy Archive. This
successor also recognizes accountVersion as keyed-only, so any of those markers
requires the complete strict keyed body before queue/native/local mutation.
accountId alone remains legacy-compatible because it is not a keyed-only marker.
All other runtime/protocol/source/head/Undo/native behavior is unchanged. The
unchanged outside HTTP oracle is GREEN via an import-only successor redirect;
its initial RED and all parent bytes remain held, without a retroactive pass.

## Public test entrypoint correction

The prior private holds required an external denial preload. Running their new
Archive tests through the normal package command therefore failed before cases;
Root's initial full-gate RED is retained. This successor imports the public,
test-only archive-network-deny.ts FIRST in those two test files, before App
module dependency evaluation. It installs the same fetch/http/https/net/tls
denials and counted state only when absent; an external preload is idempotent.
Default Node test-file isolation keeps unrelated existing local-TCP tests out of
that helper's process. It is not imported by application runtime or other tests.
Test assertions and all API runtime/DTO/schema files remain byte-exact to V2.

The33 focused purposes pass with no private --import flag, and allAPI strict+
erasable checks pass. Public-first/repeated-evaluation and external-preload controls
preserve the same state/functions and block their5 deliberately synthetic native
probes before any network. The normal package test script ran1035 cases in the
owner sandbox:1022PASS,13 existing loopback-listener EPERM failures; that log stays
failed and is not claimed a full gate. Root's TCP-enabled exact normal package
run remains required. No test assertion, TCP case or package command is waived.
