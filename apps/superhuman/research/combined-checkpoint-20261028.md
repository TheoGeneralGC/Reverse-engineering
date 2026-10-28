# Combined delivery, Knowledge and personalization checkpoint

Full one-to-one parity remains incomplete. This record describes the version
running on the normal local ports after the 2026-10-28 combined rollout.
Original behavior, implementation choices and verification limits remain
separate. Outlook is excluded at the user's request.

## Implemented scope

Normal composer delivery now uses durable request identities, preserves the
existing rich draft and its reply context, and supports cancellation before a
provider attempt. Scheduled delivery waits for its due time. Instant Send
shortens the existing operation's deadline rather than creating another attempt.
Unknown provider outcomes remain locked for read-only reconciliation; they are
never automatically resent. The provisional ten-second Undo delay and recovery
policy are local choices. The earlier live artifact Send/Undo and fresh-generation
receipt check is recorded in [undo-send.md](undo-send.md); live normal-composer,
scheduling and acceleration comparison still require their own evidence.

Private Knowledge provides account-scoped file/page sources, durable ingestion,
real text/document extraction, versioned metadata edits, original-byte downloads
and read-only Ask AI retrieval/citations. Sources remain private. Public links
are bounded HTTPS page snapshots, with DNS/redirect checks; original domain-wide
and live-retrieval claims remain gaps. The file/format limits, parser budgets,
description generation and API recovery contract are explicit local choices.
See [the implementation contract](../api/KNOWLEDGE.md) and
[original runtime observations](knowledge-base-runtime.md).

Account personalization now has staged Save, revision conflicts, guarded
navigation and an immutable preference snapshot for accepted AI turns. Inline
rewrites carry the draft's explicit account and reject stale account/editor
results. Learned voice remains unimplemented. See
[the comparison record](personalization.md) and
[the contract](../api/PERSONALIZATION.md).

Startup can adopt an absent legacy Gmail grant record from that same account's
existing authenticated encrypted mail-token cache. Existing grant records always
win; Calendar credentials are not used. This records historical cached scope
metadata and does not assert fresh remote consent or current provider validity.
See [the migration](../api/MAIL-GRANT-MIGRATION.md).

## Applied source and offline checks

The applied version passed **444 API tests, 385 frontend tests, production build
and strict types** using Node 24.22.1. Tests use synthetic databases and mocked
providers. The public hoisted-dependency test needed a fixture-only correction:
its original assumption that API/node_modules exists failed in the actual npm
workspace. Actual parser tests already passed. The corrected fixture resolves
the installed parser package roots and retains real five-format extraction,
unrelated-filesystem denial and unusual-path controls. Its SHA-256 is
`da3138e4e152aa74d2d08f558baff6cc0329da85463cfd28c6a077e833eef4ea`.
The earlier 442/444 result remains retained.

The applied 223-file source/config/test/document archive has SHA-256
`750118422ce0ddccb41fa6d2c6a5ee75b03c860e178f3716e91aa5bbf9849f53`.
It excludes private data, credentials, captures, vendor modules and fonts. The
root workspace lock pins the parser dependency tree; the private standalone API
lock was excluded from the monorepo application.

The stopped-server SQLite backup passed quick_check. After restart, read-only
checks required **18 draft records, three Calendar operations, four encrypted
credential records and three prior grant records to remain byte-identical**.
Exactly one absent historical mail grant was adopted from its cached mail
scopes. Delivery-attempt counts did not change, and the new Knowledge/composer
delivery/acceleration tables were empty. The audit itself made no writes.

## Browser checks

The applied-source regression `20261028T213713Z` passed **16 cases/407 steps**,
all eight persisted assertions, zero page errors and owned-browser cleanup.
All 126 manifest entries remained unchanged. App SHA-256 is
`f1d6878d618573f0a55cc069647b881060bc16acbb309c47fe3bfb494cefd040`.
Reply-all retains missing events and equality_eligible=false; its exact
POST/201 request assertion passed. Complete capture sections on other cases
still do not establish equality with the original. Exact IDs are recorded in
[the scenario ledger](scenarios/README.md).

A separate synthetic combined workflow passed **55 steps**:

