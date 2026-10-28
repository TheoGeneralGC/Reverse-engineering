# Controlled Calendar and Meet check — 2026-10-28 UTC

Run `calendar-meet-20261028-01` exercised the local replica's Google Calendar v3
adapter through the loopback API. The user separately approved Calendar consent
for both connected test accounts and exactly one event: one organizer, one
counterpart attendee, Google Meet, one edit, then cancellation/removal. The
verified owner/primary Calendar and exact account/calendar/attendee write lists
were configured by the executor before dispatch. Addresses and provider IDs are
private.

This record reports the completed replica/provider check. It does not describe
an original Superhuman write, assert that the original uses this protocol, or
establish visual/behavioral equality. Original UI observations and REA evidence
remain in [calendar.md](calendar.md). No new provider requests were made while
reviewing these private artifacts.

## Observed live results

The disposable `REA test` fixture was five minutes on October 30, 2026,
15:00–15:05 America/Los_Angeles (`-07:00`). It was private, transparent and
nonrecurring, with synthetic notes explaining that no action was needed and the
event would be edited and cancelled.

| Step | UTC completion | Confirmed result |
| --- | --- | --- |
| Ready plan | 04:13:28 | Both service grants and the organizer's primary owner Calendar passed readiness checks; zero writes |
| Create | 04:13:34 | One acknowledged create for the generated event ID; exact organizer and sole approved attendee |
| Exact event verification | 04:13:43 | Google Meet `success` with a validated HTTPS Google Meet URI |
| Edit | 04:14:34 | One acknowledged conditional update; edited title/notes, same interval, sole attendee, privacy and availability |
| Exact event verification | 04:14:38 | Meet still `success`, with the same link |
| Cancel/remove | 04:15:01 | One acknowledged conditional delete for the same event ID |
| Exact organizer verification | 04:15:08 | Matching cancelled event, in addition to the delete acknowledgment |

The journal and per-step reports contain **three explicit write dispatches**:
one create, one update and one delete. All three operation records succeeded;
there were zero unknown outcomes. Update and delete each retained a strong
reviewed ETag. Durable operation IDs and attempted flags remained tied to the
same generated event ID; no replacement run or automatic write retry was used.
These are operation/acknowledgment records, not a complete raw HTTP capture.

The attendee's separate bounded Calendar read returned exactly one matching
fixture with the same event ID, approved start/end instants, organizer and sole
attendee. The attendee was marked `self:true`; its successful Meet URI matched
the organizer copy. This verifies the event reached the attendee Calendar.
Invitation email delivery, RSVP changes and notification presentation were not
measured. The evidence shows a completed Meet result; it does not establish the
timing or UI of a pending-to-success transition.

After cancellation, the exact attendee event read returned HTTP 200 and the same
ID with `status:cancelled`. Cancellation therefore propagated to the attendee
Calendar. The executor subsequently cleared `APPROVED_CALENDAR_TEST_IDS` and
restarted the main process, closing the test write gate. That final configuration
action is executor-reported; this documentation review made no additional status
request. The successful run does not authorize repeating it.

## Private evidence and implementation identity

Private evidence is retained under
`.local/live-tests/calendar/calendar-meet-20261028-01/`. The table gives SHA-256
digests of the reviewed files, without publishing raw event records, operation
IDs, calendar IDs, account addresses, ETags or the Meet URI.

| Private artifact | SHA-256 |
| --- | --- |
| `state.json` | `daaa628ae5d8d503c6bf6b3079a6ac9d1d18c960c50e26117521200945381b6a` |
| `report-1793160814114-execute-create.json` | `d7d28dc3e8bc39ce7d8d099323d8915de1ed98978e592cd4c177f64488b2662e` |
| `report-1793160874183-execute-update.json` | `98fc3c65f379d12491afc129a9d8246cd9de2eaa43107b1fca4c81fc944ff665` |
| `report-1793160901492-execute-delete.json` | `37dea4e6ec8259f3fa790197e37ff919bd5f8a714ba79b8089f1d40af6be6eb9` |
| `attendee-create-observation.json` | `f4244fb9a81976b8acd91aec3e9fa5c3c959a89c873a2cd4024f993bae5ed0e8` |
| `attendee-cancellation-observation.json` | `fcecbaf81882f3eb636c5d1dd77fc7c75305247f53dcdda90321de08b9982510` |

The reviewed harness was frozen before the run:
`api/test/live-calendar.mjs`, SHA-256
`bee6b7e5b4afdf7349b474c2ab7553fad39fba62a60ccde68127592f7a3ef2cc`.
Post-run source digests, read during this review, were:

- `api/src/calendar.ts`: `28134512d9da4c7e26a555228c99edbc42ab9218e5a0956044791822fb041c0a`
- `api/src/calendar-store.ts`: `09e259c9c51396ee93d4c298507d533df09ac5e093d8c54530c67a947812a049`
- `api/src/calendar-input.ts`: `d8a9b39e99316155ef670b96fea2afe9934e4d28d99ce17210009bc2ff7df350`

The full offline API suite previously passed 176 tests, including 11 harness
safety cases. Those tests cover synthetic uncertain writes, queued operations,
changed participants/content/ETags and lost responses. This successful live run
did not exercise those failures against Google. Browser interaction, live
free/busy accuracy, recurrence edits, shared-calendar writes, email notifications
and original-product write comparison remain outside this check.
