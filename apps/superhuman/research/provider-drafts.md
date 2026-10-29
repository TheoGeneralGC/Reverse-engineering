# Provider draft persistence

Recorded 2026-10-28. A controlled original-app fixture demonstrates that a new,
recipient-free Superhuman draft appears in Gmail Drafts, is updated there, and
stops matching the scoped Drafts search after explicit discard. The retained
client saves through Superhuman userdata transport. The component that performs
the Gmail write, the Gmail draft resource ID, and its concurrency protocol remain
unobserved. The reconstruction now automatically persists newly replica-owned
Google drafts. Its real recipient-free lifecycle, synthetic browser recovery,
fresh-process receipt check and rollout are recorded separately in the
[provider draft checkpoint](provider-draft-live-check-20261028.md). Imported and
legacy provider-draft editing and full cross-client parity remain open.

## Evidence and identity

Static input is the retained main script from
[source inventory](source-inventory.md): build `db8c4288f33febf25ad9`, SHA-256
`c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`,
original capture `ev_24532bee2b2a260f736402d6848967e04e180e1d92895e5018fec0f1592cfcbf`.
Native version 1041.0.75 and Chromium 156.0.8078.48 identify the contemporaneous
original environment. The captured web source does not expose the private server.

Pinned REA 6.8.0 with installed skill49 analyzed ten selected inert fragment files
(62 method/declaration excerpts, 28,232 source bytes):

- Parent `ev_c810c67f45c5cf68e0613e4caad3e384f81dd6f964ca6a45a68fba9b0673f13c`.
- Summary `ev_acf9e548db36869471b48c32fc391ae7c205264ba2d30b8ae9b71d9c81aa47b9`.
- Fragment-tree digest
  `a35ac5137dc55e747f13e170a8421ef764f485e515aee2e74bf6ee7a43942e4a`.
- Ten JavaScript files parsed, zero parse failures; application coverage remains
  partial and semantic relationships contain unknowns. Dependencies outside the
  selected fragments were not implicitly recovered.

Excerpts were assembled in inert class/declaration wrappers without executing
vendor code. Exact original UTF-16 ranges, one-based line/column coordinates and
method hashes are retained in private `provider-drafts/static-fragments/identity.json`.
The complete original source, excerpts, analysis bundle, runtime captures and
provider reads remain ignored under `evidence/private/`; no vendor code is copied
into the reconstruction.

## Observed original runtime: one newly owned fixture

The parent investigator created and changed only a unique new recipient-free
fixture. No existing user draft was edited and no message was sent. Runtime UI
actions used the pinned REA workflow; separate Gmail connector searches and batch
reads established the provider-side state. Counts below distinguish declared
actions from REA's additional initial capture.

| Stage | Evidence | Result |
| --- | --- | --- |
| New draft entry | `ev_b238883cbf0b3060ca8af756149e6508b1c87943081219018c4bfe1ea46c8f28` | 4 declared actions completed; 5 captured states including initial. |
| Initial subject/body | `ev_6745a5ec219f3671f42b1b46f55aa4e673346d9e3eaba68d421da6d48d910783` | 5 actions completed and 1 failed guard; 7 captured states. Subject/body entry and Escape completed, but Escape did not hide the editor. The failure is retained. |
| Reload/update | `ev_2f1eefba81833d3682a90d556eb2438ad548135f616e6999806b05628983ae3b` | All 7 actions completed; 8 captured states. The independent exact-replacement assertion failed because fill inserted the new text while retaining prior text. This is not an exact replacement or keyboard-fidelity proof, or an established vendor bug. |
| Explicit owned discard | `ev_adfa08ab489da739a600382d2213c99ce03c40bed4dbc9df614af4e067b1f2e7` | All 6 actions completed; 7 captured states. Scoped subject/marker checks preceded discard; Inbox was restored. |

All four captures report missing event coverage and `equality_eligible:false`;
the initial save capture additionally reports its failed action. CDP cleanup
disconnected from the externally owned browser. They do not establish complete
network coverage, request ordering, provider latency or pixel equivalence.

The separately retained provider observations establish:

- The exact scoped Drafts search returned one matching message after initial
  editing. Batch read confirmed the DRAFT label, the fictional subject/body and
  absence of a To header, plus the owned `X-Superhuman-Thread-ID` and
  `X-Superhuman-Draft-ID` values.
- After the later edit there was again one matching Drafts message. Those two
  Superhuman header identities and the Gmail thread ID stayed stable, while the
  provider message ID changed. The altered body was persisted, but the failed
  replacement assertion limits any exact-content claim for that edit.
- After explicit discard, the same scoped Drafts search returned zero matches.
  This supports removal from the queried Drafts view; it does not identify a
  Gmail delete endpoint, establish permanent erasure, or reveal a Gmail draft ID.

Private receipts are `gmail-exact-draft-search-01.json`,
`gmail-batch-draft-read-01.json`, the corresponding `-02` update pair, and
`gmail-exact-draft-search-03-after-discard.json`. The sanitized linked summary is
`original-runtime-review.json`, SHA-256
`f07ff8535108e1b7002924b66f6da9721852a328f869f148862b84c3ded40f81`.
Single-message connector binding failures are retained separately; batch reads
succeeded. These connector observations have their own producer provenance and
are not assigned invented REA evidence IDs.

