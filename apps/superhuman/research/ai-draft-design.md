# Ask AI draft preview and Create Draft

Recorded 2026-10-28. This records bounded original behavior and the reconstruction's
local implementation contract. After the earlier 16-case/407-step checkpoint,
the Create scope passed offline gates and the bounded live checks below. Those
results do not establish full draft/provider/Send parity. Persistent chat/retrieval
is a separate implemented phase; see [its contract](ai-chat-contract.md) and
[bounded live check](ai-chat-live-check.md).

## Observed original behavior

The target is the authenticated Superhuman web client in Chromium
`156.0.8078.48`. The retained static-source identity and its coverage limits are in
[ai-assistant.md](ai-assistant.md). These later captures do not add a new main
script digest. Account/session IDs, the controlled subject/recipient and complete
captures stay private. No extracted vendor implementation is copied here.

| Observation | Evidence and limits |
| --- | --- |
| Generate a controlled preview | `ev_34b12c8e20517ea7fe55e6b385f3e3a0f6b6b2ea939ed977e9a7cb33682fa6e5`: six actions/seven completed steps. One stable `.AIAgentCreateDraft-wrapper.inSidebar` card displays a To row with an authored reserved-domain recipient, a subject and a body. Its two buttons are `Send` and `Create Draft`. Neither was clicked in this capture. |
| Restore from chat history | `ev_16ece883acc864a81d4770131cb7dc194444edb24ca72a1661243fa7cace6db1`: four actions/five completed steps display history. The successful action capture below restores the owned preview from that history without submitting a new question. |
| First creation attempt | `ev_ed531241f1135ecf29120d6cd965f8fa618289e5b52ffe49fc1874f3957e430d`: scenario start completed; `inbox-ready` failed and all fourteen subsequent steps were cancelled. It does not establish a Create Draft click or result. |
| Transport/cleanup failure | `original-create-draft-cleanup-2.json` contains a `cleanup_incomplete` timeout error, with no Evidence record. Root reported an `Emulation.setEmulatedMedia` timeout and unconfirmed browser-transport cleanup. Its target/action outcome was conservatively unresolved, not inferred from absence of Evidence. |
| Recovery boundary | Root's default-sandbox doctor completed healthy. OS snapshots showed the original Chrome listening without established TCP clients; that is process/socket evidence, not provider cleanup confirmation. Passive `ev_32feac82c059200c630f9c291c685d458f03928aa85140e9c922fc4679a2be32` then inspected the target with policy-filtered/attach-limited coverage. A later retry used the returned remediation's 60-second command timeout. No generic unrelated cleanup was substituted. |
| Create the owned draft and clean its fields | `ev_08a45c59c3c5a553da48eb6e57ec08b4b0fa4d0b112982ce5576164e85b7cdfb`: fifteen actions/sixteen completed steps. Clicking `Create Draft` opens a standalone composer while Ask AI stays present. The exact owned subject and reserved recipient are checked before cleanup. The preview card contains the requested fictional facts: Thursday at 3 PM and three samples. Cleanup targets only that new controlled draft's recipients, subject and body; the declared clear/close/subject-hidden/Inbox-restored steps complete. Editable-body transfer/clearing is not independently proved by global AX text. `Send` was never clicked. |

The creation/restore captures reveal this card transition:

| State | Captured card action |
| --- | --- |
| Preview before creation | Enabled `Send` and `Create Draft` |
| Its composer is open | One `Current Draft` button with both native `disabled` attribute and disabled class |
| Composer closed, Inbox restored | Enabled `Go To Draft` |

After reload, `ev_9b56668174589150c95429c7eba609c96c3c7cc7bea9061b0c94e1f852d3cf0a`
has five actions/six completed steps and restores the same owned card with one
enabled Go To Draft action, using its observed session ID and exact subject guard.
This establishes retained creation/navigation state, not provider-backed draft
persistence.

