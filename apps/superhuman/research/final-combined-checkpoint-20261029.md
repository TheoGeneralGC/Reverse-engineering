# Combined inline, persistence, tracking and date-search checkpoint — 2026-10-29

**Combined source is applied and Main restarted.** Reviewed 884/689 gates, a
79-action synthetic inline case, one controlled tracked-delivery/read proof and
a separate read-only Main smoke have distinct boundaries. Responses and tracking
desires remain off. Managed cloud capability and matched collector verification
are configured; no generated managed output or effective-ON Main tracking claim
follows. The [855/680 checkpoint](auto-drafts-local-checkpoint-20261029.md) remains
historical with its own data qualifications.

## Source and verification

The exact 449-path source identity is
`b96be79042636270de09d4b1987940fa5632b8a5bc1462c31b44144ae1b26e3b`:
251 API, 193 frontend and five collector references. Commit `af64af7` matched
all 449 files before this documentation update; production and test bytes remain
unchanged. The combined API passed
**884/884** tests, all-source/test strict checks, frontend production types and
build. The first frontend run was **686 PASS/3 FAIL**. Each failure came from a
shared fixture mirroring a different generated draft into its original-draft
accessor; the editor/navigation assertions had passed. The successor restricts
that mirror to the same draft ID and account, preserves all three assertions and
adds original editor/recipient identity checks. Its full suite passed
**689/689**, with strict tests. All API and production frontend bytes are exact
to the already gated parent; those gates were inherited by identity, not rerun or
relabeled. Existing collector 53 and separate Vercel 23 counts are unchanged.

Pinned REA captured **79 declared actions plus the initial state**:
`ev_0c066f23da6b99beceef868980033771fe28809e077fcc01b030e36745187d44`.
The actual factory/routes and normal Inbox used isolated synthetic accounts/data,
fake authenticated Google responses and one fixed model response. It proved:

- Direct Responses-on settings, one lost accepted ACK and same-key GET recovery;
  the current rich/recipient editors and their bounded Undo histories survived.
- One generated reply mounted the ordinary inline composer beneath its exact
  source, without Open/Hide preview controls. Focus/untouched close and reopen
  made zero generated PATCHes; the source publication remained available.
- One pointer quote activation revealed the canonical tail in the same editor,
  kept its body/HTML bytes exact and made one conditional human claim. Its old
  generated-publication binding then became unavailable, as intended.
- One fake model call, ten fake Google GETs, zero native provider mutations or
  deliveries, and no real transport. Three protected records stayed exact versus
  baseline; the audit separately matched all136 logical table counts/digests to
  its own preclose backup. Owned Chrome and both services closed.

Events are incomplete and `equality_eligible:false`. The backup comparison is not
all-table equality with the initial fixture, a post-shutdown equality claim or
complete network capture.
This focused case does not rerun the historical 16-case/407-step regression.

## Implemented boundaries and design choices

**Generated persistence.** The trusted runtime selects `local` by default or
explicit `managed` through `AUTO_DRAFTS_PERSISTENCE`. Local output does not enroll
for cloud save. Managed output uses a distinct generated-only origin and atomic
publication/enrollment; availability requires processing and provider automatic
saving to be wired. `automaticCloudSave` reports that capability, not a Gmail ACK.
Mode/configuration epochs prevent old queued local work from being reinterpreted
on restart. The local→managed→local ABA queue-head finding and fix remain in
review history. Responses still use direct settings, without a second Activate
or budget screen. No automatic Send, backfill or overwrite of human work is added.
This is create-only Responses; updates, Follow-ups, teammate scheduling,
authoritative Subject context and model quality remain open.

**Ordinary inline authoring.** The existing App composer, recipient, provider,
delivery and Undo paths are reused. A proved quote tail is initially hidden;
expansion is one-way editable authoring, not a reversible display disclosure.
Normal conditional PATCH binds account/thread/revision atomically. Empty
`action:'claim'` cannot carry authored fields. Lost ACKs retain work and use
scoped current GET, without automatic PATCH or Send replay. Untouched acknowledged
content stays zero-write; actual edits and edit/revert remain human claims.

