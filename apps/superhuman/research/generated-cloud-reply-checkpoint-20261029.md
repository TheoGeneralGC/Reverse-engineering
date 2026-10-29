# Controlled managed Gmail reply — 2026-10-29

One Claude request produced one managed, unsent Gmail reply to an explicitly
approved fictional question. Gmail acknowledged creation and returned its raw
content. A fresh process verified the persisted publication, input, draft and
cloud link without constructing the application or making another provider/model
call. This proves one implementation path; full response-engine parity remains open.

## Source and controlled scope

The implementation is the applied **884 API/689 frontend** source, bound by the
449-path manifest
`b96be79042636270de09d4b1987940fa5632b8a5bc1462c31b44144ae1b26e3b`.
No production or test source changed for this check. Node **24.22.1** ran the
actual factory, Google provider, ingress, response worker and managed-draft
publication in a separate consistent-copy database. Main remained live; this
check did not activate Responses or backfill Main. The historical
[combined rollout](final-combined-checkpoint-20261029.md) retains its own
synthetic/browser evidence and data boundary.

The synthetic question updated a Cedar review to Friday, 4 PM, Room Birch. It
was sent once between the approved test accounts at **21:28:15.609 UTC**. The
recipient's exact provider view had different line wrapping from Sent; its
175-byte plain text and absent HTML were independently bound rather than
rewritten to the outgoing bytes. All continuations used the original closed
post-Sent copy, existing activation and barrier. None resent the question,
changed preferences or reconstructed a new baseline.

The V3 helper manifest is
`762cbdddaf2eb53546beed9fd94d8aa761380a42fc1205350a44ac69a6ec427e`;
its independent offline review is
`672d3e790de4ef3c2e0611b8533c3ad33ea55b41237d1432bf1308f5b53f6724`.
Budgets and actual actor/account/lease/history-page bindings constrained reads.
Only the owned fictional context could reach the model. Other threads needed
for ordinary mailbox history completion could be read and admitted, but were
not dispatched to the model by this check.

## Original comparison remains qualified

The reference identity previously recorded with pinned REA **6.8.0/skill49** was
Chromium **156.0.8078.48**, build **db8c4288f33febf25ad9**, main-script digest
`c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`.
That identity is historical; these later provider reads did not refresh the
original script digest or measure its effective CSS viewport/DPR.

Three bounded provider observations around this question found no new
same-thread reply draft: before Send, at **21:31:44.075 UTC**, and at
**21:40:09.737 UTC**. The latter two contained both source messages and no
candidate reply. The observation workflow then closed. It made six profile GETs,
three thread GETs and two counted credential refreshes, with no mailbox write,
model dispatch or original UI action. This is absence at observed times, not
proof of a disabled feature, a latency guarantee or failure of original automatic
responses. Server cadence, eligibility and causal trigger remain unknown.

The later observation report digests are
`b1c325a2eadc85e292b9a45c83c92a8dd1168c228f3b31a07535e37fabf208c9`
and `54aa6731dcceab21c74c390494c1206fb093276e4e26a6a84659f423105f0572`.
They do not replace the separately observed
[earlier original response and quote expansion](original-auto-draft-response-observation-20261029.md).
There is no paired same-question original reply, so no wording, response timing
or model-quality equivalence is claimed.

## Preserved stops and separate continuation

| Attempt boundary | Retained result |
| --- | --- |
| Initial controlled question Send/check | The one acknowledged question Send was followed by a reader refusal of legal base64url padding. No model or generated CREATE occurred. Its audit also retained a recipient Split-source counter change; it was not normalized into equality. A separate one-GET reader confirmed the known Sent resource without resending. |
| Continuation V1 | Source/state review inferred that exact-owned-thread-only read scope stopped normal history completion when another thread was needed; the first refusal code was not retained. Zero model/CREATE/Send. Two changed OAuth-attempt rows remained unexpected in that attempt's audit. |
| Continuation V2 | A real non-owned full-thread 404 was refused by the universal-200 guard. Zero model/CREATE/Send. Its diagnostic was present; an initial Root query used the wrong report field name. |
| Continuation V3 | Separately reviewed scope preserves actual bounded full-thread 404 bytes and lets the existing provider apply a local cache tombstone. It performs no provider deletion or audit waiver. The owned source remained available; one model and generated CREATE/readback completed. |