## Static save, load and discard boundaries

All locations below refer to the original main script, not the synthetic wrapper
line numbers. These declarations were read statically; their execution is not
established by parsing alone.

| Boundary | Location | Declared behavior |
| --- | --- | --- |
| Editable-state guard | `ComposeFormController.changesAllowed`,765:36888 | Requires a watching draft operation and metadata identifying an editable draft. |
| Editor update/autosave | `_updateDraft` and `_saveDraftAsync`,765:52551 for the latter | Field updates mark the draft and call operation-scoped throttling with 1000ms before the central save function. This is not a measured provider-latency guarantee. |
| Central save | `ComposeFormController.saveDraft`,765:52873 | Checks dirty state, records session identity, clears the local dirty flag, and enqueues presenter save; errors display a save-failure notification. Local dirty=false alone is not provider durability. |
| Presenter queue | `ThreadPresenter.saveDraft`,743:11496 | Notifies local draft state, chooses label-persistence behavior from the account gate, and enqueues a per-thread modifier. |
| Save modifier | `DraftModifiers.saveDraft`,420:14501 | Serializes the draft; attachment saves use a distinct branch. The ordinary branch appends refresh, a 5000ms sleep (zero for demo-thread prefixes), and a per-draft replacement ID. The sleep is after save/refresh in the chain and must not be described as the autosave debounce or measured cloud delay. |
| Draft write | `ModifierBuilder.saveDraft`,420:33543 | Updates local thread/message draft data, preserves prior sharing metadata, then writes a draft value beneath `threads/<thread>/messages/<draft>/draft`. |
| Backend transport | `SuperhumanBackend.writeUserDataMessage`,445:9614 | Prefixes writes with `users/<providerId>/` from the account credential and POSTs `/~backend/v3/userdata.writeMessage` with writes and the current thread history ID. |
| Load | `ThreadPresenter.loadMetadata`,743:12710 | Loads disk thread data plus unfinished modifiers, then obtains provider or Superhuman data as needed. Userdata read/sync/getThreads methods are separately declared. |
| Synthetic-draft provider load | `_downloadFromProvider`,749:2113 | Rejects directly downloading a Superhuman synthetic draft from the provider. This does not reveal what the private server may import or convert. |
| Active-draft cache | `ThreadStore._saveDraftToBaobab`,750:15202 | Uses session/date/action comparisons when updating the local active-draft tree and compose state; complete conflict correctness is not proved. |
| Incoming editor state | `ComposeFormController.draftChanged`,765:36249 | Compares draft identity/action, attachments/sharing, last session and incoming dates before deciding a change. |
| Close/unmount | `cleanUpCurrentDraft`,765:33698 | Saves modified ordinary drafts, handles special Knowledge/snippet paths, or discards an unmodified draft unless keep-empty/special conditions apply. |
| Discard/undo | `ModifierBuilder.discardDraft`,420:36682; `undoDiscard`,420:37197 | Persists `discardedAt` as a timestamp; Undo writes null. The client path is a userdata tombstone rather than an observed provider DELETE. |

The userdata request's provider/account prefix and history field are concrete
client declarations. Authentication enforcement, conflict rejection semantics,
provider mapping, idempotency, retry windows and server-side Gmail work remain
private. Server-mediated provider sync is consistent with the combined evidence,
but the runtime capture did not attribute the actual Gmail writer.

The Gmail history-update helpers omit provider messages labelled DRAFT/CHAT when
adding messages or changing labels in their normal mail-thread path. That
filtering is not proof that the product cannot expose an imported provider draft
through another path. A separate newly owned external-draft fixture could not be
created: two Gmail connector attempts were rejected by local payload validation,
and the final exact-subject search found no draft. No original UI action or
acknowledged provider creation followed. Failures remain private as
`external-draft-create*.json`. Imported-draft editing is therefore unobserved;
existing user drafts remain untouched.

## Declared draft fields and gates

`DraftModel.json` at 368:31622 declares these field groups. They describe this
client representation, not a required replica schema or the private server's
complete model:

| Group | Field names |
| --- | --- |
| Identity/reply | `id`, `threadId`, `action`, `name`, `schemaVersion`, `rfc822Id`, `inReplyTo`, `inReplyToRfc822Id`, `references` |
| Authored content | `from`, `to`, `cc`, `bcc`, `subject`, `body`, `snippet`, `quotedContent`, `quotedContentInlined` |
| Change/session metadata | `clientCreatedAt`, `date`, `fingerprint`, `lastSessionId`, `totalComposeSeconds`, `timeZone` |
| Labels/attachments | `labelIds`, `attachments` |
| Scheduling/reminders | `reminder`, `scheduledFor`, `scheduledReplyInterruptedAt`, `scheduledSmartSendRecipient`, `schedulingDetails`, `abortOnReply` |
| Sharing/sensitivity | `sharing`, `sensitivityLabelId`, `sensitivityTenantId` |
| AI origin | `autoDraftKind`, `agentSessionId` |

