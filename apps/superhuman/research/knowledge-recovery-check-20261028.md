# Knowledge receipt recovery checkpoint

Recorded 2026-10-28. This is a bounded replica check of a local recovery policy,
not an observation of Superhuman's private API or full Knowledge parity. The
earlier [444 API/385 web checkpoint](combined-checkpoint-20261028.md), its
16-case/407-step regression and its 55-step synthetic workflow retain their
original source identities. The file chooser, raw API upload and browser
recovery checks below have separate provenance.

## Source, offline gates and main rollout

The recovery version passed **456 API tests, 398 frontend tests, build and strict
types** on Node 24.22.1. Tests use isolated synthetic databases and mocked
providers; 96 actual-App tests are included in the frontend count. Four
independent API recovery cases and nine independent frontend cases are included
in those totals. Four separate actual in-memory API-to-browser-parser checks
also passed.

| Retained identity | SHA-256 |
| --- | --- |
| API456 freeze manifest | `ce3a38d5dbcd57836bcdab2d111e3d7fef891c4201e19d700cd212b27c5f8ae9` |
| Web398 freeze manifest | `cd715597830c026893a201e8e007c5d5db1500bb15b08106640af242b5d83f1f` |
| Knowledge action receipt validation | `179e214cb6b61c09a24d03d6193d46c3de6ad87fe81833be86d061a28c7c1c36` |
| Knowledge frontend model | `fd8aa5fc361c641808615fb8261ffc1c624efb0b3fa9ab2f23d87fd11084b373` |
| Knowledge source editor | `02b467dcea68dd455bb8b3583a27ae3d0296e0a27ad299bd674d181dc6b411c1` |
| App, unchanged from the earlier combined version | `f1d6878d618573f0a55cc069647b881060bc16acbb309c47fe3bfb494cefd040` |

The root-controlled main rollout changed no dependencies and first retained a
709,439,488-byte stopped-server backup. Its subsequent read-only audit required
**18 Draft JSON records, three Calendar operations, four sealed credentials and
four grant records to remain byte-identical**. Delivery attempts were unchanged;
the new receipt/key tables were empty. Main had no Knowledge sources at this
audit. The audit used SQLite `mode=ro` and made zero write statements. This main
data audit is separate from the copied synthetic database used below.

## Controlled acknowledgement loss and browser remount

The test copied the earlier synthetic Knowledge/personalization workflow into
an isolated provider-disabled database. A terminal-controlled raw upload was
accepted once and its acknowledgement deliberately withheld. An explicit
test-only action deleted only that new disposable source. The browser was then
launched with the matching pending journal seeded before application startup.
This does **not** prove an in-browser upload failure or file chooser action.

`ev_c1bd5e267a284bd16544e8c3801e144d227455b4375761b2984eab53070ca040`
completed **9 steps**. The frontend issued the exact old-key GET and settled the
accepted action using its immutable receipt and deleted-target resolution.
One subsequent explicit raw upload with a fresh key created a distinct source
and receipt; the old key still resolved its original deleted target. Across the
workflow there were **two raw upload POSTs and one guarded disposable DELETE**,
zero model POSTs, no configured providers and no delivery/Calendar operations.
There was no automatic POST retry or cleanup.

Read-only postchecks required byte-identical original source/blob/chunk records,
logical FTS rows, personalization and typed draft state. The original synthetic
fixture was not deleted. All 107 runtime source/configuration entries stayed
unchanged; the historic 55-step workflow inventory is retained separately.
Chromium 156.0.8078.48 was launched by pinned REA 6.8.0 and terminated through
owned-process cleanup. Event coverage is incomplete, with `events` missing and
`equality_eligible:false`; completed actions and independent state checks have
their stated scope.

The earlier attempt remains failed before upload intent: comparing SQLite FTS
rows with null prototypes against JSON-deserialized plain objects falsely
reported drift. It performed zero POSTs, zero DELETEs and created no source or
receipt. A separately retained helper version normalized row prototypes without
changing values and added a JSON-roundtrip control before the new attempt.

## Read-only editor focus and layout

`ev_4523116ab474afbe7776f758eb1158a7751052c3f55ff384f7e29931fdb0cb11`
completed **7 steps** opening the protected synthetic source. The Name input
received initial focus. The retained 1280×964 screenshot shows Updated and Owner
in equal-width columns. Hashes of records, sources, blobs, requests, jobs,
chunks, action receipts/keys, AI dispatches and Calendar operations stayed
unchanged. The review recorded zero observed writes, not absence of all requests.

This capture is complete and equality eligible, with owned-browser cleanup;
eligibility is not an equality result. No pixel equality is claimed, and the
effective viewport of the retained original remains uncertain. Screenshot
SHA-256 is `1fccfa6475ec35899a1d4ec75e2fee7365dedba2ffeccbf2b41717bd095bddf9`.

## Limits and retained reports

The separate actual browser chooser proof used the public 219-byte fixture in a
provider-disabled demo; it did not inject an acknowledgement loss. The original
native upload and retrieval observation is in
[knowledge-base-runtime.md](knowledge-base-runtime.md). Original lost-ACK,
deleted-key recovery, revision conflict and broader format/boundary behavior
remain unobserved. Team sharing, public-link crawling/live refresh, OCR, inline
Knowledge and complete visual/accessibility parity remain open.

Private report hashes, with no source contents or identities published:

| Report | SHA-256 |
| --- | --- |
| Recovery attempt02 | `2086727a29a0f033117f2fb163f9c19a212a34f7804f4d5c57aee5232152cfde` |
| Read-only editor review | `87ce11775b323ad603e98e5c07a1e5adb1cf49ca3f5868d710f002a8cbf815b6` |
| Preserved failed attempt01 | `e0f398edcbb4cb51c4748a34d6169b9da942cffc9974b2228c0cde8fa21eb624` |
| Main rollout integrity audit | `dd39db01280af9e58ec9b08f35410d309b5276ed2e184756022761aec5dda8a4` |
