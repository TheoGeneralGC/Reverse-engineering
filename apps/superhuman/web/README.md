# Superhuman browser client

`npm run build:superhuman` checks types and builds the browser client. Run focused
synthetic synchronization tests with `npm test --workspace @re/superhuman-web`.
Those tests use stubbed responses and never contact a provider or open Chrome.

## Mailbox synchronization feedback

For a connected Gmail account, `useAccountSync` reads
`GET /api/accounts/:id/sync`. Status checks continue while the account is active;
they do not start provider synchronization. Initial, queued, partial, failed, and
unavailable status states suppress the completed-empty-inbox view. Partial counts
are marked with `+`; a zero count remains unknown until synchronization completes.
Saved messages remain visible while an error is displayed.

The compact status notice provides explicit Retry/Continue/Start controls. These
are the only browser actions that POST a synchronization request. Authorization
failures offer Gmail reconnection; provider throttling offers retry and displays
the server's next-attempt time when available, without suggesting reconnection.
Backend jobs own automatic synchronization and backoff.

Each monitor belongs to one account, cancels its pending timer on disposal, and
discards stale or out-of-order responses. Newly available status refreshes local
mail and account data. API error codes are preserved for accurate recovery text.

This is implemented error/loading feedback for the reconstruction. It has not
been compared with original Superhuman failure-state screenshots or semantics.

## Rich composer

`RichComposer` wraps pinned public Squire editing APIs. Its body is an accessible
contenteditable textbox named “Message body”. Selecting text reveals the observed
floating formatting toolbar; Cmd+K opens the compact link input, Enter applies a
safe URL, and Escape closes the popover. Cmd+O opens the observed six-color
palette. Inline formatting, list/quote commands, undo/redo, selected snippet
insertion and undoable AI replacement preserve the editor's selection.

Draft saves submit plain `body` and sanitized `html` together. Old plaintext drafts
are converted safely on open. Client sanitation strips active content and remote
images before paste; the server applies its own independent boundary before
persistence and MIME generation. Clipboard images use the attachment path.
Read-only scheduled/sending/unknown-delivery states block edits.

`npm test --workspace @re/superhuman-web` also runs synthetic jsdom editor tests.
They load no remote resources and make no provider requests. Original evidence,
implementation choices, comparison limits and remaining cases are recorded in
[the rich composer checkpoint](../research/rich-composer.md). Formatting is
implemented and remains unverified for full parity pending runtime comparison.

Delivery uses a separate send-in-progress lock beginning before the save request.
The composer, recipients, attachments and draft actions remain locked until save
and dispatch finish. Account switching also locks the composer, saves its current
snapshot before changing preferences, and retains it if either request fails.
`test/draft-transitions.test.ts` renders the actual App with synthetic fetch
responses to hold and fail these requests; it never contacts an email service.

After a dispatch error, the client reads `GET /api/drafts/:id`. A pending delivery
(including one queued before its stored status changes) or a `sending` status
stays locked and is polled using GET only. An unknown outcome offers an explicit
Sent check; that action reconciles only after a GET confirms `delivery_unknown`.
Unavailable status also remains locked until a later check establishes the
outcome. Confirmed `sent` closes the composer; an authoritative nonpending
`draft`/`failed` result restores editing. Status reads merge delivery metadata
without replacing the editor body and never issue an automatic resend.

## Paged mailbox summaries

The browser requests `/api/bootstrap?includeThreads=false`, then uses
`GET /api/thread-summaries` for the active account, folder, committed query and
inbox split. The API filters the split before applying a bounded keyset page.
Rows contain `ThreadSummary` metadata, message count and attachment presence;
message bodies are fetched with `GET /api/threads/:id` only when opening a
conversation. Auto Advance also loads that full detail. Ordinary list/refresh
requests do not use the legacy bulk-thread endpoint.

Inbox and split totals come from the response's account-wide Inbox counts,
independent of loaded page length. Search result totals use `total`. Loading and
request failures remain explicit instead of implying a completed empty mailbox.
Transient bootstrap connection/proxy failures have a bounded read-only retry;
a successful load clears the initial fatal state.

Near-bottom scrolling appends another page. The visible Load more control offers
a keyboard-accessible fallback; Refresh restarts from the newest keyset boundary.
Thread IDs are deduplicated and selection is retained by ID as new mail arrives.
A refresh reloads the previously loaded range and extends far enough to retain a
selected thread that moved beyond the first page, stopping near the previous
boundary if that thread was removed. Equal-date ties use the API's UTF-8 order.
New arrivals above an existing cursor are discovered on refresh.

Repeated keyboard moves queue across a pending page. Opening, replying, archiving
and other selected-row actions wait for that movement to settle; a failed page
cannot silently act on the old edge row. Manual selection cancels stale queued
movement. Each account/folder/query/split owns a separate list controller, and
late list/detail responses are discarded when its context is disposed. Detail
requests are also sequenced so an older response cannot replace a newer choice.

