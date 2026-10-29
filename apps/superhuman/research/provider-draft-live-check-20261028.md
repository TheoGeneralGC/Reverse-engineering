# Provider draft lifecycle and rollout

Recorded 2026-10-28. A root-executed, recipient-free fixture passed native Gmail
Draft creation, two updates and explicit mapped discard using the private
**531 API-test** candidate. A separate fresh-process local receipt check passed.
The **490 frontend-test** candidate's first browser flow failed after its mocked
discard had already completed. Its corrected **495 frontend-test** successor
passed a new 35-action browser flow and is applied with API531. These outcomes
remain distinct; they do not establish full provider-draft parity.

During the initial native check, the preceding **480 API/429 frontend** version
was stopped for backup/review. The later rollout below applies the successor.
The [original provider-draft observations](provider-drafts.md)
remain the comparison source: one newly owned original draft appeared and
updated in Gmail Drafts, then stopped matching its scoped Drafts query after
discard. The original private server/transport, Gmail draft resource mapping and
cross-client conflict protocol remain unobserved.

## Candidate identity and isolation

- Coherent private API531 freeze: manifest SHA-256
  `55806fc5b4df5826f5e73f268f5b63d7a9a4a8f3b851401add66644497bdc274`,
  **152 exact members**, Node **24.22.1**, all 531 tests and strict types passed.
- Its actual private runtime dependency lock was separately bound to
  `930d24a6e3bdc3f1a4291720d4c19856ce33a49637c23d1d60627bad4e7c2426`.
  The historical root lock was recorded independently; it was not substituted
  for the private runtime's installed dependency identity.
- The root-only live harness was frozen before execution. Its seven synthetic
  controls covered source/lock binding, denied Send/other-target requests,
  mutation ceilings, exact fetched-resource identity, rich MIME and a direct
  attachment-byte negative control, plus the actual SQL schema used by the
  read-only baseline helper. Its earlier507 preparation archive was retained and
  was not relabeled as531.

Only the selected stored Google account, its explicit MAIL grant and its sealed
MAIL credential slot were copied into a new isolated database. No Calendar
credential, other account, mail history or existing user draft was copied. The
main database was opened only through Python SQLite `mode=ro` with a SELECT-only
authorizer; no main App/Store constructor ran. The isolated App used explicit
matching database paths, `seed:false`, `runJobs:false` and
`providerDraftAutomatic:true`. Send approval lists were empty, Calendar was
disabled and no AI credentials were supplied.

Actual server routes were invoked in-process, with the automatic autosave
callback released through a controlled scheduler. This exercises the automatic
service path without a Sync click; it is not browser interaction or a measured
wall-clock debounce test. Every local mutation and native Google attempt was
journaled first. The fetch guard limited writes to this attempt's one new Gmail
Draft; unknown outcomes would have stopped all later mutations. One mail-token
refresh was explicitly permitted but **none was needed or attempted**.

## Native Gmail lifecycle

Private run `provider-draft-live-20261028-01` completed with **44 journal events**
and **15 guarded upstream attempts**: four mutations and eleven reads. The
producer is the root's native API harness, not REA; no REA evidence ID is assigned
to these provider calls.

| Phase | Recorded result |
| --- | --- |
| New rich recipient-free draft | One automatic CREATE, HTTP200, confirmed issued operation, local revision1. |
| Pre-reviewed body/rich revision | One automatic PUT, HTTP200, confirmed revision2. |
| Fixed synthetic text attachment | One further automatic PUT, HTTP200, confirmed revision3. |
| Explicit keyed mapped discard | One issued DELETE, HTTP204, matching confirmed reserved delete operation; the owned local draft and attachment were removed. |

The provider Draft resource ID stayed stable across all three save proofs. The
three provider message IDs were distinct and matched their acknowledged
operation results. Each fetched proof was bound to the acknowledged Draft,
message and thread identities before decoding. The runtime decoder checked the
sender association, empty To/Cc/Bcc, exact fictional subject/plain text/rich HTML,
ownership markers and decoded snapshot identity. The third proof decoded exactly
one synthetic attachment: **65 bytes**, correct name/MIME and SHA-256
`38cabf702f262c782d9a7223e1213c4e53a4d05423c70c2fa3ccf49fdb84515c`.
These are provider Draft bytes; no message was sent and there is no recipient
delivery or received-attachment claim.

