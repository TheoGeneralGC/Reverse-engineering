# Controlled tracked delivery and anonymous fetch — 2026-10-29

One newly owned rich message completed a native mapped Gmail Send, collector
confirmation, one explicit anonymous pixel fetch and one explicit read import.
The sender copy preserved both authored body alternatives. The recipient copy
failed strict plain-text and HTML equality. The retained result is
`tracked-delivery-read-proof-with-recorded-body-differences`; it is not a fully
passing content-equality result or evidence that a person read the message.

This extends the [hosted collector checkpoint](vercel-deployment-checkpoint-20261029.md).
The earlier [controlled mapped Send](mapped-send-live-check-20261029.md) used a
different source and fixture; its failed recipient assertion remains historical.
Neither record verifies original Superhuman read-tracking parity.

## Execution boundary

Root executed the reviewed V3 harness once against the final 449-file candidate
(251 API, 193 web and five collector reference files). Its source manifest is
`b96be79042636270de09d4b1987940fa5632b8a5bc1462c31b44144ae1b26e3b`.
The helper freeze is
`cef337609f871052a6a128f7caa49cae86dced114941ce0da506b54f123c9a82`;
independent review cleared that successor before execution. The private fixture
digest is `5e2465761708637231e56e0b30bb37b861bf3eab79d761c11e8483c8c366a018`.
No addresses, credentials, raw messages or private fixture contents are published.

A new isolated database received only the two approved MAIL account seeds from
a read-only Main connection. Both authenticated profiles matched the approved
pair before creation. Background jobs were disabled and model transport was
prohibited. Tracking preferences belonged to this isolated fixture. This did not
enable tracking in Main or change original Superhuman settings.

The newly authored fictional message had one approved recipient, no Cc/Bcc and
no attachments. The ordinary requested 10-second Send window elapsed without
acceleration. Dispatch used the persisted decorated MIME and its owned Gmail
Draft mapping, with no `messages.send` fallback. No retry, resend or cleanup
followed.

| Observed operation | Count |
| --- | ---: |
| Owned cloud Draft CREATE | 1 |
| Native mapped Send | 1 |
| Provider Draft UPDATE / DELETE | 0 / 0 |
| Collector prepare / arm / confirm | 1 / 1 / 1 |
| Explicit anonymous pixel fetch | 1 |
| Explicit read import / collector event page | 1 / 1 |
| Cached anonymous events | 1 |

All 12 Google responses were HTTP 200: four profile reads, one create, one owned
Draft read, one Send, one sender metadata read, one sender raw read, two exact
recipient lookups and one recipient raw read. No token refresh was issued. The
three collector lifecycle responses and the event-page response were also 200.
The recorded response interval was 19:57:22.385Z–19:57:45.689Z on this date.

## MIME and read evidence

The observer used the acknowledged sender copy's actual Internet Message-ID for
the bounded exact recipient lookup. Sender and recipient copies had the same
actual ID, with digest
`cebf1e57c2c7acf9b0ea1e3a24e90579001d481e65ded92d66f0687c58186443`.
Both copies matched the exact From, sole To, subject and delivery marker, had no
Cc/Bcc or attachments, and contained exactly one owned collector pixel.

| Retained raw copy | Bytes | SHA-256 |
| --- | ---: | --- |
| Sender | 1,355 | `8b9346d37acdd93888d54264a144924e36780bd9acc1d72573fb18e5e6dffd0c` |
| Recipient | 7,767 | `86904457bd5be4d0628f151260fa8cbf76205967e18bd6ff17326d88fa8e6d2c` |

Sender plain and HTML alternatives both passed strict authored-content equality.
Recipient plain text had 100 characters versus the sender's 95 and remained
different after line-ending, outer-whitespace and collapsed-whitespace checks.
Recipient HTML had 270 characters versus 269 and differed only in outer
whitespace; trimming made it equal. Both HTML alternatives contained one each
of `p`, `b`, `i` and `img`, and their collapsed text matched. These diagnostics
do not change either strict recipient failure into a pass or establish the
cause of the differences.

The single explicit anonymous fetch used the pixel extracted from the
acknowledged recipient raw message. A separate signed import and event-page
check established one cached anonymous event and the correct opaque Sent target;
the image response alone was not the persistence oracle. `additionalFetch:false`
was observed in this run. Human-read verification and named-recipient identity
were false. Proxy or other automatic image fetching remains a limitation of
this evidence.

The execution report digest is
`bd94a699feb6164431141fe05f6c8a0069005f444fef779085677c82b7dda55c`.
The additional read-only raw diagnostic digest is
`9a6cc386c9092d8692083608a7c8f823815923679ab13ddea1ed661d390739e7`.

## Retained failures and remaining scope

The V1 and V2 preparations remain preserved. An initial fake-provider control
refused the actual owned-Draft minimal read until the allowlist was corrected.
V1 also lacked the required explicit pixel timeout and response bound. V2 added
those bounds, then independent controls found a deferred pixel-dispatch Stop
gap and an overly broad optional MAIL-refresh phase. V3 checks Stop and abort
inside the deferred callback immediately before transport and restricts refresh
to the profile preflight before writes. The unchanged peer controls and affected
fake core passed before this one actual execution. No earlier failed preparation
is relabeled as an actual successful run.

## Qualified Main comparison before combined rollout

The separate native read-only audit compared the newly retained backup with a
fresh Main transaction. Its sanitized report identity is
`b529bd1564cd3dddd663a08fe37c98218ce40645d557876b1a77f3ab1dbb3e7b`.
This is a new boundary; it does not reuse an older restart snapshot. Records
changed from **11,960 to 11,962**, with 136 tables and **zero schema additions**.
All 33 changed tables remain listed; strict all-table equality is **false**.

Both account records changed; two Threads were added and one changed, with two
sync-health and two sync records changed. All **20 prior drafts**, seven
attachments and all **four sealed ciphertext rows** stayed exact. Delivery and
provider ledgers, Undo, Calendar except `calendar_sync`, Knowledge/chat/manual
personalization and model-operation records, worker/model/settings records, and
tracking except its mail resolver stayed exact. Derived `ai_mail` data is not
included in the unchanged model-operation claim.

Mail/recipient/Split derived data, ingress/bridge/status, `calendar_sync` and the
tracking mail resolver changed while Main's normal synchronization could run.
These are observed differences, not a causal network trace. No normalization or
broad table exclusion made them equal. Both Responses states stayed off with
zero issued attempts/queued work and no activation; Main had zero persisted
tracking-preference rows. This qualification does not claim all Main rows were
unchanged or that the actual tracked test configured Main.

Main was still on API855/frontend680 with tracking unconfigured/off at that
post-test boundary. The subsequent [combined rollout](final-combined-checkpoint-20261029.md#applied-main-rollout-and-separate-restart-boundary)
is now applied with managed persistence and matched operator configuration, but
Responses/tracking desires remain off. Its jobs-off clock-only and 12-table
postrestart qualifications are separate; the isolated tracked test did not
enable Main preferences. The delivered fixture is retained.
Original tracking behavior, human-read detection, named-recipient attribution
and full parity remain unverified. See the [tracking research](read-tracking.md)
for the original evidence and its limits.