Old issued locks, failures and stopped copies remain intact. V3 did not resume
their writes. Its final report digest is
`4645293b0a9c627188d7c600e2b982e16a8aac0c023ec4f355868f49d8b24b49`.
Independent metadata-only review
`8ab9ab88afc13a3ca196858ee7ccfec4cb71487024270a1767ef2d618099cc89`
cross-checked 61 monotonic journal entries, **16 Google invocations/one model**,
one generated CREATE/readback, **zero new Sender CREATEs and zero new Sends**.
Two non-owned 404s and two MAIL credential refreshes were counted. The historical
question Send is a separate event.

## Persisted result and preservation

The authored reply has **83 UTF-8 bytes** and explicitly confirms Friday,
4 PM and Room Birch. Those checks apply before the quote boundary at byte85;
the facts are not merely found in quoted source. Reconstructing the reply from
the immutable recipient snapshot and saved timezone reproduces the exact
**341-byte plain body/446-byte HTML**. Submitted and returned MIME alternatives
match the persisted draft after CRLF normalization. From/sole To match the
approved pair, In-Reply-To matches the question, References matches the managed
reply context, and Cc/Bcc, attachments and tracking images are absent.

Fresh read-only SQLite verification found one published generation, one unsent
draft, one synced managed link and one confirmed provider operation. Publication
and input integrity proofs, authored/content hashes and cloud enrollment match.
Its report digest is
`c8e5eb1632d0f9b0622851f8db3c13008e170663f70327a757a2d9ac6e5acf29`.
An initial verification script refused the nested report shape before opening
SQLite; the corrected verifier retained that first script and made no new
model/provider call. This is persisted-state verification, not a new remote
durability or browser restart experiment.

Isolated-copy construction preserved all **166,014** old logical rows. After
execution, **165,943** were exact, **71** changes were specifically qualified,
and **86** rows were new, with zero unexpected old/new rows. Settings and the
activation barrier stayed exact. Strict all-row equality is **false**. Two actual
admissions produced one published reply and one queued, undispatched job; only
the owned fictional job had a model attempt. The isolated app closed, so this
is not an active Main queue or permission to dispatch the other job.

A separate live-Main metadata comparison spans **21:23:23–22:30:35 UTC**.
All **20** prior local Draft rows, all **seven** Draft attachment rows/bytes and all
eight delivery/provider tables stayed exact. Schema was unchanged. Main had
11,987 records versus 11,980; **38** tables differed, including mail indexes,
ingress/projections, Calendar, undo and credentials. Four sealed slots still
exist but their ciphertexts are **not equal**. This metadata-only boundary does
not prove their credential/scope identity or causally explain the changes.
No all-state-preservation claim is made. Its report digest is
`5be78a4b320e7c5263be0e0a5724d258643cba8894f99cf4b16e8c336c4b4123`.

Independent metadata qualification
`eaaf6635f3fd4c25c8595ad0850592bc46a67b5dea3b0a2990e16cb52ce96296`
confirms 98 exact tables, including specific model/chat/action and Knowledge
ledgers. Twenty-five zero-row automatic-draft authority/settings/request/job/
input/publication/usage tables remained empty, and seven nonempty readiness/
identity tables stayed exact. These two snapshots do not prove effective runtime
OFF, absence of transient activity or any intervening state. Credential, Calendar
and undo drift remains unqualified.

## Acceptance boundaries

| Case | Result and limit |
| --- | --- |
| GC-01: one genuine bound model dispatch and managed cloud output | Passed for one fictional response on the exact applied source; separate copy, no Main enable/backfill. |
| GC-02: authored facts, quote, parties and reply anchor | Passed fresh persisted-state/MIME checks; broad semantic quality and original wording remain unverified. |
| GC-03: preservation and uncertainty | Copy audit has zero unexpected rows with strict inequality retained; Main prior drafts/attachments exact, other live drift remains qualified or unknown as stated. No failed attempt was reclassified. |
| GC-04: same-question original comparison | No original response at three observed times; no paired output or timing-equivalence claim. Earlier original positive fixture remains separate. |
| GC-05: browser interaction and wider automation | Existing synthetic79-action inline proof is historical. No new live browser edit/quote/Send or response update, Follow-up, subject-aware context, teammate scheduling, competing-client or failure-recovery proof. |

All 22 feature-family statuses remain open. Hashes identify private audit records,
not REA evidence IDs. No real mail, provider identity, raw MIME, capture,
credential, model body or extracted vendor code is published.