The body is the rich editor's HTML string. Backend conversion formats recipient
contacts and removes attachments from the draft write; attachment metadata has
separate write paths. MIME bytes, attachment transfer guarantees, provider draft
IDs and server mapping tables are not recovered by these fields. In particular,
a Gmail message ID changing after an update cannot be treated as proof that the
underlying Gmail draft resource ID changed.

The retained empty-body declaration checks text and structural content, including
images, lists, links, tables and block quotes. Reply fingerprints, auto-Bcc and
special draft kinds also affect cleanup. A literal-empty conservative replica
discard policy is a local data-preservation choice, not proof that every such
original predicate is reproduced.

The label-specific gate at 411:10834 requires `draftSyncing/enabled` plus the Gmail
draft-label feature flag for a Google account. This gate concerns draft labels;
it must not be generalized into an observed body-autosave on/off setting. The
selected ordinary save chain has no explicit browser-versus-native branch.
Foreground-user conversion, demo/tutorial, public-account and editable/shared
draft guards occur in the selected code. Their current enabled values, native
background implementation and complete feature-gate coverage remain unknown.
Outlook is outside the requested reconstruction scope.

## Gmail API contract checked for reconstruction

Google documents a stable draft resource ID while replacement changes its message
ID. A raw-format draft read returns MIME, and a draft Send request may include
both the draft ID and replacement raw MIME. This supports an immutable accepted
Send snapshot without a separate preparatory update.
[Draft guide](https://developers.google.com/workspace/gmail/api/guides/drafts),
[draft resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts),
[Send method](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/send).

The published update request/resource does not expose an ETag or conditional
version field. A local serialized queue and remote comparison cannot establish
atomic concurrency control against another Gmail client; that remaining race
must stay explicit. This is an implementation inference from the documented
contract, separate from observed Superhuman behavior.
[Update method](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/update).

## Reconstruction acceptance candidates

The current replica documents only explicit `POST /api/drafts/:id/sync`; it
does not import existing provider drafts for editing and refuses local deletion
of a mapped provider draft. The following are implementation candidates to close
that gap. None is marked verified by this document.

- **PD-01 — Automatic owned-draft save:** For a newly replica-owned synthetic
  draft, acknowledged local edits eventually persist exact rich content and
  recipient-free headers in Gmail without requiring a separate Sync click.
  Opening a draft performs no provider write. Existing/legacy user drafts remain
  untouched by migration or startup.
- **PD-02 — Stable mapping:** Store local draft ID, provider account, provider
  draft resource ID, provider message/thread IDs, local revision and synchronized
  content hash separately. Verify provider identity from the actual API rather
  than inventing a Gmail draft ID from a message or Superhuman ID.
- **PD-03 — Latest snapshot:** Debounce/coalesce only unsent work after local
  persistence. An older acknowledgment may record its own mapping but cannot
  replace newer editor fields or mark a later local revision synchronized.
- **PD-04 — Ambiguous create:** Persist an operation/key/content binding before
  provider creation. Lost acknowledgment or process interruption enters explicit
  reconciliation; do not blindly repeat creation or interpret an inconclusive
  read404 as proof that nothing was created.
- **PD-05 — Ownership and concurrency:** Account/draft/revision/hash guards fence
  delayed results. Foreign or externally changed provider content is reread and
  presented as a conflict while local edits remain intact. Define supported
  provider concurrency behavior from official API contracts before rollout.
- **PD-06 — Discard while syncing:** Explicit discard of a canonically mapped,
  newly owned target survives restart and an in-flight create/update. A local
  tombstone cannot authorize deleting a different or legacy user draft. Unknown
  provider outcomes must be resolved before any replacement or cleanup write.
- **PD-07 — Rich content and attachments:** Preserve HTML, plain fallback,
  quoting, reply identity and attachment bytes across save/read/reopen; meaningful
  rich-only content must not be silently discarded. Test provider normalization
  separately from exact raw-byte equality.
- **PD-08 — Delivery integration:** Coordinate cloud draft work with the shared
  account queue, immutable Send/Schedule snapshots, Undo restoration and their
  terminal/unknown locks. A late autosave cannot rewrite a queued or claimed
  delivery, recreate a sent draft, or erase restored/newer authored content.
- **PD-09 — Clear status:** Distinguish local save, pending provider sync,
  synchronized revision, provider error and unresolved write. Provider throttling
  or reconnect states must not appear as cloud-saved success.
- **PD-10 — Imported owned fixture:** Separately observe whether the original
  exposes a newly external-created Gmail draft and allows controlled editing.
  Use that evidence to design explicit import/edit behavior; neither the normal
  provider DRAFT filter nor the original-owned fixture answers this question.

Full cross-device behavior, simultaneous client editing, original provider
latency/retry rules, remote deletion/tombstone handling, every draft type and
complete autosave parity remain unknown. The investigation performed here was
static only; runtime/provider actions above were the parent's separately scoped
controlled fixture.