Subsequent `ev_af82697a6a3a7239f5c9da30330f9104113d47b699974591a0835bebdcbf2216`
contains seven declared actions/eight retained steps, all completed. Go To Draft
opens the exact same private draft URL recorded at creation, with the previously
cleared subject still empty and root's recipient-chip guard reporting zero. The
card returns to native-disabled Current Draft. There is no new Create Draft,
Send or field-edit action in that probe. Thus at least the owned draft identity
and subject/recipient edits survive reload/navigation; the preview's original
header values are not reapplied. This does not prove concurrent/repeated Create
Draft idempotence or provider persistence. The retained artifact has eight steps;
separate guard observations are not counted as extra scenario steps.

Neither `Current Draft` nor `Go To Draft` was clicked in the creation/cleanup run;
Go To Draft is activated only in the later probe above. The main DOM retains an
empty subject input even after the visibility wait passes, so this is a visibility
observation, not proof of DOM removal. The editable composer body is absent from
the main `ComposeForm.standAlone` HTML projection; unscoped AX matches can come
from the preview card. Editable-body transfer/retention therefore remains unknown.
Screenshots
were not requested in the successful action capture. The preview card itself
retains the fictional facts during cleanup.

The first body-clear method, direct editable `fill('')`, did not establish that
Squire's internal state was saved. A later `preview-body-not-reinserted` assertion
failed because the scoped composer still contained the controlled word. That
failure cannot distinguish ineffective clearing from later reinsertion.
`ev_0d50ac6d99cc6ec57bc3567130ba309e0dc22c0383218c6af932d181cc4fc15d`
then used ten completed steps with the exact owned blank subject, scoped visible
editable body, keyboard Select All/Backspace, a scoped controlled-word-hidden
assertion, a 1.2-second settle and closing visibility checks. This is stronger UI
clear evidence, without provider persistence/deletion proof. On subsequent reload,
`ev_1803772a5e0e5844f0e42b0e39fbcf1f6313fd9d40528a81c63a712f6a1f336a`
failed its Go To Draft locator; the retained final card instead has Send/Create
Draft and no subject input. This observes the affordance reset after the emptied
owned draft disappears. The explicit follow-up
`ev_34af2c2caef7d02065c5a07a9e64ad35a613fb4c1c10f6167d521ac16908d856`
then completes nineteen steps: Create Draft on that same card opens a different
owned draft URL from the initial creation, with exact controlled subject and
reserved-recipient guards. All headers and the body are then cleared using the
stronger keyboard method, followed by the controlled-word-hidden/settle/close/
Inbox checks. Thus a new explicit creation after the old empty draft disappears
is observed. This does not recover the original server's generation or storage
mechanism, prove provider deletion, or authorize automatic recreation.

A focused retained static `useAICreateDraft` excerpt, within the earlier
`ev_8d8afe9139efe1a41a6fd17b5eb95a570d621941f6d15ca38092cfe5f95a1343`
focused-analysis record and main-script identity documented in
[ai-assistant.md](ai-assistant.md), separates the existing-draft open path from
initial creation and explicit replacement. The open path loads the mapped draft,
selects that existing draft and moves its cursor; missing-draft handling opens
its existing thread. It does not explicitly assign the generated preview body.
The separate creation and replacement paths do assign generated content. A
From-account update may occur during opening, so this is not a claim that the
original path is universally read-only. These static declarations support an
existing-draft navigation interpretation; they do not establish downstream
runtime effects, Squire persistence or universal body retention. No extracted
vendor implementation is published or executed.

The owned history title later condenses while its session ID stays the same:
`ev_16ece883acc864a81d4770131cb7dc194444edb24ca72a1661243fa7cace6db1`
versus `ev_3c2d863bbe31d4001ff4d349e6b741558a467e38a78e882d0da57e0849b7ce73`.
The latter restore attempt uses the old title prefix and fails before the
requested card check. It does not show a missing/deleted preview. Recovery tests
should identify the observed owned session by ID and then guard its exact preview
subject, rather than assume titles stay unchanged. How the original generates
condensed titles is unknown and remains a separate feature.

