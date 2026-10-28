# Controlled Gmail integration checks — 2026-10-27–28

Both explicitly approved participant mailboxes authorized the local replica
through Google OAuth with `gmail.modify`. The app remains External/Testing in
project `re-superhuman-20261027`. Gmail API activation, the exact loopback
callback and the saved Data Access scope were verified in Cloud Console.

The first import failed with HTTP 403 `rateLimitExceeded`. Bounded read-only
probes confirmed that labels, profile and listing worked and full-thread reads
were being throttled. This was a provider quota observation. The adapter now
paces reads, checkpoints individual threads, uses bounded GET backoff and
prioritizes new-mail history while the full import continues. The current
[Google quota table](https://developers.google.com/workspace/gmail/api/reference/quota)
and [error guide](https://developers.google.com/workspace/gmail/api/guides/handle-errors)
support the cost model and failure classification.

These observations concern the local replica and its Gmail adapter, not the
original Superhuman application. New records below use UTC timestamps and keep
private addresses, provider IDs, credentials and raw captures outside this file.

## Two-way plain smoke result

The controlled harness ran with `--send --run-id gmail-smoke-20261027-01` after
read-only preflight confirmed both approved sender/recipient lists and connected
accounts. It created only its own clearly labeled synthetic drafts, then sent
one message in each direction between the approved participants.

- Messages planned: 2.
- API-confirmed sends: 2.
- Recipient messages synchronized and matched by exact subject, sender,
  recipient and unique run marker: 2.
- Unknown outcomes requiring reconciliation: 0.
- Unconnected participants: 0.

Run state, provider message IDs and receipt metadata are retained privately in
`.local/live-tests/gmail-smoke-20261027-01/state.json`. Actual participant
addresses, mailbox data and credentials are excluded from versioned records.
The existing run ID and durable send markers must be reused; this successful
check does not authorize duplicate test sends.

## Rich MIME result: strict comparison failed

Run `gmail-rich-mime-20261028-01` dispatched one separately approved synthetic
message with plain/HTML alternatives and a tiny UTF-8 attachment. The API
confirmed one send, with zero unknown send outcomes. One counterpart message was
found, but the strict receipt check remained **content-mismatch**:

- Sender, sole recipient, attachment metadata and downloaded attachment bytes matched.
- Requested RFC Message-ID, authored plain text and exact HTML bytes did not match.
- No assertion was weakened, attempt reset, replacement send or retry performed.

Three bounded read-only provider GETs inspected only that controlled message:
recipient `full` and `raw` responses, then the exact acknowledged Sent resource
as `raw`. Independent raw-MIME decoding established:

| Decoded content | Planned fixture / Sent copy | Recipient wire |
| --- | --- | --- |
| Plain alternative | Exact 222 bytes, base64 | 248 bytes, quoted-printable; HTML-only marker present and authored plain-only marker absent |
| HTML alternative | Exact 319 bytes, base64 | Original HTML plus one CRLF: 321 bytes, quoted-printable |
| Named UTF-8 attachment | Exact 94 bytes, base64 | Same 94 bytes and SHA-256 digest |

Both wire copies retained `multipart/mixed` with a `multipart/alternative` body
and separate named text attachment. Gmail's `full` payload, the adapter's decoded
fields, and the independently decoded recipient raw MIME agreed exactly. The
stored draft matched the planned plain/HTML content. The Sent copy preserved
those bodies; the delivered copy changed afterward. The marker difference is
consistent with plain text regenerated from HTML along this delivery path.
The exact transforming stage and a universal provider policy were not isolated.
This is not evidence of a backend body parser defect.

The final RFC Message-ID was already different in the Sent copy, and matched
between Sent and recipient copies. The requested `reconstruction.invalid` value
was absent from the Sent raw message. This exposed an unsupported assumption in
the former requested-ID reconciliation strategy. Requested IDs are now immutable
audit data; final provider IDs are stored separately, and new attempts use an
opaque `X-Reconstruction-Delivery-ID` for conservative Sent identity proof.

The original outgoing HTTP request was not captured. A reconstruction from the
stored controlled draft verifies the planned MIME semantics, but its newly
generated random boundaries are not the original wire request. Raw messages,
original assertion hashes and sanitized comparisons remain private under
`.local/live-tests/gmail-rich-mime-20261028-01/diagnosis/`.
The unchanged run-state SHA-256 is
`150c7998c3e66dba867e10449b98e31195f957787ea0711ef36007a80199b5fd`.

## Opaque marker lookup: one scoped read-only live proof

A separate reviewed run, `gmail-delivery-marker-20261028-01`, sent one synthetic
marker-bearing message and received a confirmed acknowledgment. It was a new
marker-specific probe, not a retry or reset of the rich-content failure.

At `2026-10-28T03:45:50.739Z`, the isolated helper read the exact confirmed draft,
attempt, account and encrypted mail token through a read-only database connection.
It copied them into memory, removed the known provider IDs there, and simulated
an unknown delivery state. Its preceding plan inspection made zero network calls.
The verification result was:

- Three Gmail GETs: one profile, one bounded Sent list, one metadata candidate.
- One exact opaque header match, matching account/From/Sent identity, with a complete scan.
- Independently found Gmail resource ID equalled the saved acknowledgment.
- Final provider RFC header equalled the separately stored provider header.
- Zero blocked requests, sends, token refreshes or live record writes.
- Original live status remained confirmed, memory status remained unknown, and the run file was unchanged.

The helper did not apply the result to live records. The private source-hashed
report is
`.local/live-tests/gmail-delivery-marker-20261028-01/marker-readonly/report-20261028T034550741Z-456646c8.json`.
The executed helper SHA-256 was
`a4cd1d433e5d749e4bcfe19890b6f6d8ab716aacedc9060f85dee808e24f38e3`.
See the [delivery protocol](../api/DELIVERY.md) and
[read-only probe contract](../api/test/live-gmail-reconcile.md).

This verifies one sender's Sent-marker retention and independent lookup. It does
not force a real timeout/crash, prove retention on all routes or in recipient
headers, or establish complete unknown-send recovery. Duplicate, absent,
malformed, legacy-unmarked and incomplete scans remain unresolved. The rich
plain/HTML/requested-header equality failure above remains failed; this marker
result is not a whole-rich-message byte-equality pass.

## Later initial-import health snapshot

At `2026-10-28T06:34:49.737Z`, read-only sync-health GETs returned HTTP 200 for
both connected participant accounts. Each reported `phase=history`,
`partial=false`, `status=ready`, `failureCount=0` and `requiresReconnect=false`.
Their latest completed sync timestamps were `06:34:45.862Z` and `06:34:48.758Z`.
Thus the adapter reported initial import complete by this later checkpoint;
the partial-import delivery observations above retain their earlier timing.

The private metadata-only audit is
`.local/audits/gmail-initial-import-complete.json`, SHA-256
`e38d9d6f1e755cf1c574614cb140c1a56db4ed172ddec829ad9d916e068754c0`.
This is reported pipeline health, not an independent count-by-count comparison
with all provider mail, a perpetual readiness guarantee, or original parity.
No additional delivery or mailbox mutation was performed for this audit.

## Coverage limits

The plain smoke establishes two-way delivery and receipt through the replica's
real Gmail adapter, including new-mail catchup during partial initial import.
Full mailbox backfill was still in progress at that checkpoint. These checks do
not establish complete historical
coverage, original Superhuman equivalence, rich MIME equality, live scheduling,
push notifications, all failure recovery, calendar, Outlook or team features.
These checks operated through the replica, created only authorized synthetic
drafts/messages, and preserved existing user drafts.
