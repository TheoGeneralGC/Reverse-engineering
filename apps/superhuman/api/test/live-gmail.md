# Controlled live Gmail check

This harness is prepared for the two account-owner-approved test addresses. It
completed one controlled live run; see [result](../../research/gmail-live-check.md).
It does not operate the original Superhuman
app, delete messages/drafts, alter user drafts, or schedule delivery.

The actual participant addresses live in the ignored
`.local/live-tests/approved-participants.json`, outside versioned source:

```json
{
  "authorizedBy": "user",
  "authorizedAt": "ISO timestamp of the explicit authorization",
  "participants": ["approved-sender@example.test", "approved-recipient@example.test"]
}
```

The placeholder addresses above grant no authorization. The current local
manifest records the pair explicitly provided by the user in this chat. The API
must have Google credentials, each tested sender must have authorized the replica
through OAuth, and both `APPROVED_TEST_SENDERS` and `APPROVED_TEST_RECIPIENTS` must
contain exactly that pair. Missing or additional senders/recipients block live
sends. The connected account's authenticated email must match its approved sender
entry, which is rechecked immediately before dispatch.

From the monorepo root, with the local API on `127.0.0.1:3001`:

```sh
# Read-only API preflight and a locally recorded plan. No draft or send request.
node apps/superhuman/api/test/live-gmail.mjs

# Deliberately send at most one initial benign test message per connected
# approved sender to the other approved participant, then check receipts.
node apps/superhuman/api/test/live-gmail.mjs --send --run-id approved-check-001

# Continue bounded synchronization/receipt checks for that same run. No sending.
node apps/superhuman/api/test/live-gmail.mjs --verify --run-id approved-check-001
```

Default plan mode performs only GET requests and writes local metadata. `--send`
is the only mode that creates drafts or calls delivery. The unique subject/body
include the run ID. Existing run state is reused, so each sender gets one initial
message per run. Before sending, the harness durably records its attempt; an
interruption, error, or ambiguous API result is never automatically retried, even
if `--send` is run again. Resolve an unknown attempt through the replica's Sent
reconciliation flow. Do not create a new run just to retry an uncertain delivery.
Immediately before dispatch the harness re-reads the draft and checks its account,
recipients, subject, exact synthetic body, empty attachments, and `draft` status.
A changed draft is preserved and blocked from submission.

The directory `.local/live-tests/<run-id>/` holds private `state.json`, draft and
provider IDs, and receipt metadata, with private file modes. A per-run lock prevents
overlapping invocations. A crash may leave `run.lock`; inspect the recorded PID and
confirm no harness remains before manually removing that lock. Removing a stale
lock does not reset the durable send marker or authorize another message.

Recipient verification requires both accounts connected. It performs at most
`--polls` (default 3, range 1–5), each with `--sync-passes` (default 2, range 1–5),
separated by `--interval-ms` (default 2000, range 0–10000). A sync request can itself
take time to process the backend's bounded page budget. A recipient that is not
connected reports `recipient-unconnected`; a partial initial mailbox import reports
`waiting-for-mailbox-sync`. Either result is unresolved, not evidence of a delivery
failure. A receipt is confirmed only when a locally synchronized exact-subject
message has the expected sender, recipient, and unique run ID in its plain text.

The plain smoke mode is a controlled delivery/synchronization check. It does not establish rich
MIME equality, original Superhuman parity, tracking, scheduling, contacts, calendar,
or complete-mailbox synchronization. Do not commit its private run data.

## Planned rich MIME and attachment check

The additive `--rich` mode plans exactly **one** synthetic message from the first
sorted approved participant to the other participant. It uses a new run identity;
the completed `gmail-smoke-20261027-01` record is preserved. Rich and plain run
states cannot be mixed. `--rich --send` requires an already saved, reviewed plan
and a named run, so it cannot silently create and dispatch a fresh run.

Prepared plan: `.local/live-tests/gmail-rich-mime-20261028-01/state.json`.
It was created using only `GET /api/provider/status` and `GET /api/accounts`.
It records one planned message, zero drafts, zero send attempts, both accounts
connected, and the exact two-participant delivery boundary ready. The private
plan contains the full synthetic plain/HTML alternatives, attachment bytes and
hashes, plus private participant/account identities. File mode is 0600.

The fixture contains distinct plain and HTML markers, formatting/list elements,
UTF-8 `café — 東京 😀` text, and one 94-byte UTF-8 text attachment with a Unicode
filename. Its run ID appears in the subject, both alternatives, and attachment.
The saved plan's actual content/bytes and declared hashes must all match the
immutable fixture before any draft is created. No remote images, tracking pixels,
CC/BCC, existing provider draft, or existing thread is involved.

From the repository root, using Node 24.22.1:

```sh
# This step is complete. Only GET preflight plus private plan-file writes.
node apps/superhuman/api/test/live-gmail.mjs --rich --plan-only \
  --run-id gmail-rich-mime-20261028-01

# Proposed next step for the parent/operator after backend restart and review.
# Creates one new harness-owned local draft, uploads the fixture, then sends once.
node apps/superhuman/api/test/live-gmail.mjs --rich --send \
  --run-id gmail-rich-mime-20261028-01

# Continue only bounded receipt verification; never creates or sends mail.
node apps/superhuman/api/test/live-gmail.mjs --rich --verify \
  --run-id gmail-rich-mime-20261028-01
```

**No rich message has been sent while preparing this plan.** The second command
is a proposal for the authorized operator, not an instruction to repeat a send
after an uncertain result. Existing user authorization covers only the two exact
private participants; the API's sender/recipient allowlists are rechecked before
dispatch. Calendar approvals and API keys have no role in this test.

The harness validates draft identity/route/body/HTML before uploading anything,
so a changed or existing user draft is preserved. It then requires exactly one
matching attachment, downloads it from the local API, and checks exact bytes.
Before send, it re-reads that exact draft, checks no delivery is queued, and
compares all fixture fields/metadata again. It never imports/synchronizes a
provider draft. An interrupted attachment upload is reused only when the same
draft's metadata and downloaded bytes prove it is already the exact fixture;
an unresolved upload is blocked.

State writes use an fsynced temporary file, atomic rename, and directory fsync
before external dispatch. A durable `sendStartedAt` marker prevents a second
send after process interruption, transport error, or ambiguous API result. The
backend's delivery Message-ID is recorded through its exact draft GET route.
Missing identity or unknown delivery stays unresolved. The harness never clears
attempt markers, automatically reconciles, or starts a replacement run to retry.

Receipt verification requires exactly one matching counterpart message and:

- Exact sender, sole recipient, empty CC, subject, and recorded delivery Message-ID.
- Exact decoded plain-text bytes and exact decoded HTML string.
- Exactly one attachment with the planned Unicode name, type and byte length.
- A safe `attachment`/`nosniff`/`no-store` download with the expected filename.
- Exact downloaded attachment bytes and SHA-256 digest.

Content mismatches, duplicate receipts, and download errors are recorded as
failures/unresolved states, never delivery success. Checks and actual/expected
hashes are saved privately; unrelated mailbox content is never printed.

This compares the Gmail adapter's decoded MIME alternatives and downloaded
attachment to the fixture. It does **not** fetch raw wire MIME or claim an exact
wire hierarchy comparison; the multipart mixed/alternative structure and UTF-8
encoding are covered by offline MIME tests. It does not establish original
Superhuman behavior or visual/rendering parity.

Six offline harness tests cover planning/mutation separation, fixture integrity,
protection of changed drafts, exact receipt assertions, and the approved pair
boundary. They run with the normal API test suite and require no credentials.