All successful scenarios above report missing `events` and
`equality_eligible=false`. The generated claim that nothing was saved is model
text, not persistence/mutation evidence. Opening the populated composer does not
establish Gmail draft creation/synchronization, provider-backed content after reload,
provider deletion after cleanup, or delivery. No provider-private endpoint was
called by this document's investigation. Send/confirmation behavior, empty or
invalid recipients, Cc/Bcc, reply/forward cards, rich preview formatting,
repeated creation and editable-body retention remain open.

Private derived structures are `ai-assistant/sanitized-draft-preview-structure.json`
and `sanitized-create-draft-structure.json` under `evidence/private/`. The later
reload is summarized in `sanitized-created-card-reload.json`, and reopening in
`sanitized-go-to-owned-draft.json`. These preserve
action states/hashes without publishing original inbox material. Whole-DOM
reserved-address occurrence counts are not recipient counts.

## Proposed implementation scope

The next scope is a generated **new-message preview**, explicit **Create Draft**,
and **Current Draft / Go To Draft** navigation state. These are design choices
for the reconstruction, not recovered original server routes. Reply/forward,
Insert/Replace and card Send remain separate future comparisons. This work needs
no new provider credentials or scopes.

The model may propose content through a new strict `propose_email_draft` tool
(internal handler `proposeDraft`). It cannot call Create Draft, send, schedule,
provider-draft sync, Calendar writes or arbitrary actions. The tool builds a
validated AI artifact, not a mailbox draft. Existing read-only tools keep their
current account scope and shared budgets. A preview request by itself must add
zero records to the application's draft table.

Only a successfully completed `end_turn` commits an actionable preview with the
answer and source receipts. Streaming, failed, cancelled, interrupted or unknown
turns cannot enable creation. Model output, retrieved mail and any proposed
recipients remain untrusted. Cards are rendered from server-issued structures;
Markdown text cannot manufacture recipients, buttons, draft IDs or action URLs.

## Shared shapes and validation

Browser-safe types are published in `api/src/ai-draft-types.ts`; the scope IDs
are fixed by the server session. The lifecycle policy below is still being
refined against the later owned-draft disappearance probe.

```ts
type AiDraftMailbox = { email: string; name?: string };
type AiDraftPayload = {
  to: AiDraftMailbox[];
  cc: AiDraftMailbox[];
  bcc: AiDraftMailbox[];
  subject: string;
  body: string;        // Canonical plain text produced by the server.
  html?: string;      // Sanitized allowlisted HTML, when present.
};
type AiDraftPreview = {
  id: string;
  accountId: string; sessionId: string; turnId: string;
  kind: 'draft-preview';
  payload: AiDraftPayload;
  payloadHash: string;
  sourceIds: string[];
  createdAt: string;
};
type AiDraftCreation = {
  id: string;
  accountId: string; sessionId: string; turnId: string; previewId: string;
  payloadHash: string;
  generation: number; // Starts at zero; increments after canonical disappearance.
  draftId: string;     // Assigned only by the explicit server action.
  createdAt: string;
};
type AiDraftActionReceipt = {
  id: string; clientRequestId: string;
  accountId: string; sessionId: string; turnId: string; previewId: string;
  creationId: string;
  generation: number;
  createdAt: string;
};
type AiDraftResolution = {
  availability: 'available' | 'unavailable' | 'locked';
  draftId: string | null;
};
```

Turn responses/history gain an additive preview array; source receipts remain
the existing server-authoritative objects. The generation schema accepts only
To/Cc/Bcc mailboxes, subject, body/optional HTML and offered source numbers. It
does not accept From/account IDs, draft/provider IDs, reply-thread IDs, send or
schedule flags, attachments, remote URLs or arbitrary operation names. Initial
scope permits one preview per completed turn and creates a standalone draft.

Starting bounds are local policy: at most 50 total recipients, display names at
most 200 UTF-8 bytes, subject at most 2,048 bytes, body/HTML each at most 12 KiB,
and the **whole structured tool input at most 16 KiB**, matching the existing
stream parser's tool-input ceiling. The current turn's 60-second/four-round/
eight-tool/96-KiB-context/4,096-output-token budgets remain shared. Individual
allowances cannot all be consumed simultaneously. Oversized or invalid intent
is rejected rather than silently truncated into a different draft.

