# Superhuman reconstruction API

This is a local development backend with real SQLite persistence and an optional
Gmail integration. Synthetic demo messages use reserved test addresses; they are
not a copy of the inspected mailbox. External integrations are not verified until
credentials and authorized test accounts are supplied.

Run with Node 24.22.1 or newer supporting `node:sqlite` and TypeScript stripping:

```sh
node --experimental-strip-types --env-file-if-exists=apps/superhuman/api/.env apps/superhuman/api/src/server.ts
node --experimental-strip-types --test apps/superhuman/api/test/*.test.ts
```

The server binds to `127.0.0.1:3001`. SQLite defaults to the monorepo's ignored
`.local/superhuman/mail.sqlite`; an explicit `DATABASE_PATH` overrides it. The DB
is mode 0600. This service trusts the local OS user; it is not a hosted multiuser
authentication system and must not be publicly exposed. CORS validates the
configured frontend origin and known local development origins; Host validation
rejects non-loopback names. JSON mutations require `application/json`.

Copy `.env.example` to `.env` in this directory and configure credentials locally.
Google OAuth uses one-time expiring state plus PKCE; its state cookie is HttpOnly
and SameSite=Lax for the authorization redirect. Access/refresh tokens are AES-256-
GCM encrypted with `TOKEN_ENCRYPTION_KEY`, which must be exactly 64 hex characters.
The API never returns tokens or the encryption key.
Token responses validate access-token, expiry, Bearer type, and any explicitly
returned Gmail grant scope; narrower grants fail before account publication.
New connections require offline refresh access, while reconnecting retains an
existing refresh token when Google omits a replacement. Token/account/active-
account publication is atomic, and rotated refresh tokens are preserved.

See [manual automation candidate](AUTOMATION.md) for revisioned configuration and
explicit synthetic preview/apply. Real mailbox processing remains unavailable.
See [new-owned Gmail draft persistence](PROVIDER-DRAFTS.md) for the private
autosave candidate, conservative write recovery and legacy-draft boundary.

## API

All JSON errors have `{error:{code,message}}`. IDs in path segments must be URL
encoded. Times are ISO strings. Successful mutations are committed to SQLite.

