# Private tracked-delivery implementation

This is a local implementation contract. It does not recover the original service protocol, prove hosting, or verify full read-tracking parity. This candidate descends from the preserved reviewed587 foundation and is separate from the current application and every prior source archive.

## Supported scope

The first milestone supports an explicit keyed composer Send or Schedule with meaningful sanitized HTML and an existing replica-owned, cloud-saved Gmail draft mapping. It freezes the tracking decision in the same SQLite transaction as that delivery generation. Default preferences remain locally disabled; this is not a claim about original account defaults.

Direct artifact Send creates a fresh local draft without a Gmail mapping. When tracking is desired it therefore refuses before acceptance with `tracking_mapped_draft_required`, without creating a shadow cloud draft or silently sending untracked. The supported action is Create Draft, wait for Cloud saved, then Send from that composer. Artifact Send remains supported when its accepted decision is untracked. A future explicit `unmapped-message` native kind for artifact Send requires a separate contract and review; it must not be a fallback from a missing mapped draft.

Plain-only tracked input refuses with `tracking_rich_html_required`. Keyless delivery while tracking is desired refuses with `tracking_keyed_intent_required`. Previously accepted untracked generations remain untracked after a later preference enable. No legacy drafts or messages are enrolled on startup, reads or autosave.

Public capabilities deliberately keep effective Read Statuses and Recent Opens false. Collector registration/arming/confirmation is implemented internally, but authenticated event import, public per-message read evidence, feed projection, UI, hosting and original comparison remain separate work. The feed route returns an explicit unavailable envelope, not a cosmetic empty successful feed.

## Immutable data and composed hooks

Five private tables store random account refs, generation bindings, collector packets, actual wire BLOBs and control receipts. Account refs are random and scoped to configuration identity; they are not derived from email. Every binding has one frozen source family, account, operation, generation, draft/revision, authored identity, preference revision/decision, sender/reply/attachment byte identity and configuration basis. Tokens, collector refs and origins stay private. A separate immutable acceptance digest commits those original fields. New source-owner intents atomically mark their decision required; a missing decision cannot be confused with true legacy/default0. Legacy rows are not enrolled or rewritten. Collector packet input/basis and positive-result digests are separately committed, and persisted receipts reuse the native strict decoder. Registration state must match that exact positive proof chain.

New synchronous keyed observers compose with the existing artifact/composer delivery hooks and provider-draft lifecycle hooks. They do not replace them. Acceptance and cancellation observers run inside their existing SQL transactions. Collector calls never occur inside a SQL hook or transaction. Undo and schedule waits remain outside the shared account queue.

After exact owned-provider preflight, one create packet is journaled before its first POST. A proven prepared receipt permits the existing local delivery claim. That same claim transaction writes one decorated MIME BLOB and a separately committed wire identity tuple: attempt ID, SHA256, mapped draft ID and reply thread ID. The tuple cannot change after claim. Blob self-hashes alone confer no authority; status and final native issue compare actual bytes and metadata against that committed tuple.

The MIME builder sanitizes authored HTML with the unchanged policy, then appends one fixed canonical collector pixel to the private wire HTML part. It does not change stored authored HTML or globally allow IMG. Plain text, headers, reply context and attachment bytes remain the accepted source. Boundaries are random and the wire is built once; no second MIME build is used as an equality oracle. The BLOB is independent of autosave snapshots and survives their normal Sent pruning.

## Truthful delivery phases

A local attempt ID is not proof of a Gmail request. Tracked attempts first have status `not_issued`. Collector create/arm failures become owner state `held_before_provider`, draft state `delivery_held`, and public phase `held_before_gmail` with mail outcome `not-issued`. This state does not use generic Check Sent, cannot silently retry, and keeps the original draft locked.

After a proven armed registration, the tracked Google method accepts only the persisted mapped draft/raw payload. It cannot rebuild MIME, choose `messages.send`, recreate/delete a cloud draft or fall back after a missing mapping. After all awaited credentials and preflight work, a synchronous once-only SQL permit rechecks ownership, close state, preferences/configuration, accepted bytes and wire tuple immediately before entering the fetcher. The durable phase is `issue_possible`: a crash between permit and transport remains conservatively ambiguous. Only a controlled transport observation can prove an actual request occurred.

A valid provider resource ACK commits Sent through the existing owner and provider-consumption transaction. Tracking confirmation is separate, optional work after that primary commit. A confirmation timeout or malformed response leaves Sent intact and tracking pending. The ACK ref binds the exact account/source/generation/attempt/provider resource tuple and does not depend on a later RFC Message-ID enrichment; Gmail can rewrite that header. An ACK SQL failure remains Gmail unknown and cannot confirm tracking from the transient response.

## Cancellation and recovery

Queued immediate Undo and scheduled Cancel preserve the same draft and authored identities and do not arm tracking. Scheduled cancellation remains valid until local claim, including while a prepared-create ACK is deferred. A late exact prepared receipt can be stored historically after cancellation but cannot arm, claim or resurrect that generation.

Every collector create, arm or confirmation step has one durable fixed key and packet. It receives at most one POST. Unknown/rejected/malformed outcomes stay locked for exact-key GET recovery;404 never proves nonacceptance. Successful recovery GETs update proof only and never dispatch Gmail.

