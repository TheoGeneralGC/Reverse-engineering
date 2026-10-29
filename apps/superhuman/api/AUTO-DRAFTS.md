# Auto Drafts: guarded response generation

Auto Drafts v2 can create a reply draft for a new authenticated Gmail incoming version after Responses is enabled. New account settings default OFF as an explicit local choice; existing mail, drafts and any v1 setting are not enrolled or adopted. Original settings, generation and presentation evidence remain in the application research records. Synthetic API tests establish implementation behavior, not original trigger cadence or model-quality parity.

The standard CLI uses the existing AI_PROVIDER selection (default anthropic), selected provider MODEL/API_KEY and optional ANTHROPIC_WORKSPACE_ID. It uses the reviewed bounded model adapter and exact prepared request identity. A purpose-separated HKDF-SHA256 history cursor signer derives from the existing valid TOKEN_ENCRYPTION_KEY; no new key file or environment variable is required. Without that Google/server key the v2 runtime stays unconfigured. Malformed trusted configuration refuses before application startup; missing model credentials/model leave Responses pending and cause no model request. Temporary cursor bytes are cleared after the factory copies them. Keys and key hashes never enter model-profile versions or history.

`createApp` defaults are unchanged for callers that omit the trusted autoDraftGeneration option. The configured CLI enables server-side processing, while Responses remains OFF until the user's direct settings save. There is no second Activate or cost-confirmation screen. Startup/readiness observation can prefetch field-masked primary/alias identity through the existing Gmail grant. Status GET does not fetch, repair or dispatch. Direct ON establishes a forward barrier when ready; if model/identity/baseline is unavailable it stays pending, then establishes a fresh barrier once readiness returns. Opening settings or saving ON never backfills older mail.

## Generation and ownership

The producer records positive live Gmail messagesAdded provenance, immutable source versions and an atomic outbox alongside thread publication. Initial scans, rescan/repair, repeated sync, read/label/snooze changes are not new generation triggers. Admission waits for successful sync completion. One prepared model request is durably claimed and marked issued only after fresh source/preferences/readiness/ownership checks. Models never hold the account provider queue or SQL transaction. A normal empty sync can finish while the model is pending; genuine source, configuration, preference, human ownership, Send/schedule/Undo/discard or close changes fence publication.

Local draft creation, provenance, immutable publication and job result commit atomically. Server-derived headers and one verified reply recipient are used; generated output cannot choose a target or automatically Send/schedule. The default trusted generated-local origin skips Google draft enrollment. Explicit
managed mode uses a distinct generated-only origin, with local publication and
provider enrollment in one unit. It never adopts legacy/manual drafts. Existing manual drafts are not overwritten, and create/discard or edit/revert ABA remains guarded by durable versions/tombstones. Unknown issued model outcomes are retained and never automatically retried. A later distinct incoming source is a distinct job. Account/global queue and one-call bounds are local operational policy, not original entitlements.

This slice is create-only Responses. Existing-draft update, reminder Follow-ups
and authorized teammate scheduling remain unavailable. The trusted CLI
`AUTO_DRAFTS_PERSISTENCE` is omitted/`local` by default or explicitly `managed`;
empty/unknown modes are invalid. Managed capability requires processing and
provider automatic saving, and is not proof of a Gmail ACK. Mode-bound profile
and observed epochs fence queued work across restart, including local/managed/
local ABA. Main now explicitly uses managed persistence with Responses off and cloud
capability true. That does not prove a generated draft reached Gmail; actual
rollout and remaining real cloud verification are recorded in the [combined checkpoint](../research/final-combined-checkpoint-20261029.md). Generated local replies include a reconstructed safe dated source quote, using the immutable source snapshot and a frozen effective IANA timezone. Production resolves valid explicit TZ or the machine's resolved IANA zone before work; clean synthetic/custom factory injection defaults UTC. HTML-only source is sanitized and extracted before bounded model context. No remote image fetch or vendor HTML is used. Quotation alone never grants cloud or authoring authority. The UI mounts the one
ordinary composer beneath the exact proved source. Its proved tail is hidden
until one-way expansion, which enters full-quote editing and submits a normal
conditional human claim. It is not a reversible Show/Hide disclosure. Untouched
open/focus/close stays zero-write; edits and edit/revert remain human claims.
The original pointer observation is separate from keyboard/focus/geometry parity.

## Shared HTTP contract

`src/auto-drafts-generation-contract.ts` is the browser-safe canonical generation schema; `src/auto-drafts-contract.ts` retains the original settings parsers. V2 has its own preferences/receipts storage and client journal namespace. V1 routes remain settings-only with generation flags false and do not activate the v2 worker.

- GET `/api/auto-drafts/v2/status?accountId` returns committed engine/readiness/usage and preferences, with no writes, network, model work or repair.
- PATCH `/api/auto-drafts/v2/preferences` accepts one exact field CAS/key and reuses canonical SaveResponse. GET `/api/auto-drafts/v2/requests/by-request/:key?accountId&section` recovers its immutable acceptance without resubmission.
- GET `/api/auto-drafts/v2/generations?accountId&limit&cursor` and `/generations/:id?accountId` expose opaque scoped local history. A cursor binds account incarnation and fixed membership.
- GET `/api/auto-drafts/v2/sources/:sourceRef/target?accountId&expectedInputVersion` and `/targets/:targetRef?accountId&expectedTargetVersion` resolve only exact current scope/version.
- GET `/api/auto-drafts/v2/thread-publication?accountId&threadId` supplies the independently verified current publication for that thread and its exact source Message.id. It does not choose the latest global job or expose model context. UI loads Mail and re-resolves the same binding before attaching inline/opening the editor. Human/source change or deletion and ambiguous eligibility yield unavailable; retained proof contradictions are errors. Harmless unread/star/sync metadata does not invalidate the binding. An untouched reply remains attached to its verified earlier message when a later message arrives; later-message update semantics are a separate unverified phase.

Historical acceptance is validated against independent reviewed prior commits and receipts, not just mutable JSON/self-hash. GET never recreates acceptance from today's state. Shutdown fences native reads and preference acceptance after awaited preparation. These are partial-record integrity checks, not a claim against an attacker rewriting the entire database and all proofs.