| Method and path | Input | Output |
| --- | --- | --- |
| `GET /api/health` | — | `{ok,persistence,mode}` |
| `GET /api/bootstrap` | optional `includeThreads=false` omits full threads | `{accounts,activeAccountId,threads,labels,drafts,preferences,providerStatus,demo}` |
| `GET /api/accounts` | — | `{accounts}` |
| `GET /api/threads` | `accountId`, `folder`, `q` query parameters | `{threads}` |
| `GET /api/thread-summaries` | `accountId?`, `folder?`, `q?`, `split?`, `limit?`, `cursor?` | `{threads:ThreadSummary[],total,counts:{inbox,important,other,calendar},nextCursor,hasMore}` |
| `GET /api/threads/:id` | — | `{thread}` |
| `POST /api/threads/:id/reply` | `{mode:'reply'|'replyAll'|'forward'}` | `{draft}` with computed recipients |
| `POST /api/threads/:id/actions` | `{action,until?,labelId?}` | `{thread,undoId}` |
| `POST /api/undo` | `{undoId}` | `{thread}` |
| `GET /api/labels` | optional `accountId` | `{labels}` |
| `POST /api/labels` | `{name,accountId?,color?}` | `{label}` |
| `GET /api/preferences` | — | `{preferences}` |
| `PATCH /api/preferences` | any of `theme,activeAccountId,signature,defaultRemind,splitInbox,snippets` | `{preferences}` |
| `GET /api/drafts` | optional `accountId` | `{drafts}` (excludes sent) |
| `GET /api/drafts/:id` | — | `{draft,deliveryPending}` including sent and unknown states; read-only, no-store |
| `POST /api/drafts` | `{accountId?,threadId?,to?,cc?,bcc?,subject?,body?,html?}` | `{draft}` |
| `PATCH /api/drafts/:id` | same draft fields | `{draft}` |
| `DELETE /api/drafts/:id` | — | `{deleted:true}` |
| `POST /api/drafts/:id/send` | — | `{sent:true,result}` after provider succeeds |
| `POST /api/drafts/:id/reconcile` | — | `{resolved,matches,draft,message?}`; absent sent match leaves delivery unknown |
| `POST /api/drafts/:id/schedule` | `{scheduledAt}` | `{draft}` |
| `POST /api/drafts/:id/cancel` | — | `{draft}` |
| `POST /api/drafts/:id/attachments` | `{name,mimeType,data}` standard base64 | `{draft,attachment}` |
| `GET /api/drafts/:id/attachments/:attachmentId` | — | Download bytes |
| `DELETE /api/drafts/:id/attachments/:attachmentId` | — | `{draft}` |
| `POST /api/drafts/:id/sync` | — | `{draft}` after explicit Gmail draft creation/update |
| `GET /api/provider/status` | — | `{google,microsoft,ai}` with missing credentials |
| `GET /api/contacts/suggestions` | `accountId?`, `q`, `limit?` (1–5) | `{contacts:[{name,email,formatted}],source:'local-message-participants',limited:true}` |
| `GET /api/contacts/context` | `accountId?`, `email`, `excludeThreadId?` | `{contact:{name,email},matched,threads:ThreadSummary[],source:'local-message-participants',limited:true}`; at most 4 rows |
| `GET /api/auth/google/start` | — | Redirect to Google or 503 configuration error |
| `GET /api/auth/google/callback` | OAuth response | Validates state, durably saves account, redirects to `WEB_ORIGIN`, queues sync |
| `POST /api/accounts/:id/sync` | — | `{imported,pages,partial,phase,resultSizeEstimate,scope}` |
| `GET /api/accounts/:id/sync` | — | `{sync:{phase,partial,lastCompletedAt?,resultSizeEstimate?}}` |
| `GET /api/accounts/:id/messages/:messageId/attachments/:attachmentId` | — | Downloaded provider attachment bytes |
| `POST /api/ai` | `{prompt,mode:'ask'|'write'|'summarize',threadId?,accountId?}`; account required with thread | `{text,mode,model,responseId,contextThreadId}` |

Folders: `inbox`, `important`, `other`, `done`, `snoozed`, `sent`, `trash`, `spam`,
`starred`, `all`, or `label:<label-id>`. Local search supports phrases, `from:`,
`to:`, `cc:`, `subject:`, `filename:`, `label:`, read/star/important flags,
`has:attachment`, `in:`, `before:`/`after:` and `older:`/`newer:` aliases, with
negation and AND/OR groups. Date-only boundaries are UTC, inclusive after and
exclusive before, against the thread's latest message time. These local choices
are not yet verified against original provider date/time-zone semantics.
Search runs over imported local data and does not claim Gmail search completeness.
See [search behavior and evidence](../research/search.md) for the exact scope.
Mailbox lists and `in:` searches share provider-label membership, so one
conversation can appear in Inbox and Sent. Prefix a search token with `-` to
exclude it, for example `-in:inbox`. Message-level provider labels remain stored.

The separately gated [Calendar backend contract](CALENDAR.md) documents service
consent, calendar roles, range queries, availability, and durable event writes.
It is disabled by default and has only offline verification. Existing Gmail
consent does not enable Calendar or approve any invitations/events.

The [local recipient suggestion contract](CONTACTS.md) documents account-scoped
participant prefixes, safe address formatting and indexed metadata persistence.
It needs no external contacts service or new OAuth grant. Ranking and complete
address-book parity remain unverified.
Its outgoing-header section also documents strict validation before sending or
scheduling: every recipient fragment must parse, and canonical MIME is rebuilt
from the validated mailbox list. Invalid recipient strings remain editable local
draft content and are never silently recovered into a trailing valid address.

### Thin mailbox pages

