# One controlled Calendar and Meet lifecycle

This harness is prepared for the user's explicit authorization of one synthetic
event between the private approved organizer and sole attendee, with Google
Meet, one edit, then cancellation/removal. One live lifecycle completed on
2026-10-28 UTC; its scoped provider results are recorded below and in
[the live check](../../research/calendar-live-check.md). Synthetic tests alone do
not prove live compatibility. The harness does not connect accounts, activate APIs, change
scopes, configure credentials, read `.env`, or operate a browser.

The approved payload is `REA test — calendar + Meet — <runId>`, five minutes on
October 30, 2026, 3:00–3:05 PM America/Los_Angeles (`-07:00`). It is private and
transparent. Its description says this is a synthetic authorized test, no action
is needed, and it will be edited and cancelled. The edit adds `(edited)` to the
title and a verification sentence to the description; it retains the interval,
attendee and Meet conference. Cancellation uses the same generated event ID.
Google's `sendUpdates=all` may send the approved invitation/update/cancellation.

## Required private approval

Root owns `.local/live-tests/calendar-approval.json`. The current reviewed shape
is `authorizedBy`, `authorizedAt`, `runId`, `organizer`, `attendees`, `calendarId`,
`titlePrefix`, `start`, `end`, `allowedActions`, `invitationUpdatesApproved`,
`maxEvents`, and `serverApproval`. The exact participants and single-event/action
limits are enforced in code. The exact pair must also match the separate private
`approved-participants.json` manifest. No actual address is embedded in public
source or tests; the sample below uses reserved example addresses.
`calendarId:null` or `serverApproval:null` allows
only an offline proposal; no API request is made.

After verifying the organizer's actual primary Calendar ID and narrowing the
deployed server configuration, root must fill:

```json
{
  "calendarId": "THE_VERIFIED_PRIMARY_ID",
  "serverApproval": {
    "accounts": ["organizer@example.test"],
    "calendarIds": ["THE_VERIFIED_PRIMARY_ID"],
    "attendees": ["attendee@example.test"],
    "verifiedAt": "EXPLICIT_ISO_TIMESTAMP"
  }
}
```

These three arrays attest the exact deployed `APPROVED_CALENDAR_TEST_ACCOUNTS`,
`APPROVED_CALENDAR_TEST_IDS`, and `APPROVED_CALENDAR_TEST_ATTENDEES`. The API does
not expose their values, so the harness can check this root attestation and the
live `writesEnabled` decision, but cannot independently read back the env lists.
Both connected identities must have all four approved Calendar service scopes.
The selected calendar must be primary, owner, and support `hangoutsMeet`.

## Explicit commands

Use the supported Node 24 runtime. The following is the completed run's command
sequence, retained for audit. It does not authorize repeating the lifecycle or
creating another run. Future tests require their own explicit authorization.

```sh
node apps/superhuman/api/test/live-calendar.mjs --plan-only --run-id calendar-meet-20261028-01
node apps/superhuman/api/test/live-calendar.mjs --step create --run-id calendar-meet-20261028-01
node apps/superhuman/api/test/live-calendar.mjs --verify --run-id calendar-meet-20261028-01 --polls 5 --interval-ms 2000
node apps/superhuman/api/test/live-calendar.mjs --step update --run-id calendar-meet-20261028-01
node apps/superhuman/api/test/live-calendar.mjs --verify --run-id calendar-meet-20261028-01
node apps/superhuman/api/test/live-calendar.mjs --step delete --run-id calendar-meet-20261028-01
node apps/superhuman/api/test/live-calendar.mjs --verify --run-id calendar-meet-20261028-01
```

The first ready plan saves the immutable authorization digest and exact payload.
Future commands refuse any approval/payload change. Journals and reports are in
`.local/live-tests/calendar/<runId>/`, mode 0600 under private directories. Each
prepare attempt, returned operation/event ID, and execute-attempt flag is saved
atomically with file/directory fsync before the next request. An exclusive run
lock prevents concurrent harness instances. No report prints tokens or Meet URI;
the controlled event result, including a returned Meet URI, stays private.

`--verify` performs GETs only and polls exact event detail at most five times.
It reports `pending`, `success`, `failure`, or `unknown` for Meet. A saved event
with pending/unknown conference is not a successful link test. A successful link
must have a validated HTTPS `meet.google.com` URI. Existing events are never
searched for or adopted: the one generated ID comes from this run's prepared
create operation. Before every write, both grants, the owned primary calendar,
participants, title, interval, marker and current ETag are checked as applicable.

## Interrupted or uncertain requests

Never rerun with a new run ID, delete the journal, clear an attempt flag, create
a replacement operation, or resend a prepared/unknown write to see what happens.
Repeating a `--step` that already attempted execution reads its same operation
status and makes no new execute call. A lost prepare response stops before any
execute; root must inspect the server's prepared records rather than create a
fresh run. A prepared operation with an attempted flag may still be queued.

For an operation whose stored status is `unknown` or `dispatching`, root can run:

```sh
node apps/superhuman/api/test/live-calendar.mjs --reconcile-step create --run-id calendar-meet-20261028-01
```

Use `update`/`delete` only for that exact attempted step. Reconciliation uses
provider reads only and preserves the same operation ID. Unresolved state blocks
all subsequent lifecycle writes. Failed/conflicted preflight is not a license
to create another edit; inspect it first. Cleanup can delete the one confirmed
owned event even after its start, with a fresh ETag, provided no operation is
unknown. A confirmed cancellation ACK is recorded separately from an exact GET:
GET 404 alone never proves an uncertain deletion succeeded.

A stale `run.lock` after process termination must be inspected by root against
the saved PID and operation journal before removal. A network error may have
left an operation queued or dispatched. No automated cleanup or retry runs in
`finally` or on startup.

## Offline coverage

`node --experimental-strip-types --test apps/superhuman/api/test/live-calendar.test.ts`
covers the one-event
lifecycle, separate Meet reads, exact context guards, strict approvals, durable
attempt publication, lost prepare/execute responses, queued prepared state,
unapproved participant/event/ETag drift, role/grant loss, and past-start cleanup.
These synthetic checks do not replace live provider receipts or comparison with
the original Superhuman implementation.

## Completed live run

Run `calendar-meet-20261028-01` completed through the local API from
04:13–04:15 UTC on 2026-10-28. The private journal records one successful create,
one conditional update and one conditional delete: **three explicit write
dispatches**, all for the same generated event ID, with zero unknown outcomes.
The sole attendee was the separately approved counterpart account.

Exact organizer event reads confirmed a successful Google Meet link before and
after the edit; the link remained the same. The attendee's bounded Calendar read
returned the same confirmed event ID, approved interval, organizer and sole
attendee, with a matching successful Meet link. This proves receipt in that
attendee's Calendar; delivery of invitation emails and notifications was not
separately measured.

The delete operation was acknowledged, followed by an exact organizer read of
the matching cancelled event. A separate exact attendee read returned HTTP 200
with the same event ID and `status:cancelled`, confirming cancellation propagated
to the attendee Calendar. The executor then cleared the approved Calendar ID
write gate and restarted the main process. No further write test is authorized
by this completed run.

Private state, operation IDs, ETags, provider identifiers and Meet URI remain in
`.local/live-tests/calendar/calendar-meet-20261028-01/`. Public records contain
only scoped outcomes and evidence-file digests. This is a local adapter/provider
check, not an original Superhuman write comparison or full Calendar parity claim.
