# Calendar backend contract

This foundation is verified with offline synthetic/mocked tests only. It has not
called the live Calendar API, granted Calendar permissions, created real events,
or sent invitations. Original UI observations do not establish provider parity.
Calendar remains disabled unless `GOOGLE_CALENDAR_ENABLED=true`; no setting or
Cloud configuration is changed automatically.

## Consent and readiness

Calendar uses the existing Google Web OAuth client and registered callback,
`http://127.0.0.1:3001/api/auth/google/callback`. An explicit future connection
opens `GET /api/auth/google/start?service=calendar&accountId=<connected-account>`.
The flow requests incremental authorization and binds state/PKCE to that account.
It verifies the returned OpenID email/verified identity against the selected
Gmail account before publishing Calendar credentials.

Requested scopes, under `https://www.googleapis.com/auth/`, are:

- `calendar.calendarlist.readonly`: calendar metadata and access roles.
- `calendar.events.readonly`: event reads, including subscribed public/shared calendars.
- `calendar.events.owned`: changes restricted to owned calendars.
- `calendar.events.freebusy`: availability on accessible calendars.
- `openid` and `email` are additionally requested as identity scopes.

Calendar tokens occupy a separate AES-GCM encrypted service slot. Requested and
actually granted scopes are persisted separately; capabilities use the actual
grant. Partial/declined consent and identity mismatch preserve stored Gmail
credentials and account selection. Refreshes are deduplicated per service and
publish any narrower returned scopes before an API request is dispatched. No
authentication starts from background jobs. Calendar consent can remain partial;
the server reports unavailable capabilities rather than assuming them.

`GET /api/calendar/status?accountId=...` returns
`{calendar:{enabled,configured,missing,requestedScopes,grant,authAttempt,capabilities,writesEnabled,liveVerified:false,limitations}}`.
Capabilities are `list`, `read`, `readOwned`, `writeOwned`, and `freebusy`.
Configuration readiness and service consent are distinct. CalendarList roles
`owner`, `writer`, `writerWithoutPrivateAccess`, `reader`, `freeBusyReader`, and `none` further restrict access;
this build permits event writes only for `owner`, even if broader scopes exist.

Before future live tests, the user must approve Calendar API activation,
additional scopes/identity access, and service consent. Event writes additionally
require exact `APPROVED_CALENDAR_TEST_ACCOUNTS` and `APPROVED_CALENDAR_TEST_IDS`.
Every attendee on new or existing events must appear in
`APPROVED_CALENDAR_TEST_ATTENDEES`. These lists default empty and are independent
of Gmail delivery approvals. This build limits write tests to 20 attendees and
rejects edits to events organized by another account or with omitted attendees.

## Routes

Paths below have the `/api` prefix. Errors retain `{error:{code,message}}`.
All mutations with JSON input require `application/json`; times/IDs must be URL
encoded in queries/path segments. Responses use `Cache-Control: no-store`.

| Method/path | Input | Output |
| --- | --- | --- |
| `GET /calendar/status` | optional `accountId` | `{calendar}` readiness described above |
| `GET /calendar/calendars` | optional `accountId` | `{calendars:CalendarMetadata[],sync,providerStatus}` cached metadata |
| `POST /calendar/calendars/sync` | `{accountId?}` | `{imported,partial,phase?,reset?}` for one bounded page |
| `GET /calendar/sync` | `accountId?`, `calendarId?` | `{sync}` with phase, partial, completion/retry/error metadata |
| `POST /calendar/sync` | `{accountId?,calendarId}` | `{imported,partial,phase?,reset?}` for one canonical event page |
| `GET /calendar/events` | `accountId?`, `calendarId`, `timeMin`, `timeMax`, `timeZone?`, `refresh?` | `{calendarId,range,events,cache:{key,partial,updatedAt,expiresAt}}` |
| `GET /calendar/events/:id` | `accountId?`, `calendarId` | `{event}` authoritative exact provider resource/ETag |
| `POST /calendar/freebusy` | `{accountId?,timeMin,timeMax,timeZone?,items:string[]}` | availability result described below |
| `POST /calendar/operations` | `{accountId?,calendarId,kind,event?,eventId?,etag?}` | `201 {operation}` prepared without provider mutation |
| `GET /calendar/operations/:id` | — | `{operation}` durable local state |
| `POST /calendar/operations/:id/execute` | — | `{operation}` after one explicit dispatch |
| `POST /calendar/operations/:id/reconcile` | — | `{resolved,operation}` from provider reads only |

Absent account IDs default to the active account. Calendar sync/page tokens are
internal and never returned by these routes. `GET /provider/status` and bootstrap
also include a separate `calendar` readiness object.

## Data and synchronization

Exact types are in `src/calendar-types.ts`. Calendar metadata preserves summary,
description, IANA zone, role, primary/selected/hidden flags, colors, and supported
conference types. Event reads preserve stable provider IDs/ETags, summary,
description, location, attendees, organizer, recurrence/exception identity,
visibility, and conference metadata. Descriptions/links are untrusted provider
content: render text or sanitize before display, and never execute arbitrary HTML.