`GET /api/thread-summaries` defaults to the active account, `folder=inbox`,
`split=all`, and `limit=50`. Limits must be integers from 1 to 100; invalid limits,
splits, and cursors return 400 with `invalid_limit`, `invalid_split`, or
`invalid_cursor`. The selected account is always applied before search matching.
An unknown account returns an empty page. The legacy full-thread list and default
bootstrap responses remain unchanged. `GET /api/bootstrap?includeThreads=false`
returns their usual metadata with `threads:[]`; drafts still include draft content.

`ThreadSummary` contains explicit thread-row metadata, `messageCount`, and
`hasAttachments`. It retains the subject/snippet preview, sender/participants,
labels and provider-label membership, flags, timestamp, and optional snooze
metadata. It excludes `messages`, full message bodies/HTML, attachment bytes,
and provider sync internals. Fetch `GET /api/threads/:id` to open the full thread.
Normal list/count calls read a persisted summary table maintained atomically by
SQLite insert/update/delete triggers. Existing thread records are projected once
in a transaction at migration; message records are not rewritten.

`total` is the number of matches before pagination. `counts` always describes
the selected account's unsnoozed Inbox, independently of the current folder,
query, split, or cursor. Important and Other partition Inbox; Calendar overlaps
them and matches a case-insensitive `calendar` substring in local label IDs,
preserving the current client's behavior. Splits apply only to Inbox with an
empty query. A nonempty trimmed query preserves the local search grammar and
searches all imported folders, ignoring the folder/split. Search currently falls
back to full account-scoped thread parsing; it does not have indexed body search.

Pages sort by latest-message ISO timestamp descending, then ID descending for
stable ties. `nextCursor` is an opaque validated keyset position bound to the
account, folder, trimmed query, and split. Reuse it only with that same context;
the next page may use a different valid limit. `hasMore=false` implies a null
cursor. This is live pagination, not a snapshot: mail arriving above the current
boundary appears on refresh. Deletions or updates during paging can change
totals or move existing conversations. Clients must deduplicate by thread ID.

Actions: `archive`, `unarchive`, `trash`, `spam`, `star`, `unstar`, `read`, `unread`,
`mute`, `snooze` (future `until`), and `label` (toggle `labelId`). Undo expires after
five minutes and is single-use. Undo restores only fields changed by the action,
preserves later unrelated changes, and returns 409 if the same field changed
again. Gmail label modifications complete before the local mutation is committed.
Mute/snooze timing is reconstruction-owned state. Due Gmail snoozes restore
INBOX through the account queue before clearing local snooze state; demo snoozes
wake locally. Each pass processes at most ten provider items. Provider failure
retains the due snooze with `snoozeError` and a one-minute `snoozeRetryAt` backoff,
preserved across synchronization and restart. Reads trigger a background pass,
and the 15-second job also checks due items. Preferences and drafts
survive process restarts.

See [delivery identity and reconciliation](DELIVERY.md) for opaque attempt
markers, immutable requested RFC IDs, provider-assigned headers, bounded Sent
metadata checks, and the restrictions on legacy unknown attempts.

## Data shape

See `src/types.ts` for the exact types. `Thread` has `id`, `accountId`, `subject`,
`snippet`, `sender:{name,email}`, `participants`, `lastMessageAt`, `unread`,
`starred`, `important`, `folder`, `labels`, and `messages`. Messages have `sender`,
`to`, `date`, `text`, optional untrusted `html`, and attachment metadata.
Render plain text by default. If rendering HTML, sanitize or sandbox it and block
remote content until the user chooses to load it. The server does not sanitize
vendor HTML on ingestion.
Named/disposition attachment parts are separated before text extraction, including
small Gmail attachments carried directly in `body.data`. Metadata preserves MIME
part identity and attachment source; embedded bytes stay in separate private DB
records rather than message JSON. The existing account/message/attachment download
route serves those bytes locally with attachment disposition and nosniff. Parts
with a provider attachment ID still use the provider endpoint. Attached containers
whose bytes are absent are marked unavailable instead of exposing child text as
the message body.

