# Calendar investigation — SH-011

SH-011 is in progress. This record separates observed original behavior from
replica implementation and provider design. Both approved accounts now have
separate Calendar grants. One explicitly authorized replica event/Meet lifecycle
completed; see [the scoped live result](calendar-live-check.md). Original write
behavior and broad Calendar parity remain unverified.

## Original identity and capture boundary

The original is the signed-in browser target recorded in
[source-inventory.md](source-inventory.md), Chrome 156.0.8078.48. Main resource
`db8c4288f33febf25ad9.page.js` was independently recaptured with digest
`c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`.
The observations below used the pinned REA 6.8.0 CLI connected to the existing
user-owned target. Locale en-US, time zone America/Los_Angeles, light theme,
reduced motion. Captures are private and may contain existing event details.
The actual viewport is recorded below; the requested 1440×900 does not override
the externally owned Chrome window. Account plan/entitlements are not established.

| Evidence | Observed scope |
| --- | --- |
| `ev_9324dd2f3a53c2444aeb632118bb0490f79e189e0bf6020bfc2f87858eb9361d` | Calendar navigation, actual 500×963 viewport; insufficient width for complete layout |
| `ev_fc3f63c12a9e1865773a3c8ccfe502798e1022ef799626e4267333116af9eab2` | Expanded week layout, actual 1920×963 viewport |
| `ev_eeb071ccb8028f79477f5277af6899b56426aca83c275f128cd308850af2cf31` | Empty unsaved new-event form, then Escape and Mail restoration |
| `ev_8c1c3fa9ddc522d9b5d493b7a39669ddd853d577a0c3be0717b7e9f434e6ddf1` | When, Repeat and Calendar controls; all 18 actions completed; event capture incomplete and equality_eligible=false |
| `ev_6fe7b561607807da81c04baa60a243ffb9864abcbe4a1154af6552c6b093eb71` | Meeting-link choices and Custom Repeat dialog; all 17 actions completed; event capture incomplete and equality_eligible=false |
| `ev_4a92b2232a4141410ea07e277ab6bce1d7adb3d7448a45494008c7332a06a5be` | Existing recurring-event details opened read-only; all nine actions completed; event capture incomplete |
| `ev_2aa3aa3613f2fddee262614e5a93340ac372f7bda214b4e13df57e84ce74cb14` | Existing-event action menu opened without selection; all 12 actions completed; event capture incomplete |
| `ev_73ef1d66b3ce6788c9de74dfefff62b4c88a029cabb66136f9e7d319d9e1c41b` | Three natural-language date expressions in separate unsaved forms; all 21 actions completed; event capture incomplete |

All new-event forms were left unsaved and dismissed; Mail restoration asserted
Today hidden and the mail footer visible. No existing event was edited. The temporarily expanded Chrome window was restored
after the probes. Missing
event capture means these results cannot support a complete network or equality
claim. Private screenshot filenames are descriptive, not proof by themselves.

## Observed runtime behavior

The week runs Sunday through Saturday. Today, previous/next controls and a month
title appear above the grid. A 40-pixel navigation rail is at the left and an
approximately 288-pixel sidebar at the right. The grid has an all-day row, a
roughly 64-pixel time-label gutter and seven flexible day columns. Hours are
approximately 44 pixels tall. Current time is a red line and dot only in the
current day. Timed events have a colored, lightly filled block with title/time;
a public holiday appears as a green all-day tile. The visible display time zone
is abbreviated beside the all-day row. These measurements are approximate.

The sidebar contains a six-week mini month, a Meet input (Enter name or email),
Booking Pages with an add control, and grouped calendars with colored visibility
checkboxes. Both a primary owned calendar and a read-only public holiday calendar
are visible in the reference. Shared-calendar editing and booking behavior remain
unobserved.

B opens an unsaved new-event form and a temporary grid block. Its default interval
is 30 minutes from the current minute, without observed rounding. The form is
approximately 464×350 pixels, beside the event and clamped within the viewport.
Fields are Event title, attendees, When, Repeat, meeting link, Where, notes and
Calendar, followed by Save and Cancel. Meet is disabled while this form is open.
The title has a purple active underline. Footer hints advertise Cmd+Enter to
save; additional keyboard behavior requires independent checks.

