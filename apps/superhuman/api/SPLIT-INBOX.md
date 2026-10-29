# Local configurable Split Inboxes

This is an account-scoped local implementation. The original's untouched custom form and retained static paths support the surface and some membership rules; they do not establish full matching, defaults, provider classification, or save semantics. See the application research records `split-inbox.md` and `split-inbox-runtime.md` for the evidence boundary.

There are no Gmail calls, classification jobs, configuration writes on GET, or startup-created Split Inboxes. Existing global Preferences and all Draft/Thread records are preserved. A first explicit save creates an account override; other accounts and the legacy thin-list endpoint keep their current behavior.

## Routes

- `GET /api/split-inboxes?accountId=...` returns `{settings,capabilities,validation}`.
- `PATCH /api/split-inboxes` accepts `SplitSaveRequest` with the account in the JSON body. Query parameters are refused before acceptance.
- `GET /api/split-inboxes/requests/by-request/:clientRequestId?accountId=...` recovers an immutable accepted settings snapshot and receipt. It does not rerun the mutation.
- `POST /api/split-inboxes/validate` accepts `{accountId,query,autoLabelIds,autoLabelJoin}` and returns `{validation}` without saving.
- `GET /api/split-inboxes/views?accountId=...` returns counts, coverage, configuration revision, compiler policy, and account source generation.
- `GET /api/split-inboxes/views/:encodedViewRef/threads?accountId=...&limit=50&cursor=...` returns up to100 `ThreadSummary` rows. No messages, HTML, or body fields are added. This route has no free-text `q` parameter.

Browser-safe shapes are in `src/split-inbox-types.ts`. Query parameters must be unique and recognized. Every route explicitly selects an existing account; foreign custom IDs and keys return `split_not_found`.

## Configuration and recovery

New custom definitions contain name, query, enabled, leaveThreadsInImportantOther, hideEmpty, and a separate Auto Labels selection/join. IDs are server generated and independent of names. Names and queries are trimmed; names are unique after local NFKC/lowercase/whitespace normalization. There are at most32 custom definitions, ordered groups are not relevant to this query dialect, and configuration order includes builtin refs plus every custom ref. Reordering is an exact permutation, including disabled definitions. Enabling, query edits and logical exclusion edits advance definitionRevision; all accepted save actions advance settings revision.

Before the first account save, recognized Important/Other/Calendar order is read from legacy global Preferences. Absent Preferences use local Important/Other fallback. Unknown global entries are left untouched rather than treated as implementable definitions. The response marks this as `legacy-global`, `persisted:false`, revision0. Its basis fingerprint detects changes before the first save. After the first save, the account override and revision define its basis.

A save supplies `clientRequestId`, `expectedRevision`, `expectedBasisFingerprint`, and1–64 ordered changes (create/update/delete/reorder). One SQL transaction stores the resulting configuration and receipt. A separately stored acceptance digest and shared semantic validator bind the persisted snapshot, capabilities, timestamps, created IDs, query/label validation and final ordered effects to its immutable request. A known same key and exact same request recovers its original accepted response before checking the current revision. Reusing it for another intent conflicts. Older prototype request rows without a separately retained acceptance proof fail closed with split_artifact_corrupt; GET/replay never fabricates a new historical proof or reruns their changes. Current settings remain readable. Lost-response recovery is read-only; an unknown by-key404 is not proof that an earlier POST/PATCH never arrived.

Receipt `requestProtocol` is `split-save-v1`. Its fingerprint is lowercase SHA256 of UTF8 stable JSON:

```text
{protocol:"split-save-v1",request:exactValidatedRequestExceptClientRequestId}
```

Stable JSON recursively sorts object keys and preserves array order. The fingerprint binds the raw accepted typed intent, including the selected account and expected basis/revision. Name/query trimming in the resulting settings is separate. `receipt.request` echoes that intent with its client key. Recovery `settings` and `validation` are historical accepted data; fetch current settings before installing a recovered configuration in a newer view. This is a local reliability contract, not a recovered original server protocol.

## Supported matching

The compiler fully consumes the query; malformed or unsupported input never falls back to a broad all-mail search. It supports explicit `AND`, `OR`, parentheses, braces with implicit OR, implicit AND elsewhere, `NOT`/`-`/`!`, quoted values and quoted quote/backslash escapes, and field inheritance such as `from:(a OR b)`.

Supported criteria are `subject:`, `from:`, `to:`, `cc:`, `label:`/`l:`, `in:inbox`, `in:sent`, `has:attachment` (plural alias accepted), and `is:starred` (flagged alias accepted). Subject/name substring matching uses local NFKC/lowercase/whitespace normalization. A valid email matches that role's exact normalized email; `me` uses the selected account email. A valid dotted bare domain or `@domain` matches that role's exact domain. Other bounded role values match its local display-name/email text. Headers are matched across a thread's messages; different terms may match different messages. This thread-level choice has not been compared against the original matcher.