`Draft` has `id`, `accountId`, optional `threadId`, `to`, `cc`, `bcc`, `subject`,
`body`, `updatedAt`, and `status: draft|scheduled|sending|delivery_unknown|sent|failed` with optional
`scheduledAt`/`error`, attachment metadata, and optional `providerDraftId`.
`body` is the plain-text fallback; optional `html` holds authored rich markup.
HTML is sanitized on every write using pinned `sanitize-html`, with formatting
tags, tightly allowlisted style values, and absolute HTTP/HTTPS/mailto/tel links.
Active elements, remote media, event handlers, arbitrary attributes, and unsafe
CSS/URLs are removed. An HTML-only request derives fallback text using `parse5`;
an editor can submit both representations. A plain-body-only edit clears stale
rich markup. Existing plain drafts do not require migration or rewriting.
Compose uploads store bytes in the private SQLite DB;
each file allows 10 MiB, each draft 25 MiB and 20 files. Filenames reject controls
and path separators; MIME declarations must be valid type/subtype syntax.
These checks validate the declaration, not file-content safety. Downloads use
attachment disposition and nosniff. Sending uses multipart/mixed with RFC 2231
UTF-8 filenames and base64 transfer encoding. Rich drafts use multipart/alternative
with plain and HTML parts; attachments wrap that alternative in multipart/mixed.
Wire generation sanitizes HTML again. Forwarding the original provider
attachments automatically is not yet implemented.

Reply-all uses the latest message sender/To/Cc, excludes the selected account,
deduplicates addresses without case sensitivity, and preserves CC placement.
Reply headers retain Message-ID/References. Forward creates a separate draft with
quoted plain text, sanitized rich original content when available, and no inherited
recipients or thread ID. Replies keep their existing blank-body/thread-reference
behavior; original formatting parity still requires runtime comparison.

Four observed settings persist as typed booleans: `Auto Advance`, `Hide Empty Split
Inboxes`, `Backtick as Escape`, and `Show Sender Full Names`. The browser implements
their interaction behavior; this API owns storage and type validation.

## External integration limits

- Gmail OAuth requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
  `TOKEN_ENCRYPTION_KEY`. Callback defaults to
  `http://127.0.0.1:3001/api/auth/google/callback`; register it exactly. Scope is
  `https://www.googleapis.com/auth/gmail.modify`. The server imports all folders
  in short slices of at most five full-thread reads. Each successful thread is
  checkpointed; page cursors advance only after their pending IDs complete.
  History catchup during initial import prioritizes new mail and deletions.
  Imported generation members are skipped on initial retry. Expired history
  starts a fresh scan generation, retaining old rows until reconciliation.
  The background worker resumes saved cursors after restart, continues partial
  imports automatically and polls completed history every 30 seconds. It yields
  between slices for queued mailbox actions and scheduled sends.