Explicit continuation is a new durable command for the original known-never-issued generation. A not-started step may perform its first POST after review and restoration of matching configuration/enabled preferences. An issued/unknown step requires positive exact-key receipt proof and can never POST again. A claimed continuation reuses the original attempt and wire. An issue-possible operation cannot continue or resend.

Configuration replacement/removal or preference disable before native issue holds the frozen tracked intent. It cannot silently use a new origin/token or fall back to untracked. There is no abandon/restore-after-claim operation in this milestone; an unresolved hold remains locked. Another live owner cannot adopt it. Restart performs local phase recovery only and never auto-creates, arms, confirms or dispatches tracked generations. Old owner callbacks and exact duplicate proofs cannot overwrite a newer owner or regress confirmed tracking.

## Browser routes

Types are in `src/tracking-delivery-types.ts`. All routes use the existing loopback Host/Origin boundary. They expose no token, origin URL, collector registration/delivery/tenant/account ref, MIME or signing key.

| Route | Behavior |
| --- | --- |
| `GET /api/tracking/capabilities?accountId=...` | Local supported-family/native-kind limits and explicit unavailable read/feed/hosting status. |
| `GET /api/tracking/deliveries/:source/:operationId?accountId=...` | Local exact operation status; no upstream request. `source` is composer or artifact. |
| `POST .../:operationId/reconcile` | Strict `{accountId,clientRequestId,expectedRevision}`; durable receipt, bounded collector GET proof only. |
| `POST .../:operationId/continue` | Same strict shape; explicit original never-issued continuation with current proof and owner fences. |
| `GET .../:operationId/requests/by-request/:key?accountId=...` | Exact historical control receipt/snapshot; no retry or work launch. |
| `GET /api/tracking/feed?accountId=...` | Explicit `event-import-not-integrated` unavailable envelope; no collector request. |

New owner snapshots have an optional browser-safe `tracking` identity; legacy snapshots omit it, avoiding unscoped status probes. Tracking status revision is separate from the delivery owner's revision. Only heldReason/canReconcile/canContinue may vary at the same revision, reflecting current configuration/policy/liveness; primary mail outcome and proof changes advance revision.

Control fingerprints are SHA256 of recursively sorted JSON `{protocol:"tracking-control-v1",request:{accountId,source,operationId,action,clientRequestId,expectedRevision}}`. Acceptance atomically persists a fixed receipt and initial snapshot with state `accepted`. GET during work returns that snapshot without completing or restarting the action. One bounded action may commit a final snapshot with state `completed`; it is immutable thereafter. Accepted and completed snapshots have separate SQL proof digests plus scope/generation/decision/native-state validation. Historical recovery never substitutes the current snapshot. Prototype records without their proof remain unverifiable; migration does not fabricate acceptance history.

Nested errors are `{error:{code,message}}`:400 `tracking_delivery_invalid_request`;404 `tracking_delivery_not_found`;409 `tracking_delivery_conflict`, unsupported-input codes, or `tracking_delivery_held`;500 `tracking_delivery_corrupt`;503 `tracking_delivery_stopping`. Validation/conflict/stopping refusals are before control acceptance. Network/500 or recovery404 after uncertain transport retain the command key. No error authorizes automatic POST replay.

## Clock, reader and privacy limits

HMAC freshness and real transport timeouts use collector wall time, independently of the injected Undo/schedule deadline clock. No environment, credential file or key loader was added; server configuration remains explicit programmatic injection. No constructor, GET preferences/status/feed, autosave or event parsing initiates a collector request.

The existing message iframe data-only image CSP is unchanged. Authored/quoted sanitization continues removing IMG, so outgoing tracking does not enable sender/preview/reply pixel fetches. No browser, real recipient image fetch or original tracked delivery is claimed by the in-memory tests. Collector evidence remains anonymous image-fetch data; it cannot identify a human/named recipient or prove Sent. No per-recipient viewer query is emitted. No public event import/feed route or self-assertion protocol exists yet.

Wire BLOB retention is indefinite in this private milestone. A future retention policy must preserve immutable identity and state truth; absence of a BLOB cannot be described as independently reparsed byte proof. Hosting, ingress/key provisioning, feed/UI, authenticated self policy and the explicit unmapped artifact native kind all remain open.

## Migration and rollout boundary

The two source-owner ledgers gain a metadata-only `tracking_required` column with legacy default0. New intents mark1 only after their required observer and decision have been accepted in the same transaction; loss of that decision is corruption, never permission to use current disabled preferences. True legacy0 remains untracked without enrollment, including after a later enable. Original draft JSON, attachments and global preferences are not backfilled. Existing prototype tracking records without immutable acceptance/packet/control proofs are unverifiable; the migration does not synthesize them.

Rollout requires a source backup and coherent stop of older API instances. Older owner binaries with positional INSERT statements are not supported concurrently against these widened private ledger schemas. This candidate does not apply any schema to the main database, install hosting, supply real keys, or authorize a live tracked delivery. The collector sibling protocol is the reviewed v3 ancestor; the separately reviewed deployment adapter must be combined by the parent without replacing its newer files. Matched UI and later read-import/feed work remain separate checkpoints.