The successful DELETE acknowledgement and confirmed issued operation support the
recorded deletion execution. A subsequent exact Draft GET returned404; that is
corroboration of target unavailability, not the basis for inferring that DELETE
executed. The historical same-key receipt was read again without a mutation.
The isolated database had zero remaining Draft/attachment rows and zero Send,
delivery, model-dispatch or Calendar-operation rows.

The main before/after baseline files were byte-identical, preserving **19 Draft
JSON records, three Calendar operations, six delivery records**, and the recorded
AI/session/dispatch and delivery-action rows/counters. This is the scope of the
baseline assertion, not a universal audit of every running process or network
transaction.

The live report SHA is
`232f77e9d178b9cddd7ad940beff1c5c9ea44b2fdbc9fc801334c3d6b6f12f98`.
The independent offline review, including a SELECT-only audit of the isolated
provider ledger, passed; its SHA is
`c9f5a22d1bfd9ef45c305dcedda4dfb8d241046029affd76e09911c7ce0d2f0c`.
Private journals, resource identities and account material remain ignored.

**Independent-review limit:** the frozen runtime harness decoded the actual
provider MIME. Only proof hashes/match flags were retained, and confirmed MIME
BLOBs were subsequently pruned. The later independent review verified those
proofs against the operation ledger and frozen assertion code; it could not
reparse the raw provider body or attachment again. A reviewer-only initial
full-object comparison was corrected because the report adds operation/revision
annotations to the standalone proof's base fields. All shared fields matched;
that audit assumption was not a failed native lifecycle.

## Separate fresh-process local recovery check

Root then ran a new Node24.22.1 process against the exact isolated clone, with no
credentials, no copied-seed read, all fetch seams blocked,
`runJobs:false` and `providerDraftAutomatic:false`. It performed exactly **two
local GETs**: the historical discard key and provider status. Both matched the
completed terminal receipt/status; **zero fetch attempts, POSTs or new dispatches**
occurred. Its PID differed from the live lifecycle process.

SELECT-only snapshots before and after App initialization/GET/close hashed the
schema and all logical rows in **60 tables**, including FTS rowids/shadow tables
and sealed-credential ciphertext hashes. They were equal. No credential was
decrypted or printed, and the main database was not opened by this check.
Its report SHA is
`80707b3f010b69d387af7d420108994f47c7364e603fc6580c35bc09fa9134dd`.
Independent report review confirmed these bounded results without rerunning it
or opening a database. This is local persistence/restart evidence, not a fresh
provider read or another claim about the provider's current state.

## Preserved browser failure on frontend490

The separate synthetic browser attempt declared **37 actions/38 captured
states**. It retained **31 completed, one failed and six cancelled states**:
`ev_2f79200725e7a27f53470a18e59f31b1ad8134a54f3b78c3a3ffffa458fac729`.
App SHA was
`912f17b9c63729e3efd8d3f1875e97bc5d65232916fa859d18b32570ea59e0d9`.
The scenario failed at `confirmed-discard-editor-closed`: the server's discard
was terminal, but the App required an additional “Close discarded draft” action.
The observed original one-click discard returns to Inbox. This is a real flow
gap; it is not dismissed as a selector assumption.

The retained posthoc review positively checked one injected create-ACK loss,
explicit read recovery, exact newer local body, decoded mocked plain/HTML,
**1/1/1 mocked create/update/delete**, confirmed provider operations, and no
remaining local/mock-remote draft. It recorded zero Send/Calendar/model/
credential use or external fetches. That does not convert the failed browser
flow into a pass, prove real Gmail from the browser, or establish attachment UI
coverage. The five later empty-draft actions did not execute. An initial
posthoc SQL query used a nonexistent physical column; the subsequent actual-
schema read corrected that audit query without writes.

The capture has incomplete action/DOM/AX/screenshot/URL/event coverage and
`equality_eligible:false`; the owned browser was terminated. A direct-discard/
terminal-auto-close successor was checked separately below. This failed capture,
its reviewed result and the successful API531 lifecycle remain distinct.

## Corrected browser flow and applied checkpoint

The corrected App SHA-256 is
`883b0aa16d88c6bb8a315719d0029b49a0785624760570df878a7f9cc8fe27bc`.
Its exact private API531/web495 manifest SHA is
`63c630e76091c237415769b17a71e481470d62875e4e7c70c4fd311fcc5402b9`.
Five added React controls retain the earlier direct-discard/terminal failures and
an independently found early-read edge: Discard now waits for a scoped status,
then its single click starts the keyed action. Confirmed terminal state closes
only the captured account/draft/view, using the existing single-use release fence.
Unknown/pending actions retain the locked editor and bytes.