**Tracking.** The reviewed capability projection requires exact configured
collector identity, a matching point-in-time private operator record, constructed
services and account desires. A configured origin alone is unverified. Current
capability can be true without fabricating cached events; historical receipts
keep their accepted flags. GET performs no hosting probe or import. New tracked
acceptance refuses unverified hosting before provider issue. Anonymous image
fetches still prove neither named identity nor a human read. The
[deployed collector](vercel-deployment-checkpoint-20261029.md) separately passed
public health/signed-wire, replacement persistence, concurrency/page100 and a
210-row logical export/memory restore. That is not managed disaster recovery and does not configure Main automatically.
A separate [controlled tracked message](tracked-delivery-checkpoint-20261029.md)
completed one owned cloud CREATE/native mapped Send, prepare/arm/confirm, explicit
anonymous fetch/import and one cached event. Sender alternatives stayed exact;
recipient strict plain-text and HTML equality failed. No retry or resend followed.

**Date search.** Nonempty browser searches carry a validated IANA timezone in
request/cursor context. Slash dates use that zone's midnight, including DST;
ISO dates and numeric seconds retain UTC/absolute meaning. Omitted timezone
retains legacy UTC. The [original one-message comparison](search-date-comparison-20261029.md)
provides bounded slash/ISO evidence; broader formats, inclusivity, message versus
thread dates and full provider search parity remain unverified.

## Retained review findings and qualification

| Record | Result and limit |
| --- | --- |
| Quote Undo P2 | Squire replaced hidden DOM nodes; rebinds the exact proved tail without serializing view attributes or resetting Undo. Original RED retained. |
| Authored-save lost-ACK P2 | Authored CAS now shares claim recovery; no implicit repeat, current GET and newer rich/recipient Undo retained. |
| Owned pre-send P1 | Scoped Send/account-switch continuations allow their necessary save while competing actions stay blocked. Pre-issue local refusal is not fictitious unknown acceptance. |
| Pre-send oracle setup | Original and GET-only failed fixtures remain. A separate two-omission wire-compatible setup reverses exactly, keeps assertions, and is RED on the old source/GREEN on the fixed source. |
| Combined web3 | Fixture original-record identity mixing; test-only correction, all original expectations retained, no production editor fix. |

The [original response/quote record](original-auto-draft-response-observation-20261029.md)
separately observed a pre-open unsent cloud reply, an already-mounted inline
composer, signature inspection and one persisted quote expansion. Its pointer
observation does not prove replica keyboard/focus/geometry or cloud equality.
The earlier [strict received plain-alternative failure](mapped-send-live-check-20261029.md)
remains failed; no retry or resend is implied.

| Acceptance | Current boundary |
| --- | --- |
| FC-01: coherent source/types/build and tests | API884/frontend689 pass; exact449 source |
| FC-02: ordinary inline/one-way claim and untouched close | New79-action synthetic case passed; original interaction scope remains bounded |
| FC-03: recovery, ownership, editor/account guards | Focused serialized/actual React checks and bounded browser purposes passed |
| FC-04: generated managed cloud persistence | Synthetic construction/epoch controls passed; real generated cloud behavior pending |
| FC-05: verified hosting and effective Main tracking | Collector proof separate; Main configured/operator-verified but desires off/effective false; isolated tracked proof retains recipient differences |
| FC-06: browser-zone date search | Parser/Store/route/hook checks and four matched HTTP totals passed; browser query interaction not repeated |
| FC-07: combined Main rollout | Applied61/all 449 exact; jobs-off clock-only qualification, serving/read-only smoke and qualified postrestart comparison completed |

## Separate pre-rollout Main qualification