- `ev_47f8299747ea6f2cc479f8fcf7ec6643037146543a71d30f46b62bc9a00faa67`
  created a labelled owned draft and inspected Knowledge controls in 16 steps.
- One separately journalled raw API upload processed the public 219-byte
  fictional Cedar fixture. This stage does not prove browser file selection.
- `ev_ce7372cdb3d31e0a63a5f8f45d2eceb95c548206501512c83a50db5a7c1c24f8`
  completed 39 steps: metadata Save, scoped Download-link inspection,
  personalization dirty Keep/Discard/Save and exact draft reopening.

Read-only postchecks required unchanged source contentVersion/bytes, metadata
revision +1, saved personalization revision 1 and the same complete draft
content. All seeded record hashes remained unchanged. Credentials, provider
delivery, Calendar and model operations were disabled/empty. A Download GET
verified the original bytes in memory; no browser Download activation is claimed.
Both captures have incomplete event coverage and equality_eligible=false.

This workflow preceded only the reviewed root dependency-lock transition: its
historical source hashes are preserved separately from the applied lock. All
private API/web source bytes remained the same; the public test-fixture
portability correction is separately identified above.

## Continuing gaps

The existing 22 feature families remain open. Team sharing/collaboration,
tracking, CRM, automated triage/drafts, learned voice/dictation, full split/search
semantics, offline editing, hosted multiuser operation and complete visual,
accessibility and performance comparison remain incomplete. A deleted Knowledge
source after a lost action acknowledgment can leave the current client's journal
uncertain; a separately reviewed receipt-based candidate is in progress.
Public-link crawling/live refresh and inline Knowledge context remain gaps.
No broad feature family is marked verified from these checks.

## Real Claude retrieval and existing-answer navigation

One explicit paid turn over a separately copied synthetic database used exactly
`resources:['knowledge']`, no selected mail thread and no real-mail context.
The question named the owned file but did not provide its answers. Claude made
three upstream dispatches: Knowledge search, full-text read and the final answer.
It correctly answered Thursday at 3 PM, three samples and Amber Finch, citing the
offered full-text receipt. No draft preview, delivery or Calendar action occurred.

The original driver stopped on its samples-presence regex because the answer
said “Samples: Bring three.” The failed report and frozen helper remain failed
and unchanged. A separate hash-bound semantic review and read-only postcheck
confirmed all three facts, the actual search/read events, served citation,
available scoped source and unchanged records/Knowledge/preferences. It made
one resolver GET and zero model requests. The generic answer truncated flag
remains true and is not erased or attributed to an unmeasured cause.

`ev_92b3c1a118605370e3be25f6ceec57b11d899094ff28e60d74307ebf52264edf`
then completed 17 browser steps restoring the exact existing answer, opening its
cited source editor and returning to the answer. All 106 runtime entries and the
read-only ledger stayed unchanged, including the three dispatches. No new
question was submitted. Capture events remain incomplete/equality-ineligible.
The paired original factual observation is
`ev_44644552eac4cb4b0af8c0fb5d5b2c42c7b2d26ec8bc37fde9b863c57241629a`;
original source navigation is
`ev_fb1dfed8ff8dc554a60b3e5fa4190e49822a65c7b882e4b3129b50a90b688c2b`.
This supports the bounded fictional TXT retrieval/navigation comparison, not
full Knowledge, model-output or parser parity.

## Actual local browser file selection

After specific user approval, the documented in-app browser filechooser flow
selected the public 219-byte fictional TXT into the separate provider-disabled
demo at 127.0.0.1:5174. Exactly one durable source request and one ready source
were stored. A read-only check verified the actual stored blob's 219-byte length
and SHA-256 against the public fixture. All 112 pre-existing demo record hashes
remained identical; model/delivery/credential counts stayed zero. The earlier
Chrome plugin attempt was denied before file access because its configured
workspace roots differed; it did not upload and was not replayed.

This chooser proof uses browser control plus SQLite, with no REA Evidence ID
for that action. The UI/file selection, raw API workflow and original native
upload retain distinct provenance. Control transport duration is not a measured
application latency. Boundary files, multi-selection, drag/drop, file cancellation
and full original uploader behavior remain open.