New synthetic browser attempt02 passed **35 actions/36 states**:
`ev_6d5a771ae6d98072b969fc1218a7787a634449402d479e94b00d5520f8ac9e92`.
It exercised an injected accepted-CREATE/lost-response, newer local edits,
explicit read-only reconciliation, a distinct successor update, close/reopen,
one-click mapped discard with automatic editor close, and a new empty draft's
keyed local close. Exact newer plain text and decoded mock-provider plain/HTML
matched the local canonical. Private retained MIME also bound operation/hash
headers to the ledger; the independent stopped-database/MIME review passed.

There were **three issued mock operations** (one create, update and delete), plus
one confirmed **never-issued local blank-delete tombstone**. Both links/receipts
were terminal, with zero remaining local/mock-remote drafts. The empty editor
serialized as `<div><br /></div>` and caused no additional cloud write. The audit
corrected initial assumptions about literal-empty HTML, total versus issued
operations, and empty versus absent recipient headers without rerunning the
browser. No Send, model, Calendar, credentials or external fetch was involved.
Events remain incomplete and equality is ineligible; the owned browser was
terminated. The failed attempt01 remains a separate failed record.

Root applied 41 hash-checked public source/lock paths and installed the exact
reviewed lock with dependency scripts disabled. Root gates passed **531 API/495
frontend tests**, build, API strict types and all frontend-test strict types.
The current full demo regression, `20261029T000039Z`, passed **16 cases/407 steps**,
all eight persisted assertions, **152 stable manifest entries**, zero captured
page errors and owned-browser cleanup. Reply-all remains missing events and
equality-ineligible; its exact POST/201 assertion passed. These demo checks add no
live provider or original-behavior proof.

The stopped backup passed SQLite integrity checking. Read-only before/after
audits preserved **19 existing Draft JSON records, seven attachment rows/bytes,
three Calendar operations, six delivery records**, and protected model/action/
Automation rows. All three new provider tables were empty on the main database:
legacy drafts were not enrolled. Two mail credential records stayed byte-identical.
Two Calendar access-token records changed with the same refresh credentials and
scope sets, advanced expiry and new access tokens; their grant changes were only
scope ordering/updatedAt. Account changes were only lastSyncedAt. This is
consistent with the existing refresh/sync paths; HTTP refresh transactions were
not captured. The initial strict byte-equality audit remains failed separately.

## Acceptance scope

These results add bounded support to the existing
[PD acceptance candidates](provider-drafts.md#reconstruction-acceptance-candidates):

| Case | Evidence added here | Still open |
| --- | --- | --- |
| PD-01 automatic new-owned save | Native recipient-free API/service create/two updates; corrected synthetic automatic browser flow. | Real-browser provider latency and broader edit patterns. |
| PD-02 stable mapping | One real stable Draft resource with distinct acknowledged message IDs and revision/hash ledger. | Broader provider normalization and cross-client cases. |
| PD-03 latest snapshot | Sequential reviewed revisions1/2/3 persisted. | Concurrent/late-ACK behavior is supported by offline controls, not this sequential live run. |
| PD-04 ambiguous create | Corrected synthetic browser lost-ACK/read-recovery flow passed; failed predecessor retained. | No real lost-ACK/crash was induced. |
| PD-05 ownership/concurrency | One selected account/new target; source/claim/ID guards and protected baseline. | Real competing-client edits and provider CAS semantics. |
| PD-06 keyed discard/restart | Positive real DELETE acknowledgement, same-key restart persistence and corrected direct-discard/terminal browser flow. | Live in-flight/unknown discard and complete original comparison. |
| PD-07 rich/attachments | Runtime provider-decoded exact rich/plain fixture and a 65-byte attachment. | Independent raw reparse, quoting/replies, broader MIME/provider transforms and UI attachment coverage. |
| PD-08/09 delivery/status | No Send occurred; locks/status have separate offline controls. | Delivery/Undo integration and complete original-matching status/navigation comparison. |
| PD-10 imported draft | No evidence added. | Existing/imported provider-draft editing remains excluded. |

No entire PD family is marked globally verified from this record. Real mapped
Send/Undo, imported draft editing, broad provider transforms, competing clients
and complete original visual/status behavior remain open. The native531 check,
failed490 browser flow, corrected495 browser flow and applied-root regression
retain their separate identities.