When is an inline natural-language textbox with placeholder
“tomorrow 2 pm 30 min new york”; clicking it did not open a separate date picker.
Escape cleared its displayed text in the tested temporary form while the ghost
block retained its prior range. Three bounded parsing cases were tested by filling When and pressing Tab,
with the clock on October 27 in America/Los_Angeles:

| Synthetic input | Displayed normalized result |
| --- | --- |
| tomorrow 2 pm 30 min new york | October 28, 2:00–2:30 PM EDT, with a secondary 11:00–11:30 AM PDT line |
| Friday 10am 1 hour | October 30, 10:00–11:00 AM |
| tomorrow all day | October 28 (all day) |

No form was saved. These cases establish their displayed parsing results only;
provider payloads, broad language coverage, ambiguous times and DST behavior
remain unverified. The first attempt was rejected before browser execution for
a malformed literal-input schema; its diagnostic is retained privately, followed
by the corrected completed capture.

Repeat opens a white approximately 228×266 dropdown: Does not repeat, Daily,
Weekly on the current weekday, Monthly on the ordinal weekday, Monthly on the
last weekday, Annually on the current month/day, Every weekday (Mon to Fri),
and Custom. Custom opens a centered approximately 550×276 dialog containing
Every [1] [week], weekday chips (current weekday selected), and Ends choices:
Never (default), On [a date three months later], or After [13] times. Cancel and
Done are visible. Only opening and Escape dismissal were tested; saving a rule
and recurrence expansion remain unverified.

Add a meeting link opens choices Google Meet and Zoom. Neither was selected;
conference creation, connection requirements and asynchronous outcomes remain
unknown. Calendar is an inline searchable textbox with an owned-calendar
suggestion. No alternative destination was selected.

An existing recurring event opens an approximately 464-pixel-wide details card
beside the selected block, with title/color, an action menu, date/time, recurrence
summary and calendar identity. Recurrence text was observed on an expanded
instance. Existing event text remains private. No inline edit was invoked. The menu offers Edit, Delete and Open in Google
Calendar; none was selected.

## Replica browser checks

The isolated actual-workspace fixture passed 24 week/detail/visibility/availability
steps (`ev_5ca3355dd22c2de199f5a89b33dcf331c13d4eef1a884c7f328a3f84cbc65985`)
and 34 synthetic create/edit/delete steps
(`ev_caee2d2eee20ba52f2d6c86a705c61bdb537ea71f016c8e2458c5e16e66c8cec`).
The clock and viewport match the bounded reference observations, and both runs
captured complete requested artifacts. These use injected in-memory provider
responses; no live Calendar permission or provider write is established.
The original and replica both show the recorded controls/normalization. Broad
pixel/behavior equivalence, actual recurrence expansion and provider outcomes
remain open.

A later four-step visual capture, after icon/heading/block alignment refinements,
is `ev_37e138678aa062b8311ebe28ae8785a688362e187b7805d4656d4130b336a6ef`.
It confirms the week and unsaved form at 1920×963. Source hashes were recorded
afterward, rather than an atomic before/after manifest. Full pixel equality is
not claimed. The action-name/timeout failure and corrected controls are preserved
in [scenarios/README.md](scenarios/README.md).

## Replica design and verification boundary

The provider foundation uses a separate, account-bound Calendar grant, encrypted
token record and default-off service gate. Canonical incremental sync and bounded
visible-range expansion are separate stores; this is a local architecture choice,
not a claim about the original. Strong ETags and durable write-attempt records
protect against overwriting changed events and blind duplicate retries.
See the API contract and synthetic tests for current supported operations.

A22 requires matched overlapping/all-day/DST/range/visibility scenarios and real
read validation. A23 additionally requires explicitly authorized event/invitation
participants, a disposable fixture, provider outcome checks and cleanup. Separate
Calendar authorization subsequently enabled one five-minute synthetic fixture:
create with Google Meet, edit, and cancel. The three acknowledged writes, sole
attendee Calendar receipt, retained Meet link and cancellation propagation are
recorded in [calendar-live-check.md](calendar-live-check.md). This establishes a
bounded local adapter/provider outcome, not original-product write comparison.

Real free/busy accuracy, live recurrence changes, booking pages, timezone
preferences, drag/resize, notification delivery and complete keyboard/visual
behavior remain open. Broader conference behavior, other calendars and attendees,
and live timeout/conflict recovery remain unverified. No broad Calendar
capability is marked verified by this single lifecycle.