Validate structured mailboxes using the existing strict outgoing address/header
grammar and canonical serializer. Preserve names with quoted commas/escaped
quotes and authored address casing; do not split on commas or silently drop a
bad fragment. Empty recipient arrays can create an editable local draft as an
explicit local choice; every nonempty mailbox must validate. Blank/unresolved
original-recipient behavior has not been compared. Sending approvals continue
to govern delivery, not whether an unsent local draft may exist.

All nonempty recipient groups must be visible on the card; Cc/Bcc cannot become
hidden delivery intent. Subject and names reject header/control injection. When
HTML is supplied, sanitize it with the existing parser-backed rich-text policy
and derive plain body from that sanitized result; never trust a conflicting
model-supplied plain alternative. The card displays the canonical content that
will persist. No unrequested files, remote images or duplicate automatic
signature are added.

Source numbers resolve only against receipts actually offered to that turn's
model dispatch. The server supplies opaque source IDs/labels. Unknown, foreign
or unserved references reject the proposal; model URLs cannot become sources.

## Explicit action routes and durable state

Prefix remains `/api/ai/chat`. Every route rechecks account/session/turn/preview
ownership before reading draft data. Missing and foreign resources have the same
bounded not-found shape. Requests reject unknown fields. The proposed response
contains `{preview,creation,request,resolution,createGeneration,draft?}`; `draft` is the currently
owned local Draft only when available.

| Method/path | Behavior |
| --- | --- |
| `GET /artifacts/:previewId?accountId&sessionId&turnId` | Restore immutable preview plus optional creation mapping/current resolution. Reading never creates or opens a draft. |
| `POST /artifacts/:previewId/create-draft` | Body `{accountId,sessionId,turnId,clientRequestId,expectedPreviewHash,expectedGeneration}`. Explicit user action only; uses the server's canonical payload, not client-submitted mail fields. New generation creation returns 201; recovery of an existing generation returns 200. |
| `GET /draft-actions/by-request/:clientRequestId?accountId&sessionId&turnId&previewId` | Read-only recovery of the exact scoped action receipt and creation mapping after a lost acknowledgement. A 404 is not a reason to silently create a fresh key. |

After complete identity/hash checks, one short `BEGIN IMMEDIATE` transaction:

1. Checks the account-wide client key/fingerprint before generation/stale errors.
   Same key and immutable request recover the same historical receipt and creation;
   changing its preview/session/turn/hash/generation conflicts.
2. Finds the latest unique `(preview,generation)` mapping. Generation zero is
   initially eligible. If the latest target is canonically absent from records,
   a read response offers the next `createGeneration`; only a fresh explicit key
   with that `expectedGeneration` can create it. When eligible, inserts one
   **new** local Draft using a server-generated ID, canonical content, empty
   attachments and `status='draft'`, then records its mapping. It never accepts an
   existing draft ID or selects the application's current draft as a write target.
3. Inserts the request receipt. Concurrent different keys can map to the same
   single generation, with each receipt echoing its own key; stale-generation
   new keys conflict. They do not produce additional drafts in that generation. Draft, creation and receipt commit atomically.

The action performs no model request, provider draft sync or external write. It
does not set `scheduledAt`, provider IDs, delivery attempts or delivery status.
SQLite rollback or committed key lookup handles local crash/acknowledgement
uncertainty; `delivery_unknown` retains its existing delivery meaning.

Once a draft exists, activation returns its current mapping/content without
reapplying the generated payload over user edits. A truly deleted latest target
returns unavailable with `createGeneration=latest+1`; a new deliberate Create
Draft action can create a replacement. Reads and old action-key replays never
create anything. A replay resolves its original creation even if a newer
generation now exists, and cannot disclose or navigate to that newer draft.
Only the latest generation's canonical absence offers a new one. A target moved
to another account still exists and is unavailable, with no creation offer;
sent/scheduled/sending/unknown/in-flight targets are locked. Neither case permits
replacement. This is a local idempotence policy reproducing the bounded observed
affordance, not recovered original backend mechanics.