Synthetic controller and actual App tests cover two pages, new arrivals, stable
selection, counts, lazy details, Auto Advance, stale account/query requests,
keyboard boundary actions, retry, and near-bottom loading. No provider or Chrome
is accessed. This pagination/UI policy is an implementation choice; original
Superhuman infinite-scroll, virtualization and all keyboard-boundary behavior
have not been established by these tests.

## Calendar workspace

Calendar loads separately from Mail and uses its own week grid, 288-pixel sidebar,
mini month, visibility checkboxes, ephemeral event preview, event details/options,
inline When field, repeat menu and Custom repeat dialog. The three captured When
examples are covered by a bounded local parser: tomorrow with New York time and
a duration, Friday at 10am for an hour, and tomorrow all day. Unrecognized text
retains the old draft and blocks Save until corrected. Full natural-language
coverage remains unverified. Zoom and booking pages remain unavailable.

All range queries carry an explicit time zone and Sunday-to-Sunday instants.
Temporal handles daylight transitions; missing/ambiguous local times require an
explicit matching offset. All-day end dates stay exclusive. Timed overnight
segments and overlap columns are laid out locally. A fold crossing preserves a
positive visible block and an offset-change label; that 24-hour-grid choice is
not an observed original DST policy. Partial/error/permission states retain
loaded events and never imply that unavailable calendars are free.

New event input causes no operation before Save. Save prepares an operation,
preserves its ID in an account-scoped local journal, then executes that ID.
Unknown outcomes remain locked and offer an explicit status/reconciliation path.
Prepared continuations reuse their existing ID. Conflict reload retains changed
fields and rebases untouched fields onto the latest event before another explicit
Save. Updates omit untouched fields, preserving remote timestamp precision and
attendee metadata. Unsaved plain drafts are retained in account-scoped memory when
leaving the workspace; unresolved provider operations use the durable ID journal.

Read-only calendars cannot prepare writes. Async Google Meet status is checked
with reads, without recreating its request. Existing Gmail grants are independent
of Calendar setup. The real Calendar backend remains disabled until separately
configured and consented; this implementation and its synthetic tests do not
establish a live grant or event delivery. See the API Calendar contract and
parent-owned research records for provider and original-comparison limits.

## Explicit AI email actions

An AI preview is inert until the user chooses an action. Create Draft persists a
local draft; Current Draft is disabled for the currently opened target, and Go To
Draft reads its latest saved content. The preview never overwrites later edits.
Only an explicitly advertised new generation can create another draft after the
previous one was properly discarded.

Card Send submits the immutable preview identity, hash, generation and a fresh
durable request key to its dedicated endpoint. It does not invoke the current
composer's Send handler, add its signature or attachments, or navigate away from
the user's editor. Create and Send exclude one another both locally and at the
server. A queued artifact draft remains read-only if opened through Drafts.

The client saves the request key before dispatch. A lost acknowledgement keeps
the card locked and recovers only through the same key; a missing recovery result
does not permit another Send. Queued/sending status uses read-only polling.
Unknown provider outcomes expose an explicit Check Sent action, which invokes
the server's read-only delivery reconciliation. Following the observed original,
an accepted queued/sending action uses disabled Sent on the card and Message
sent in the shared notification; these are optimistic acceptance labels, not
provider-delivery proof. The operation remains queued/sending in the typed API
and DOM metadata until authoritative confirmation. Unknown and not-dispatched
actions never automatically retry. Demo or unapproved accounts expose their
unavailable delivery state.

The shared notification remains independent of Ask AI visibility. Undo records a
separate durable operation/revision-bound key before its explicit cancellation
request. A lost Undo acknowledgement recovers only by that key; a missing result
does not authorize another request or a new Send. Only server `canCancel`
authorizes the control. The current ten-second server window is an explicit
local policy consistent with a bounded original timing observation, not a
recovered private cutoff. No hover extension or Instant Send is implemented.
The positive send notification closes when a subsequent server snapshot reports
the cancellation window closed; unknown/error states remain available to check.

Confirmed cancellation restores the same owned draft. Auto-open first checks the
account, workspace and current editor reference, then uses the normal guarded
save/open path. New typing or navigation wins; the draft remains saved and can
be opened explicitly. Current Draft/Go To Draft use current stored content.
After deliberate clearing/discard and canonical absence, a fresh explicit action
can claim the advertised next generation. Historical Send/cancel keys always
resolve their original operation and never resend or retarget newer drafts.
Normal composer Undo remains a separate gap. Synthetic controller and actual App
checks establish this local lifecycle; a new browser/live comparison is required
for the current implementation.