The new backup-to-live read-only boundary found 11,960→11,962 records,136 tables
and no schema additions. All 20 prior drafts, seven attachments and four sealed
ciphertext rows stayed exact. Protected delivery/provider, Undo, nonoperational
Calendar, Knowledge/chat/manual personalization and model/worker/settings state
stayed exact; derived `ai_mail` data is separate. Responses stayed off for both
accounts with zero issued/queued work and no activation; tracking preference
rows stayed zero. **Strict equality is false for 33 tables**, including account/
sync, Thread, mail/recipient/Split derived, ingress/bridge/status, `calendar_sync`
and tracking mail-resolver changes. These occurred with normal Main sync possible;
no causal trace, normalization or broad exclusion is implied. See the
[tracked-delivery qualification](tracked-delivery-checkpoint-20261029.md#qualified-main-comparison-before-combined-rollout).
This pre-rollout boundary is separate from both the historical855/680 restart
audit and the subsequent combined rollout below.

## Applied Main rollout and separate restart boundary

Root applied 61 paths (43 API, 18 frontend, 11 new paths) and verified all 449 files
against the source identity above. A fresh stopped backup contained 11,962 records,
136 tables and no pending work. The jobs-off constructor made zero fetch, model-
credential/model-profile or timer calls and no DDL/schema additions. It was not
read-only: the existing foundation close/recovery transaction advanced only its
clock watermark from 1793304062227 to 1793304145325. The other 135 tables, all 11,962
record rows, 20 prior drafts, seven attachments and four sealed rows stayed exact.
Strict all-table equality is therefore false even at this qualified boundary;
there was no retry, restore or normalization to make it pass.

Private startup configuration now explicitly selects managed generated-draft
persistence and loads the matched collector operator record. The pre-existing
credential-file byte prefix was preserved. No private path, key, record contents
or credential fingerprint is published here. Runtime capability is not an ACK:
both Responses values remain off with zero attempts/queued work and no activation,
while generated cloud capability is true. Tracking desires remain off, collector
verification is operator-verified and services integrated, with reason
account-disabled and both effective flags false. Main has zero stored tracking-
preference rows. No new model or native Send occurred during this rollout.

Main restarted at its existing local endpoints and status/serving reads passed.
A read-only browser smoke completed 12 actions plus its initial state:
`ev_dc8a1abc3f76e0ade510297104b7d161cd8a9f74a2c278b2de0331df46fb5bb7`.
It is complete and equality eligible; owned Chrome closed. No editor, toggle or
Send was used. This new smoke does not change the earlier 79-action case's
incomplete events/equalityfalse or establish original-product parity.

Four read-only API searches on the same fictional comparison fixture now return
baseline 1, slash-after 0, slash-before 1 and ISO-after 1 with America/Los_Angeles.
That matches the bounded original pattern. Browser query interaction was not
repeated; broader date/time formats and full search parity remain open.

A fresh native read-only postrestart snapshot retained 11,962 records/136 tables.
Strict equality remains false for these 12 tables: `auto_draft_foundation_clock`,
`auto_draft_ready_eligibility`, `auto_draft_ready_events`,
`auto_draft_v2_projection_counters`, `auto_draft_v2_projection_events`,
`auto_draft_v2_status_commits`, `auto_draft_v2_status_heads`, `calendar_sync`,
`google_ingress_meta`, `google_ingress_pages`, `records` and
`split_source_generations`. The record differences are two account, two sync-
health and two sync records; Threads stayed unchanged. All 20 drafts, seven
attachments, four sealed rows, model/Knowledge/chat/AI, delivery/provider,
tracking, Calendar except its operational sync, and action records stayed exact.
Both Responses values remain off/zero/no activation; tracking preferences remain
absent. One current readiness observation was ingress-not-ready; availability is
point-in-time and is not asserted universally. These separate snapshots are not
causal proof of synchronization, all-table equality or a new generation result.

The full 884/689, types and build gates are inherited by exact 449-source identity;
they were not rerun unnecessarily after application. Generated managed cloud
output, effective-ON Main tracking and full original parity remain unverified.

All 22 feature-family statuses remain unchanged. Full one-to-one parity is false.