All-day boundaries are `{date:'YYYY-MM-DD'}` with an exclusive end date. They
retain calendar days instead of converting to UTC midnight. Timed input accepts
`{dateTime,timeZone}` with an IANA zone (or the calendar's explicit fallback).
Offsetless local wall times reject DST gaps and ambiguous folds; a matching
explicit offset resolves a fold. Numeric offsets must match the selected zone;
`Z` specifies an exact instant converted into that zone. Host timezone is never
used implicitly. Provider dates are independently validated before checkpointing.

Canonical event sync uses a fixed unbounded query with `singleEvents=false`,
`showDeleted=true`, and 100 items per page. It persists each page's records and
cursor atomically. Incremental pages retain the original sync token until a final
`nextSyncToken`; failed pages never advance. Cancelled events retain minimal
tombstones; cancelled recurring exceptions preserve `recurringEventId` and
`originalStartTime`. A 410 wipes only the affected collection and restarts a full
scan. CalendarList has its own cursor and periodic six-hour full refresh because
incremental tokens omit some ACL/read-only metadata changes. Deleted/lost-read
calendars clear their cached event details, range windows, and event sync state.

Visible ranges are separate queries with `singleEvents=true`, `orderBy=startTime`,
and explicit bounded dates; canonical tokens never enter these requests. Each
call fetches at most one 100-item page. Repeat the same range while `cache.partial`
is true. A complete window is cached for 60 seconds; unfinished pagination expires
after ten minutes. `refresh=true` starts that range again. Limits are 62 elapsed
days, eight windows per calendar, and 20 pages/2,000 events per window; dense
ranges return 413 `calendar_range_too_dense`, requiring a smaller range. Exact
event detail reads do not insert expanded instances into the canonical store.

Background work runs bounded pages, with durable exponential/quota backoff and
no auto-authentication. Calendar GET pacing defaults to 60 starts/minute/account
through `CALENDAR_READS_PER_MINUTE`, separately from Gmail. GET transport retries
are bounded; freebusy POST and all writes never retry automatically. Account-wide
Calendar quota backoff survives restart and also gates explicit Calendar requests.
It does not block Gmail sync/delivery. `runJobs:false` disables automatic timers
for offline test runtimes.

## Availability is not a boolean

Freebusy accepts 1–50 calendar/group IDs with bounded expansion. Its result is:

```ts
{
  timeMin, timeMax,
  calendars: {
    [id]: {status: 'known', busy: [{start, end}]} |
          {status: 'unknown', errors: string[]}
  },
  groups: {[id]: {errors: string[], calendarIds?: string[]}},
  complete: boolean
}
```

Only a known empty `busy` list means no busy periods in the requested range.
Missing calendars, malformed timestamps/bounds, or per-calendar/group errors
remain unknown and set `complete=false`, even when HTTP status is 200. Intervals
use inclusive start/exclusive end. There is no fallback that converts access or
provider failure into free time.

## Event writes and Google Meet

Prepare an operation with `kind: create|update|delete`. Create requires validated
start/end and receives a generated base32hex-compatible event ID before any
provider call. Update/delete require `eventId` and a current strong quoted ETag;
missing ETag returns 428 `calendar_etag_required`. Update input is partial, but
changing dates requires both start and end. Provider-controlled fields and raw
conference data are rejected. Existing event data is fetched and merged before
an `If-Match` conditional PUT/delete, preserving unrelated properties.
Retained attendee fields are merged by normalized email, preserving RSVP and
provider metadata when adding an approved guest. Updates to events using newer
versioned event labels return 409 `calendar_event_labels_unsupported` before
mutation; legacy color writes must not silently erase those labels.

Persist the operation ID before executing it. Execution is explicit and writes a
durable `dispatching` state before network mutation. Outcomes are `succeeded`,
`conflict`, `failed`, or `unknown`. ETag mismatch returns 412
`calendar_etag_conflict`. Ambiguous transport/5xx/malformed success or interrupted
dispatch becomes 409 `calendar_delivery_unknown`. Re-executing succeeded IDs
returns their stored result; other dispatched IDs are locked, and an unknown
operation blocks new changes to the same event. Never create a fresh operation
to retry an uncertain write. A prepared response can still have an execute call
queued, so clients must retain their attempted-operation journal.

Reconciliation only reads the same generated event ID and private operation
marker. Delete requires a matching cancellation receipt or event-GET 410;
404 remains unknown because it may indicate lost Calendar access. Reads that
cannot prove the result retain unknown state and never trigger another write.
No job dispatches or retries prepared/unknown operations.

An explicit `event.conference:{provider:'googleMeet'}` requests a Meet link. Its
unique `conferenceRequestId` is persisted with the operation and translated to
Google's create-request object with `conferenceDataVersion=1`. Event creation may
succeed while conference creation is still pending, fails, or is unconfirmed.
`event.meetingLink` reports `pending|success|failure|unknown`, optional request ID,
and a validated HTTPS `meet.google.com` video URI only when available. Poll exact
event detail to observe completion; polling never issues another write. Existing
conferences are preserved on updates. Replacement, Zoom creation, shared-calendar
editing, booking pages and full recurrence-instance editing workflows remain
unimplemented. Never report a saved event as having a meeting link solely because
the request was accepted.

## Primary protocol references

- [Google Calendar synchronization](https://developers.google.com/workspace/calendar/api/guides/sync)
- [Events list constraints](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [CalendarList limitations](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list)
- [Conditional resource modification](https://developers.google.com/workspace/calendar/api/guides/version-resources)
- [Event IDs and conference creation](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [Conference request/result fields](https://developers.google.com/workspace/calendar/api/v3/reference/events)
- [Freebusy errors and scopes](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
- [Incremental OAuth authorization](https://developers.google.com/identity/protocols/oauth2/web-server#incrementalAuth)

These sources define provider protocols; they do not prove the original
Superhuman product's behavior or this adapter's live compatibility.

The final offline API suite passes 127 tests, including the 85 pre-Calendar
regressions and 42 Calendar/date/adversarial cases. Strict TypeScript checking
passes. This evidence covers synthetic protocol behavior and local persistence;
Calendar Cloud activation, consent, live read/write behavior and original-product
comparison remain unverified.