Planned errors are `400 ai_draft_invalid_preview`, uniform
`404 ai_draft_not_found`, `409 ai_draft_preview_changed`,
`409 ai_draft_request_conflict`, `409 ai_draft_generation_changed` and
`409 ai_draft_turn_incomplete`. Missing current
targets return an explicit unavailable resolution for the still-owned historical
preview/creation, rather than a guessed replacement. Existing loopback/origin
protections remain; this is not a new multi-user authentication claim.

## UI behavior and preservation

| Condition | Planned card state |
| --- | --- |
| Completed valid preview, no creation mapping | `Create Draft` |
| Creation request has uncertain acknowledgement | Keep the journal/key and show read-only recovery; no new-key automatic retry |
| Its owned draft is currently open | Native-disabled `Current Draft`, matching the observed state |
| Its owned draft exists and is closed | `Go To Draft`; explicit click uses guarded existing-draft navigation |
| Latest target canonically absent, `createGeneration` supplied | Offer a new explicit Create Draft using that generation and a fresh action key; no automatic creation |
| Target moved, sent or locked | Explain that state without recreating/editing it; exact original presentation is unobserved |

The Ask AI pane stays open when the new draft opens, as observed. Navigating to
it uses the existing autosave/view-generation guard so a pre-existing user draft,
recipient edit, attachment or signature is not discarded. If creation succeeds
but navigation/autosave fails, retain the created ID for recovery and keep the
existing editor intact. History restoration alone never creates or opens drafts.
Account/session/preview/request identity checks discard late responses after a
switch. While a created draft is being edited, its current content is authoritative
for reopening; the original generated preview remains immutable history.

The original preview exposes Send; it was not exercised in the Create probes
above. Later separately scoped original Send observations are outside this
Create checkpoint. This scope does not wire an enabled Send action or model-controlled
mailbox mutation. A later explicitly scoped Send feature must use the existing
approved sender/recipient checks and durable delivery protocol, with original
comparison and controlled delivery evidence of its own.

## Acceptance and open work

All implementation tests must use explicit memory/temporary paths in both
`databasePath` and `env.DATABASE_PATH`. No test may construct the live Store.

| ID | Required evidence |
| --- | --- |
| AI-DRAFT-01 | A preview response alone changes no Draft/attachment/delivery/provider records. Forged roles, foreign IDs, unsupported operation fields and invalid output never create an actionable card. |
| AI-DRAFT-02 | Canonical named recipients, Cc/Bcc visibility, subject and plain/HTML content agree between preview and the created draft; header controls/invalid neighbors/remote assets are rejected. No signature/file is appended twice. |
| AI-DRAFT-03 | Explicit creation adds exactly one new account-owned draft; pre-existing drafts remain byte-identical. No model, send, schedule, provider-sync or Calendar callback is invoked by the action. |
| AI-DRAFT-04 | Concurrent same/different client keys, lost ACK and transaction failure yield one creation or atomic rollback. Replays preserve subsequent edits and never duplicate/resurrect their deleted target; a separate explicit next-generation action can create a replacement. |
| AI-DRAFT-05 | Foreign account/session/turn/preview/action lookups fail before body access. Account switches, unmounts and late responses do not open or display another identity's draft. |
| AI-DRAFT-06 | Incomplete/cancelled/unknown generation cannot enable creation. Restored history does not auto-create or auto-open; journal recovery uses the existing key. |
| AI-DRAFT-07 | Current/open/closed/unavailable/locked target states are honest; existing-draft autosave/navigation failure preserves the editor and the new mapping is recoverable. |
| AI-DRAFT-08 | Bounded original comparison reproduces preview fields, Create Draft opening with Ask AI retained, disabled Current Draft and subsequent Go To Draft label on owned synthetic data. No Send is clicked. |

