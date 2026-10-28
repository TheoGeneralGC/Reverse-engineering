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

## Private normal composer delivery candidate

This copy is isolated under `.local/composer-delivery-implementation/web`; it
has not replaced the running API325/web290 checkpoint. Normal immediate Send and
Send Later now use the keyed `/drafts/:id/send-operations` contract. The editor
locks before its last recipient/rich-content save, then compares the acknowledged
draft with a fresh scoped server snapshot. The accepted revision, content hash,
generation and optional canonical send time are journalled before a single POST.
An attachment still being read, uploaded or removed prevents that Send intent.

The global notification survives closing Ask AI and uses read-only recovery of its
original key. Undo/cancel has a separate durable key and restores the same draft,
attachments and provider linkage. An unknown acknowledgement never authorizes a
new Send key. Late restoration acknowledgements cache the restored draft and
leave newer typing, accounts and workspaces intact. A subsequent explicit Send
or schedule after confirmed Undo uses the new current revision/hash/generation;
old keys remain historical. Scheduled cancellation follows server `canCancel`,
including an overdue operation that has not been claimed. New sends and schedules do not call the old keyless routes. Explicit cancellation
of a pre-existing legacy schedule retains its legacy cancel route; an intent-owned
schedule always uses its keyed cancellation receipt.

This candidate preserves the existing AI-card flows. Immediate acceptance uses
the observed optimistic “Message sent” notification, while the operation state
remains queued/sending until actual provider confirmation. Scheduled acceptance
uses “Message scheduled” and an explicit cancel control. No Instant Send, hover
extension, cloud draft write/delete, scheduling precision, or browser/provider
parity is claimed by these mocked checks. The backend schedule poll currently has
its own documented cadence. Runtime rollout and comparison belong to the parent
checkpoint process; this author has made no API, database, browser, model or mail
calls while implementing the private candidate.

## Separate private queued-delivery acceleration candidate

This copy extends the frozen normal-composer315 source and the matching private
API375. It adds explicit Instant Send to an owned queued immediate AI-card or
normal-composer operation. Scheduling remains excluded. The control journals a
separate opaque key and the expected operation revision before its one POST;
transport failures and404 recover only through the original scoped read route.
It never starts another Send, changes recipients/content, or treats acceleration
as provider confirmation.

Both Send controllers permit one authoritative shortened-deadline transition only
when the operation supplies the original deadline, acceleration receipt ID and
accepted timestamp. Known acceleration metadata stays immutable. The global
notification shows “Send accelerated!” after the receipt, removes Undo and
Instant Send, and retains the durable queued/sending/provider state separately.
It currently stays until dismissal; the original notification's exact successful
acceleration lifetime remains unmeasured. No hover extension is added.

The original observation establishes the explicit control and success label;
current tests are synthetic and mocked. This author has made no live API,
provider, model, database or browser calls and has not applied either private
candidate to the root application. Root rollout, browser comparison and real
mail validation remain separate steps.

## Private Knowledge Base candidate

This isolated copy extends the frozen delivery frontend331. It has not been
applied to the running root325/290 application. The observed original Private
TXT upload, persisted extensionless title, owner/timestamp, one grounded answer,
Sources row and source-editor overlay are recorded in
`apps/superhuman/research/knowledge-base-runtime.md`; those observations do not
verify this implementation or the full file-format/link/sharing family.

The Knowledge workspace reads account-private metadata and shows source
processing/errors separately from ready content. Explicit file selection or drop
validates the21 declared extensions and50 MiB bound, hashes the selected bytes,
persists a source-action key, and posts the original bytes without JSON/base64.
Source creation and retry recover only by the saved key; a lost response/404
never causes another upload or retry automatically. Metadata edits are staged
until Save; unchanged Save is disabled. Revision conflicts retain edited fields
while explicitly loading current untouched fields. Delete has a separate
confirmation and uncertain deletion uses scoped GET recovery. A disappeared
source cannot silently discard uncertain saved edits.

Source citations resolve a server-owned typed Knowledge target, then fetch its
current account/source metadata. The editor overlays Mail/Calendar and Ask AI
without replacing their components or inserting content. Late account/session/
history/editor changes fence the read. Download is an explicit scoped local GET,
not a model-selected external URL. HTML/code stays inert. Source editor/link
input is cached per account; a storage outage keeps a memory fallback, while all
server mutations still require durable recovery storage.

Private Knowledge is included with Mail for new questions by the parent’s
chosen policy, supported by the bounded original file-retrieval observation.
An explicit context checkbox can exclude it, and `resources: []` still excludes
all new retrieval. Existing mail-only histories remain readable. Retrieval uses
only bounded scoped tools; opening Knowledge or a citation does not generate a
question or ingest another source.

Team sharing stays disabled until real membership/authorization exists. This
candidate’s Add Link saves one public HTTPS page; it does not claim the original
copy’s domain crawling or live retrieval. Generated descriptions currently come
from the backend’s deterministic local excerpt, not a hidden model call. Parser
coverage, extraction limits/OCR, original batch and failure behavior, complete
sharing, source-update/delete comparison, exact geometry and full parity remain
open. The Personalization link is an optional integration callback for the
coordinated merge with the separate Personalization candidate.

All author verification used mocked requests, synthetic files and isolated test
state. No live API, database, browser, provider or model call, root source edit,
service restart or account-wide change was made by this frontend work.

Current Knowledge consumption is Ask AI only. Inline Write with AI and Auto
Drafts source integration remain unimplemented; the info panel does not claim
otherwise. Delete/Discard confirmations own safe initial focus and a separate
Tab scope, with background fields inert. Delete uses the revision captured when
that confirmation was requested, so a background processing/status update cannot
silently broaden the confirmed action to a newer revision.


The combined private candidate also includes the account-scoped Personalization
editor. Knowledge and Personalization link to each other through guarded
navigation; staged source fields stay mounted while the modal covers them.
Confirmed navigation holds the preference editor read-only while the mail draft
save completes, and a failed save returns to the same staged settings. This
combined copy has not yet been compared with the original in a browser.


Inline AI rewriting now carries the owned draft account explicitly from App
through its editor and immutable rewrite request. Changing account or draft
aborts the request, resets the inline session, and rejects late text even if a
draft ID were reused. Retry retains the original account and selection snapshot.
The server can apply that account's saved manual preferences; learned voice is
still unavailable, and Rewrite in my voice retains its explicit setup error.
