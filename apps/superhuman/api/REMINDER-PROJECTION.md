# Reminder presentation and reply sources

This integration is an independently implemented, bounded behavior contract.
It is verified with synthetic provider responses and isolated databases. It does
not establish complete Superhuman parity or verify the original's entire
reminder transport. All native reminder browser capabilities and Follow-ups
remain unavailable; presentation cannot enable them.

Gmail FULL imports retain bounded private header facts with the current shared
account incarnation, decoded per-message Subject, strict singleton author and
content fingerprints. Metadata-only normalization and legacy cached messages
have unknown coverage. A complete empty header list is distinct from unknown
coverage; it still cannot supply an absent author. Raw chronological messages,
bodies and attachment records remain intact.

The server recomputes visibility and reply sources. A coherent original
three-header trigger is a hidden system candidate; it does not authenticate a
local return. An own carrier is hidden only when its account/thread/provider
identity, observed native journal, accepted plan, body and HMAC independently
match. Bare own markers, malformed/mixed markers and incomplete facts supply no
ordinary incoming authority. Source/author/header facts, witness IDs and contact
exclusions are omitted from every normal JSON response, including nested
snapshots. Direct reminder and AutoDraft facades retain explicit DTO allowlists.

Conversation display uses the last real message's decoded subject and sender,
while preserving the actual latest timestamp and full raw message array. Shared
selectors exclude hidden system messages from visible message rendering,
contacts, search, Split address metadata and AI text. H7 requires clear,
authoritative ordinary context and never generates an ordinary response from a
recognized system or unknown source. A fresh later real message may support a
manual reply despite an older indeterminate carrier; H7 still rejects that
ambiguous whole context. Follow-ups have no returned-outbox consumer.

Google reply/Reply All/Forward and uncaptured delivery fallback anchors require
FULL facts and a valid MAIL grant. A new reply captures only its immutable
Message-ID/References/provider-thread tuple. Existing draft authored fields,
attachments, rich editor state and already captured delivery contexts remain
unchanged. The browser may render cached content while it issues an explicit
`POST /api/threads/:id/hydrate` with exactly `accountId` and `expectedVersion`.
That intent reads profile identity and the exact FULL thread, keeps source and
account/grant fences across awaits, and commits attachments plus Thread atomically.
It does not publish live ingress, reset a baseline, enroll drafts or run a model.
GET remains local and never adopts an account. A refresh can explicitly adopt the
current valid account through the existing model-independent authority; concurrent
adoption or account replacement cannot silently bind the original source intent.

Browser detail/context epochs and AbortSignals discard late thread/account or
composer replacements. Cached reply controls stay unavailable until ready;
failed refresh leaves cached content and an explicit Retry. Known synthetic local
fixtures keep their separate local behavior. Private header facts and descriptive
presentation/label/tracking/snippet renewals are separated in source commitments;
author/body/header changes still fence generation and publication.

Limits: at most 200 messages per classified thread, 256 headers per message and
64 KiB header metadata; each header value is at most 16 KiB. Explicit hydration
uses a 25-second read window and 4 MiB response limit. Oversized/incomplete or
unavailable identity/grant cases remain unavailable. No bulk backfill of legacy
header authority occurs. New derived metadata triggers update on future writes;
existing original records and historical receipts are not rewritten by setup.

Acceptance coverage is in `test/reminder-projection-integration.test.ts`, the
factory encoded-Subject/return/restart cases, existing H7 worker/App suites, and
browser hydration/editor/switch/retry cases in `web/test/draft-transitions.test.ts`.
Actual browser rendering against the original and owned-provider acceptance
remain separate evidence requirements.

Credential refresh is independent service maintenance. Provider construction
installs one model-independent semantic grant-mutation registry and its three
triggers; it creates no grant heads or account adoption. Only the exact service
head is seeded at a first refresh, at mutation epoch zero. A real semantic grant
UPDATE/DELETE records a mutation even when its head was previously absent;
metadata/time/scope-order changes do not. An absent head and a first-refresh seed
both mean zero mutations, so a legitimate same-scope refresh can finish hydration.
Mail and Calendar heads and sealed slots remain independent.

A coalesced refresh captures the sealed service slot, actual account identity and
shared incarnation/mutation stamp, and semantic grant head before exchange. Its
transaction checks those fences before saving a rotated token/grant. View
cancellation stops source publication, while a valid rotation can still finish
for an ordinary joined operation. Account/slot/scope replacement or ABA refuses
the superseded response. Account adoption-only noise does not replace credential
authority. Shutdown rejects new HTTP work, stops owned issue, drains shared
refreshes and then closes Store. An exchange that ignores its transport timeout
can keep that owned drain pending; shutdown does not discard a positively issued
rotation merely because a view closed. This is a local CAS, not a global provider
transaction or a new retry permission.

| Feature | Concrete acceptance | Verification limit |
| --- | --- | --- |
| FULL capture and classification | Unknown cached/metadata message becomes ready only after exact refresh; full raw chronology remains | Synthetic importer and rollback tests; original behavior is not globally verified |
| Subject/sender and hidden carriers | Original coherent carrier hides; observed own carrier hides across restart; malformed/bare/body-changed carrier cannot anchor | Actual factory with fake provider; original static marker evidence does not authenticate own returns |
| Browser refresh lifecycle | Cached messages render during load; reply waits; late account/composer response cannot replace current editor; Retry recovers | Actual React/controlled-promise tests; physical browser comparison is separate |
| Reply, forward and H7 | Last real subject/source selected; system/unknown admission produces no ordinary model call; clear human source generates once and keeps publication guards | Synthetic provider/model only for this integration; Follow-ups unavailable |
| Shared refresh maintenance | One exchange serves cancelled hydration plus valid joined operation; scope/account/slot ABA refuses; shutdown awaits rotation | Synthetic credential/CAS tests; no new live credential access or vendor parity claim |