From, To and Cc are projected separately. Cc never becomes To or From. No Bcc membership is inferred from participant lists. Quoted comma names and literal numeric DNS labels are preserved in the derived metadata.

Label lookup is account scoped and requires one exact ID/provider ID or one normalized name. Saved label identity is pinned. Renaming/removing/replacing that label makes the definition unavailable; it is not silently rebound to another label with the old name. Edit the query to explicitly bind a different label. Color-only edits do not change label identity.

Auto Labels selection, dates, filenames, category, list headers, shared state, Bcc, unread and other status-style criteria are unavailable in this milestone. Typed Auto Labels yield422 `split_auto_labels_unavailable`; raw `autolabel:` yields400 with an explanatory query error. The UI must not advertise working options for unavailable families. Query policy bounds are2048 UTF16 units,4096 UTF8 bytes,128 tokens,64 AST nodes,8 nesting levels, with no controls or unpaired surrogates.

## Membership, counts and cursors

Base eligibility preserves today's local Inbox membership: physical INBOX (or folder fallback) and not snoozed. Mixed INBOX/SENT and received+draft threads are retained. Calendar retains the existing local label heuristic; this is not proof of the original calendar classifier.

Custom splits overlap. A matching enabled custom definition whose leaveThreadsInImportantOther is false excludes the thread from effective Important/Other, using the union of those matching definitions. It does not remove INBOX or alter important, labels, folders, unread state, or any provider resource. All configured view lists use the dedicated view endpoint so their displayed counts and rows share this policy. Legacy `/thread-summaries` counts and behavior are deliberately unchanged for older clients/harnesses.

Counts are thread totals with explicit isComplete/isEstimate. Coverage `complete` means the currently imported local metadata snapshot only, not the full remote mailbox. Pending/truncated/malformed header metadata on eligible Inbox threads, or unavailable enabled bound labels, remain visible as unknown; Sent-only/snoozed/foreign pending metadata does not downgrade this Inbox snapshot. They must not hide an apparently empty view. Disabled custom views remain in settings but are not pageable. Their validation diagnostics remain visible, but an invalid disabled definition alone does not downgrade active-view coverage. The browser applies hideEmpty only for complete zero and retains the selected empty view.

A read transaction binds counts/page to settings revision, account source generation, compiler policy, bound label identities and account email. Keyset cursors use SQLite's UTF8 BINARY date/ID tuple ordering. A source/configuration/account/view context change rejects a previous cursor with409 `split_page_stale`; do not append a mixed page. Limit changes are allowed without changing membership.

## Storage and compatibility

Pure SQL triggers invalidate derived headers, queue bounded body-free subject/role snapshots, and advance account source generations on thread/label writes. INSERT OR REPLACE with recursive triggers off also invalidates prior-account state. Store.put refreshes its thread's metadata inside the existing write savepoint. No process-local SQL functions are registered.

A one-time transactional derived-header migration scans existing record JSON but copies only subject and From/To/Cc fields. It does not rewrite user records, create settings, enroll drafts, request provider data, or classify mail. It rolls back derived state and its marker on failure. Old SQL writers that only queue metadata expose pending coverage until an explicit compatible metadata refresh/write; an ordinary restart after the migration marker does not drain that queue; GET does not materialize full messages or silently drain jobs. Bounded clipping is explicit unavailable coverage, not a complete negative match.

Common lists/counts use thread_summaries and header metadata indexes. A synthetic10k-thread fixture (9k in the selected account,4.6KB body per message) produced a50-row17,384-byte page in18ms and views in16ms on one local run; the query plan used account Inbox and role/email indexes, with0 full-message JSON parses. These figures are a bounded engineering check, not a service-level guarantee or original performance comparison.

## Errors and tests

Errors use the existing nested `{error:{code,message}}` envelope. Request/query validation errors are400; known unsupported/missing/ambiguous criteria are422; missing account/view/key is404; stale revision/basis/key/name/cursor is409; malformed persisted artifacts fail500 `split_artifact_corrupt`. PATCH validation/conflict/404 failures roll back before acceptance. By-key404 after a transport uncertainty stays unresolved.

Focused tests cover strict parsing, role isolation, mixed-label membership, overlap/union exclusion, no physical mutations, CAS and immutable recovery, rollback, pinned label identity, no-body reads, UTF8 cursor ties/staleness, isolated HTTP routes, migration idempotence/rollback, legacy SQL invalidation and a bounded10k fixture. No original Split setting or provider was changed by these tests. Full original create/edit/reorder/hide/keyboard parity remains open until separately authorized controlled original evidence and replica comparison exist.
