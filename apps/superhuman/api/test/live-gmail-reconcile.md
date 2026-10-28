# Read-only delivery-marker probe

This helper passed one scoped live marker lookup on 2026-10-28, after the operator
separately dispatched one reviewed synthetic send. It never creates/plans messages,
sends mail, updates a live attempt/draft, refreshes
OAuth, or changes a mailbox. Root/operator dispatches any separately reviewed
message first. The helper accepts only an **already confirmed**, harness-owned
synthetic rich run with an opaque delivery marker and the current exact approved
sender/recipient pair.

The old `gmail-rich-mime-20261028-01` strict content mismatch stays unchanged. It
has no opaque marker and cannot validate the new protocol. Do not retry that send,
reset its state, or change its expected body/header assertions.

After the operator's separately reviewed **one** marker probe has completed and
its acknowledgment is recorded, from the repository root with Node 24.22.1:

```sh
# Optional local eligibility/token readiness inspection; no network.
# Here plan-only describes reconciliation inspection, not an email plan.
node --experimental-strip-types apps/superhuman/api/test/live-gmail-reconcile.mjs \
  --plan-only --run-id gmail-delivery-marker-20261028-01

# Provider GETs only, against the same already-confirmed controlled send.
node --experimental-strip-types apps/superhuman/api/test/live-gmail-reconcile.mjs \
  --verify --run-id gmail-delivery-marker-20261028-01
```

The helper reads the exact draft, attempt, account and encrypted mail-token rows
through `DatabaseSync(...,{readOnly:true})`. It validates the immutable fixture,
exact route/attachments, confirmed status/provider acknowledgment, account and
attempt identity, and marker. It uses the local encryption key and current
approval settings without printing them. Missing/legacy markers, changed drafts,
unconfirmed sends, mismatched participants/accounts, or near-expiry access tokens
are refused before any provider request. No broad mailbox or attachment records
are loaded from the live database.

Only those records are copied into a fresh in-memory Store. The memory copies
become unknown and have known provider IDs/final RFC IDs removed, so reconciliation
must discover the marker rather than rely on the acknowledgment. Original records
remain confirmed/untouched. The helper calls the actual current reconciliation
implementation but does not apply its result, even to the memory draft.

Its fetch wrapper independently allows only authenticated HTTPS GETs to the exact
Gmail `/users/me` profile, bounded Sent query, and candidates returned by those
lists as metadata with `From`, `Message-ID`, and the opaque header. It rejects
OAuth endpoints/POST, sends, other accounts/hosts, raw/full bodies, arbitrary IDs,
changed query boundaries, and more than two unique list pages/50 candidates.
There is an additional hard ceiling of 60 HTTP GET attempts including retries.
The cached token must have over two minutes remaining; refresh attempts cannot
reach the network. Gmail pacing/backoff still applies.

A private 0600 report is atomically written under
`.local/live-tests/<run-id>/marker-readonly/report-*.json`. It contains source
hashes, marker digest, sanitized counts, memory/original statuses, run-file
integrity, scan outcome, and whether the independently found Gmail ID equals the
saved acknowledgment. It contains no tokens, header marker value, email addresses,
or message bodies. Standard output is also sanitized.

`markerProbePassed:true` requires one exact marker match, a complete scan, the
acknowledged provider ID, zero blocked requests, an unchanged original run file,
and an unknown memory draft. An unresolved check still writes its report and exits
with status 2; validation errors exit 1. Neither result authorizes another send.
Plan-only performs no provider proof and reports a null pass result.

Four offline tests verify eligibility/legacy refusal, absence of send/refresh
modes, independent network scope enforcement, and page/attempt bounds.

## Scoped live result

For `gmail-delivery-marker-20261028-01`, plan-only inspection used zero GETs. The
read-only verification then passed with three GETs: one profile, one Sent list,
and one candidate metadata read. It found one exact marker match, completed the
scan, and independently recovered the same Gmail resource ID as the saved send
acknowledgment. The final provider RFC header matched the known provider header.
There were zero blocked requests, sends, token refreshes, or live record writes.
The original record stayed confirmed, the memory draft stayed unknown, and the
original run state file was unchanged.

Private evidence:
`.local/live-tests/gmail-delivery-marker-20261028-01/marker-readonly/report-20261028T034550741Z-456646c8.json`.
The executed helper SHA-256 was
`a4cd1d433e5d749e4bcfe19890b6f6d8ab716aacedc9060f85dee808e24f38e3`.

This validates one controlled sender's Sent-marker retention and independent
lookup; it does not exercise a real timeout/crash, prove retention on all mail
routes or in recipient headers, or establish original-product parity. Duplicate,
absent and incomplete scans still require conservative unresolved handling.
The earlier rich plain/HTML/requested-header equality failure remains unchanged;
this marker-specific result is not a whole-rich-message byte-equality pass.