- Gmail reads share an account quota pacer, defaulting to 4800 units/minute via
  `GMAIL_READ_QUOTA_UNITS_PER_MINUTE` (maximum 6000). GET requests retry at most
  three times after the initial attempt, using exponential delay and provider
  Retry-After. Mutations and sends are never automatically retried. Structured
  quota failures, including HTTP 403 rate limits, produce sanitized diagnostics;
  provider text, request IDs and credentials are excluded. The worker persists
  failure backoff and pauses authorization failures for explicit reconnection.
  `GET /api/accounts/:id/sync` includes next-attempt/error/success timestamps,
  failure count, reconnect requirement and initial catchup progress. Polling is
  eventual synchronization; push notifications remain unimplemented. See
  [Gmail quotas](https://developers.google.com/workspace/gmail/api/reference/quota)
  and [error handling](https://developers.google.com/workspace/gmail/api/guides/handle-errors).
- `POST /api/drafts/:id/sync` explicitly creates or replaces this replica's own
  Gmail draft, persists its provider ID, and uses that ID for subsequent updates
  and sends. Existing provider drafts are not imported for editing. To avoid
  silently destroying a provider draft, local deletion of a provider-synced draft
  returns 409 and directs the user to manage it in Gmail.
- Sends and schedules require every To/Cc/Bcc recipient to appear in
  `APPROVED_TEST_RECIPIENTS`, configured only after explicit user authorization.
  The authenticated account email must also appear in `APPROVED_TEST_SENDERS`;
  an empty sender or recipient list disables delivery. Both lists are checked
  again before scheduled dispatch, and unapproved senders fail before network
  access or a delivery attempt is created. Provider status exposes both lists
  and reports delivery enabled only when credentials and both approvals exist.
  Demo accounts cannot deliver. Before the provider call, an atomic SQLite
  transaction records a delivery attempt, an opaque delivery header, a requested RFC Message-ID, and
  `sending` state. Interrupted startup attempts and ambiguous exceptions become
  `delivery_unknown`; they cannot be edited, rescheduled, deleted, or resent.
  Reconciliation checks up to 50 recent Sent metadata candidates and requires one
  exact opaque header match with Sent/account identity and a complete bounded
  scan. Requested RFC IDs, subject and body are never fallback proof. Legacy
  unknown attempts without a marker, duplicate matches, incomplete scans and
  absent matches remain locked. Provider-assigned RFC IDs are stored separately;
  optional metadata enrichment cannot downgrade an acknowledged send. No automatic retry follows
  an ambiguous attempt. Preflight failures can be `failed` without dispatch.
  Scheduler jobs re-read each draft immediately before dispatch and never replace
  a newer sent/in-flight state with a captured scheduled snapshot.
- `GET /api/drafts/:id` reads the exact local draft, including `sent` records
  omitted by the draft list. It returns `{draft,deliveryPending}` with no-store
  caching and makes no provider or reconciliation calls. `deliveryPending` is
  true from dispatch admission through queue wait and completion, so it can be
  true while the stored status is still `draft`. After a lost send response,
  clients must keep dispatch locked while this flag is true or the status is
  `sending`/`delivery_unknown`. A known `sent` result confirms completion;
  `delivery_unknown` requires the explicit reconciliation endpoint. Missing IDs
  return the existing `not_found` 404. This follows the local workspace's existing
  trust model for connected accounts; the route adds no new provider authority.
- Provider sync, thread actions, undo, send, reconciliation, and draft sync share a
  serial operation queue per account. Drafts are re-read within the queue. This
  local development process is the single owner; multiworker deployment needs a
  shared job/locking implementation before it is supported.
- OAuth success is separate from mailbox synchronization. A transient initial
  sync failure preserves the authorized account/tokens and records a sync error
  visible through `GET /api/accounts/:id/sync`; retry synchronization instead of
  forcing another authorization flow.
- Claude is the default inline AI provider (`AI_PROVIDER=anthropic`). It requires
  `ANTHROPIC_API_KEY` and an explicit `ANTHROPIC_MODEL`; no model is silently
  selected and no provider fallback occurs. `ANTHROPIC_WORKSPACE_ID` is optional
  for a key scoped to one workspace and required for an unscoped key. The adapter
  calls Anthropic's Messages API with version `2026-10-21`, a 4,096-token output
  limit, no tools, and a 60-second deadline. Only the selected thread's last ten
  messages are included, with explicit total/omitted message counts. Each body is
  limited to 4,500 characters, sender names to 200, addresses to 320, and dates to
  64; messages are marked when truncated. Unselected requests have no mailbox
  context. HTML-only email uses sanitized, nonexecuting HTML-to-text fallback
  before the body limit; HTML parsing is capped at 500,000 source characters.
  Incomplete, refused,
  malformed, and provider error responses are explicit failures; there are no
  automatic generation retries. This inline endpoint has no retrieval tools,
  streaming, or automatic mailbox mutation. Selected thread context now requires
  an explicit matching `accountId`; foreign/missing context is rejected before
  body loading or generation. Missing credentials return 503 with
  `ai_not_configured`; no canned response is substituted. Provider status exposes
  `provider`, `displayName`, `configured`, `missing`, `model`, and
  `liveVerified:false`. Configured means the settings are present, not that the
  key/model has been tested. Separate synthetic inline checks do not verify
  persistent chat or retrieval.
  The optional OpenAI adapter requires explicit `AI_PROVIDER=openai` plus
  `OPENAI_API_KEY` and `OPENAI_MODEL`; it retains Responses API `store:false`.

  The separate persistent `/api/ai/chat` contract, durable stream/recovery,
  bounded local index/cache retrieval and source receipts are documented in
  [AI-CHAT.md](AI-CHAT.md). It has independent offline/live comparison gates and
  never runs the optional OpenAI inline adapter as an automatic fallback.

  To configure locally after obtaining a key, use a private file rather than a
  command-line key value:

  ```sh
  node scripts/configure-superhuman.mjs --ai-provider anthropic --ai-key-file /absolute/private/key.txt --model YOUR_ENABLED_MODEL_ID
  ```

  Add `--ai-workspace YOUR_WORKSPACE_ID` only when needed. The helper writes the
  ignored local `.env` with mode 0600 and prints variable names, never values.
  AI flags are order independent; omitting `--ai-provider` selects Anthropic.
  Anthropic's model catalog currently lists `claude-opus-5-5` for most workloads;
  this is a documented option, not a configured default or verified account grant.
- Microsoft Outlook, calendar, contacts, collaboration, imported provider-draft
  editing, and read tracking remain explicit gaps.

Implementation references: [Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server),
[official sanitizer documentation](https://github.com/apostrophecms/apostrophe/tree/main/packages/sanitize-html),
[parse5 documentation](https://parse5.js.org/),
[Gmail thread/message APIs](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list),
[Gmail sending](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send),
[Gmail synchronization](https://developers.google.com/workspace/gmail/api/guides/sync),
[Gmail history](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list),
[Gmail draft updates](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/update),
[Claude Messages API](https://platform.claude.com/docs/en/api/http/messages/create),
[Claude authentication](https://platform.claude.com/docs/en/api/overview),
[Claude API versions](https://platform.claude.com/docs/en/api/versioning),
[Claude models](https://platform.claude.com/docs/en/models/overview),
[Claude stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons),
and [official OpenAI text-generation documentation](https://developers.openai.com/api/docs/guides/text).

## Normal composer durable Send candidate

The private implementation adds account-scoped keyed composer Send/Undo routes
without replacing an existing Draft ID. See [COMPOSER-DELIVERY.md](./COMPOSER-DELIVERY.md)
for request/receipt recovery, same-draft restoration, frozen reply context,
shutdown/ownership boundaries and remaining Gmail cloud-draft gaps. A fresh
keyed intent is required after any confirmed Undo; a delayed keyless Send or
schedule cannot rearm the cancelled message. This source candidate is not a
record of live Gmail verification or rollout.

## Explicit Instant Send candidate

[ACCELERATION.md](./ACCELERATION.md) documents the shared scoped receipt control
for an already accepted immediate AI/composer Send. Acceleration preserves one
provider attempt and original deadline audit; it never authorizes a scheduled
message or an unknown retry. The private375 source checkpoint includes keyed
Send later and its independent shutdown-race fix. Apply matching frontend
journals/deadline-transition validation together with this backend candidate.

## Private Knowledge candidate

[KNOWLEDGE.md](./KNOWLEDGE.md) documents durable account-private raw uploads,
real21-format text extraction, bounded public-page snapshots, source lifecycle
and typed Ask AI receipts. It adds no model calls on upload/save/read and no team
sharing. Team permissions, full-domain crawling/live refresh and original parser
fidelity remain open. Root/main deployment and original comparison are separate.
[Knowledge action recovery](KNOWLEDGE-RECOVERY.md) adds immutable upload/link/retry
receipts and read-only deleted/unavailable-target resolution in the subsequent
private candidate. It never repeats ingestion to recover a lost acknowledgement.

Saved account preferences and immutable AI-turn snapshots are described in [Personalization](PERSONALIZATION.md).
Legacy cached Gmail scope adoption is documented in [Mail grant migration](MAIL-GRANT-MIGRATION.md).