Unresolved original behavior includes editable-body retention after cleanup/reload,
provider-side draft persistence/sync/deletion, concurrent repeated or revised preview actions,
invalid/empty recipients, rich body formatting, reply/forward/Insert/Replace and
complete Send/confirmation/unknown-outcome behavior. This design does not mark
those features verified or claim full parity.

## Bounded replica live checkpoint — 2026-10-28

Root restarted only the isolated Claude/synthetic API on 3003 and used its UI on
5175. Guards required demo-only accounts, Google/delivery disabled, Calendar
disabled, exact scoped preview identity and unchanged pre-existing drafts. No
real-mail context, provider draft sync, delivery or invitation was included.

The source passed **280 API/249 web tests**, build and strict types, using mocks
and explicit memory/temporary databases. Live App SHA-256 is
`004f6a854c5ba9d9887d1ec064234752c6dda48acc94b34b2e75d829717fce40`.
The preserved 157-file source archive is
`.local/source-checkpoints/ai-draft-create-pre-send-20261028T1847Z.json`
and its `.tar.gz`, archive SHA-256
`90546ddce3a4544be4c53c0adbefdaaffdcbb3c8d33e0b265152360a36213561`.
Independent file review confirmed all 157 identities unchanged. Subsequent Send
work in an isolated private source copy is outside this checkpoint.

### One proposal, no mailbox draft

Root made one explicit Claude turn with resources `[]` and no selected thread.
It completed after two upstream dispatches with one typed preview, a reserved
synthetic To address, empty Cc/Bcc and the requested fictional facts. The preview
alone created no Draft; the entire pre-existing draft snapshot stayed unchanged.
Exact scope, preview/turn agreement and no Create/Send/Calendar POST were checked.
This is one controlled generation, not proof of general model quality.

Private report `.local/live-tests/ai-draft-live-20261028-01/report.json` SHA-256:
`59aa876577189f4c98b7d12fb0a14176ef3d6e24583c8997bc5882ecbffbe188`.

### Preserved failures and separate read-only audit

- `ai-create-ui-20261028-01` failed its first readiness GET under sandbox network
  restrictions. No browser action or new model request followed. It has no REA
  evidence ID; its immutable failure record remains preserved.
- `ai-create-ui-20261028-02`, evidence
  `ev_6881a21cda20c6657028029825fcd162e6b8a583d8cb943ff7a57018c6593828`,
  completed **46/46 browser steps** with stable sources and owned cleanup, then
  **failed its exact saved-body assertion**. Direct contenteditable fill had
  concatenated the replacement with the original body. That concatenation was
  already in scoped editable DOM immediately after fill, then in the saved PATCH
  and reopened editor. Substring waits did not catch it. Pinned REA delegates
  fill to Playwright; the exact Squire/automation cause is unproven. This is not
  relabeled as a passing content check or dismissed as a product-free issue.
- A **separate four-GET read-only audit** confirmed generation0's old receipt
  still targeted its gone draft, generation1 held the original canonical payload,
  and baseline drafts were unchanged. It made no mutation/model request and does
  not supersede the failed body assertion. Private audit report SHA-256:
  `049ab9caf4396d44394a6c38b0a7dec42247fed4f9ae8eaea2726a4521688ac7`.

### Keyboard follow-up

Root restored the same preview and existing owned generation1 without another
model call. A separate scenario explicitly selected the body with Meta+A,
deleted it with Backspace, then filled the now-empty editor. Exact single-block
waits, full scoped editable DOM text and saved PATCH equality checked replacement.
Closing/reopening retained the exact edited subject/body. Clearing only that
owned draft's recipient/subject/body and closing deleted generation1 locally;
reload restored the same preview, and a fresh explicit generation2 Create produced
a distinct draft with the original canonical payload. The old key still resolved
the gone generation1 target, and every pre-existing baseline draft was unchanged.

Evidence `ev_fa3a5cb71c2f49ee04a54cb4a037a9ae63144798b0f85ec9de14aa6692d723ac`
passed **45/45 steps** (44 actions plus scenario start). Captured traffic contained
one generation2 Create POST, one owned DELETE and one PATCH; no new model/Send
POST. Native-disabled Current Draft, Go To Draft, edit preservation and explicit
re-creation were exercised. The final synthetic generation2 draft remains saved.

