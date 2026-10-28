# Delivery identity and unknown-send reconciliation

New delivery attempts persist a random 192-bit opaque
`X-Reconstruction-Delivery-ID` before any provider send request. The same value
is stored on the draft (`deliveryMarker`) and immutable attempt (`marker`). MIME
generation validates the 32-character base64url value and places it only in that
header, not visible body/subject content. Attempt state is committed before
network dispatch; interrupted or ambiguous sends remain `delivery_unknown` and
are never automatically resent.

The requested RFC `Message-ID` remains an audit field (`draft.deliveryMessageId`,
`attempt.messageId`). It is **not** delivery proof. An acknowledged Gmail resource
ID is stored separately as `providerMessageId`; a final provider RFC header, when
read successfully, is stored as `providerInternetMessageId`. The requested ID is
never replaced with the final header.

After a valid send acknowledgment is committed, a queued metadata-only GET can
record the provider's final RFC ID and whether the opaque header survived
(`deliveryMarkerVerified` on the draft, `markerVerified` on the attempt). Failure
of this optional read never downgrades an acknowledged send, resubmits it, or
starts authentication. Server shutdown waits for owned work before closing SQLite.

## Explicit unknown reconciliation

`POST /api/drafts/:id/reconcile` remains a provider-read-only action. It checks:

1. The persisted attempt/draft IDs, requested RFC audit ID and opaque markers agree.
2. The authenticated Google profile email matches the selected account.
3. A bounded Sent list starts two minutes before the recorded attempt time,
   allowing modest clock skew. No subject/body/RFC-ID similarity is used as proof.
4. Each candidate is fetched as metadata with only `From`, `Message-ID`, and
   `X-Reconstruction-Delivery-ID` headers. Its resource ID must match, its labels
   must include `SENT`, and its sole From mailbox must match the account.
5. Exactly one header with the exact opaque value exists on exactly one distinct
   candidate, and the bounded candidate scan completes.

The bound is two list pages of 25 entries, at most 50 distinct candidate metadata
reads plus one profile read. Existing Gmail GET pacing and bounded retries apply.
Duplicate list IDs count once. Two distinct marker matches stop the scan and
remain ambiguous. An unchecked next page, malformed/unavailable candidate, account
mismatch, missing marker, duplicate marker headers, or provider read failure leaves
the attempt unknown. Empty results do not imply a send failed.

Legacy unknown attempts without an opaque marker remain locked without any
provider search. They are not upgraded using their old RFC ID or matching
subject/body. Inspect them manually; removing a marker/lock or creating a new
draft is not an automatic recovery strategy.

The additive response fields are:

```ts
{
  resolved, matches, scanComplete, scannedCandidates, reason, draft, message?
}
```

`matches` can be a lower bound when scanning stops early. Only
`resolved:true`/`reason:'verified'` completes the draft. Unresolved reasons include
`legacy_attempt_unverifiable`, `attempt_identity_unverified`,
`account_identity_unverified`, `no_marker_match`, `multiple_marker_matches`,
`scan_limit_reached`, `provider_read_failed`, and `invalid_candidate`.
No reconciliation branch writes to the mailbox or sends a message.

## Evidence and limits

A single controlled rich-email run on 2026-10-28 confirmed that the requested RFC
header was replaced in Gmail's Sent copy and the recipient copy, while the two
final headers matched each other. The requested ID was absent from the Sent raw
message. This observation invalidates relying on that requested header for
reconciliation; it does not establish an unconditional Gmail rewriting policy.

The same run preserved the exact submitted 222-byte plain alternative and
319-byte HTML alternative in the Sent copy. Delivered wire contained a regenerated
248-byte plain alternative based on HTML and the original HTML plus one CRLF
(321 bytes); its 94-byte UTF-8 attachment stayed exact. Independent raw-MIME
decoding and Gmail `full` payload normalization both matched the stored recipient
data. The parser was faithful. The original strict fixture **remains failed** for
body/header equality, and no normalization was used to convert that result to a
pass. Private raw evidence and original assertion hashes remain ignored.

On 2026-10-28, the operator ran one separately reviewed synthetic marker probe,
`gmail-delivery-marker-20261028-01`, and received a confirmed send acknowledgment.
The read-only helper then copied only that confirmed draft/attempt/account/token
into memory, removed its known provider IDs there, and simulated an unknown state.
Three Gmail GETs (profile, one bounded Sent list, one metadata candidate) found
exactly one opaque marker with matching account/Sent identity and a complete scan.
The independently discovered resource ID equalled the saved acknowledgment; its
final RFC header also matched the separately stored provider header.

The helper used a read-only live database connection and made zero live record
writes, sends, refreshes or blocked requests. Its memory draft remained unknown
and the original run state file stayed unchanged. The private source-hashed report
is `.local/live-tests/gmail-delivery-marker-20261028-01/marker-readonly/report-20261028T034550741Z-456646c8.json`.
This proves marker retention and lookup for **one controlled sender's Sent copy**,
not every Gmail route or recipient header. It did not force a real ambiguous send;
the crash/timeout state transitions remain mocked verification.

The earlier `gmail-rich-mime-20261028-01` strict body/header comparison remains
failed, with its baseline assertions and wire evidence unchanged. The new marker
proof does not turn that rich-byte mismatch into a pass. If a provider strips the
opaque header, removes Sent membership, returns multiple candidates, or cannot
complete the bounded scan, reconciliation still returns unresolved without a
weaker fallback. This is not original Superhuman parity or complete Gmail semantics.

Protocol references: Google's [Message resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages)
defines immutable Gmail resource IDs and raw/parsed payloads; [GET formats](https://developers.google.com/workspace/gmail/api/reference/rest/v1/Format)
distinguish metadata, full and raw responses; [send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send)
returns a Message acknowledgment. None of these contracts is treated as a promise
to preserve a caller-supplied RFC header.

Explicit AI artifact Send now links its immutable queued Draft and operation to
these same attempt/ACK/unknown/reconciliation transactions; it does not add a
model mutation tool or a second delivery transport. Its scope, generation locks,
owner recovery and offline gates are in [AI-SEND.md](AI-SEND.md). Live replica
artifact Send remains held while the original Undo window is investigated; the
controlled marker proof above remains a separate earlier delivery check.
