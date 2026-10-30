# Protected hosted beta checkpoint

The browser app and persistent backend now run on Vercel at
[rea-superhuman-generalgc.vercel.app](https://rea-superhuman-generalgc.vercel.app/).
Vercel Authentication remains enabled. This is an incomplete beta for feedback,
not completed Superhuman parity; all22 feature families remain open/unverified.

## Actual runtime

HB-20261030-01: Reviewed runtime source38883aa builds and is promoted. The
corrected worker creates224 mail schema objects and completes the three retained
bootstrap/health GETs. All six pre-existing synthetic source records remain
exact. No hosted credentials or OAuth states exist at that observation.

The initial post-promotion inspection still reported the previous worker image.
Root's resume command incorrectly ran despite that failed identity check; Root
immediately restored zero scaling. Subsequent complete platform reads identify
the corrected image, with zero instances after the full original120-second
grace. The brief start actually used the corrected deployment and acquired the
third owner, completed only those queued reads and quiesced cleanly. No further
exceptional recovery or request replay was used. These observations preserve
the sequencing mistake rather than treating the failed check as success.

HB-20261030-02: Only after the corrected image/zero-state verification did Root
resume the approved one-GiB iad1 worker. The fourth owner is active on that
deployment; two primary observations more than50 seconds apart show advancing
heartbeats. The platform reports exactly one desired/ready/total instance. The
authenticated canonical browser renders the demo Inbox and saves/reopens an
owned recipient-free draft.

## Actual attachment path

HB-20261030-03: The user approved one named ten MiB dummy fixture, its unsent
demo draft and guarded cleanup. The browser extension's file chooser reports
that file-URL access is unavailable. The native Chrome picker selects only the
approved exact path and completes the upload without broadening that permission.
The actual Core saves the attachment and the browser displays10240KB.

The download watcher times out after an unusually delayed browser call. A
separate filesystem inspection finds the newly created named download and
verifies its exact10,485,760 bytes and SHA256 against the prepared source:
`ad986b2e2d12ecbd9e2ff72a3492cc615692a6ab7a4adcb2363e09ef15196eec`.
No download retry is issued. Reopening the named draft retains its subject,
body and attachment identity. A scoped read-only primary audit confirms its
empty recipient field, saved revision and ten MiB stored attachment length.
The browser's delayed native accessibility views are supplemented with live
DOM observations for subsequent controls and receipts.

This exercises actual Function/Daemon private-body transport, private-store
access, native remote SQL persistence and browser download. It is not a proof
for every size/type, Gmail delivery, native middle/context click or simultaneous
transfer. The unrelated unsent demo reply is preserved.

## Release continuation

The default GitHub branch still needs the reviewed release, followed by its
normal Git-triggered deployment. Retain the owned draft/attachment baseline,
verify clean worker handoff and fresh-client persistence, then perform the
approved fixture cleanup. Registering the hosted Google callback is complete;
fresh hosted sign-in, real mailbox sync and hosted provider operations remain
separate checks. Existing local-account tokens have not been copied.

The new interaction/Trash/Command combination is still private and unapplied.
Its source preparation and selected controls do not establish moving-pixel or
complete original parity. Licensed reference fonts are not published; the
hosted client uses its fallback fonts. Other remaining gaps are tracked in the
feature inventory and prior runtime records.

Source gates remain1044 API/781 frontend at their retained boundaries, with the
new remote correction passing156 focused hosting checks and strict types.
Captures, database audit values, fixture IDs and raw runtime records remain in
ignored private evidence directories; no real mail, tokens or credentials are
included in this checkpoint.