The capture used REA 6.8.0/Chromium 156.0.8078.48, retained 98 unchanged manifest
entries and reported `terminated-owned-process`. Coverage remains **incomplete**,
missing `events`, `equality_eligible=false`. Exact DOM/PATCH controls establish
this keyboard sequence, not the earlier fill method's cause, complete browser
input parity, original editable-body equality or provider persistence.

Private follow-up directory:
`.local/ai-create-plan/followups/ai-create-keyboard-20261028-01/`.
Report SHA-256 `f54ee7783be5f26b48051e2254260a650f89433a8c79681b0eef35f3484bc041`;
manifest SHA-256 `4d98e31ae39af13f31e6d11584c6e57b973be7c3e42f3ec89b71452c282679d6`.
Independent review used only saved files and made zero API/model/browser calls.
The subsequent full demo run `20261028T184523Z` passed **16 cases/407 steps**,
eight persisted assertions and 93 stable manifest entries. Report SHA-256 is
`0358f92328499ca58d82f432153208b957f25014d71faceea7cb90d4c2bcb23f`;
manifest SHA-256 is `dac72cdca9ef164a833e045313d685cf8d069be2a3560bef7d7f3fc48438ed31`.
It remains separate from these live Create scenarios: fixture Calendar and
missing-configuration AI add no provider/model proof. Only reply-all lacks events
and remains equality-ineligible; all owned browsers terminated and no page errors
were retained. Full IDs are in [scenarios/README.md](scenarios/README.md).
Neither that synthetic regression, this follow-up nor the earlier failed
46-step attempt is a full-suite original-parity claim.


## Later API325/web290 Create regression — no new model turn

The subsequent Send/Undo-source checkpoint passed **325 API/290 web tests**,
build and strict types. Its full synthetic regression `20261028T193639Z` passed
**16 cases/407 steps**, eight persisted assertions, zero page errors and
98 stable source entries. Only reply-all retains missing-event/equality-false
coverage; the exact POST/201 assertion passed. This is regression evidence,
not a new original comparison or live Send/Undo proof.

Root reused the existing completed model preview on the isolated demo API/UI;
the original proposal/report/fixture retained their API280/App004f identity. The
new source binding is App SHA-256
`5650ebf07a4bf3c92535204d9bfb6a20733d5375fee73f07e617a05e14df492b`, and the
170-file archive SHA-256 is
`3ab19121d68b47ba20a7ebeb66e4800ef6c7aa41ac82d940ab6813d97ec64d3c`.

`ev_c1c96eba211875497505b9b6cf5b09d51ac7fa432528f688a8e434f0fbd058a3` completed **45/45 steps**.
The existing generation2 target was guarded before editing. Meta+A/Backspace
preceded replacement; complete editable DOM, saved PATCH and reopened text were
checked exactly. Only its owned recipient/subject/body were cleared and the
empty generation2 target deleted. One explicit Create generated a different
local generation3 ID with the original canonical recipient/subject/body. The old
key still resolved to the gone generation2 mapping; all original baseline drafts
remained byte-identical.

Captured mutations were one Create POST, one owned DELETE and one PATCH; no
new-turn/model, Send, cancellation, schedule, sync or Calendar POST occurred.
The 105-entry source manifest remained stable, there were no page errors, and
the owned browser terminated. Missing events and `equality_eligible=false` remain.
The private report SHA-256 is
`a36449eab187624ce8150f2b098dc3c615299d0bac162c640ef2fa215440a6fd`;
source-manifest SHA-256 is
`e36d32a633796afc8f1bc5339992ceaa37fbd9b0d3cc070b3ff2a07d4799216b`.
An independent offline review rechecked retained DOM/network/receipts and source
manifests with zero API/browser/provider/model calls. This later regression
preserves the failed direct-fill/content assertion and preceding audit/follow-up;
it does not establish its exact automation/Squire cause, provider draft
persistence, original backend behavior or complete parity.
