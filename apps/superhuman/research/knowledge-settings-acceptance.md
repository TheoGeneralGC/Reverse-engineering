# Knowledge and AI settings: bounded acceptance draft

Recorded 2026-10-28. This is an implementation proposal grounded in retained
original UI and static evidence. No feature here is marked verified. No browser,
provider, model, live database or product implementation was changed while
writing this draft. The Send checkpoint remains separate and frozen.

The later [controlled Knowledge Base runtime record](knowledge-base-runtime.md)
adds an explicitly approved private text upload, persistence, one retrieval
question and source navigation. The no-upload/no-prompt statements below
describe this draft's earlier observational probes, not that later experiment.

## Evidence and identity

The authenticated original is the Superhuman web client in Chromium
156.0.8078.48. Retained build `db8c4288f33febf25ad9` and main script SHA-256
`c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94` are
documented in [source inventory](source-inventory.md). The original browser lease
was returned at Inbox after these observational opens. No contact was selected,
field edited, switch changed, source uploaded, invitation sent or model prompt
submitted by these probes.

| Observed UI | REA evidence | Bounded result |
| --- | --- | --- |
| Settings menu | `ev_4dd0740bfc5922ba0a1a6e552c73a9f9721344c4fc93e208b08c578f6dd61bc9` | Knowledge Base Beta, Personalization Beta, Auto Drafts, Auto Archive and Auto Labels entry points. Autocomplete is a direct toggle and was not clicked. |
| Knowledge Base | `ev_b5b792a50f349da83268e5f5b371a64949796d3377e0f3ac7163e5989a45963a` | `/knowledge-base`, private/team empty sections, Add file/Add link, team invitation entry. |
| Personalization | `ev_b4c6b8a230460f27f7c7c5757b0e9c900d979faed176561b925f3e1555425699` | Editable category form; unchanged Save is disabled. |
| Auto Drafts | `ev_153a69c282286017f06a74f6bb23fc3788e1a00820b728eddd62ac9e0e407c68` | Follow-ups, Responses, related checkboxes, Personalization link; no Save button in this captured screen. |
| Auto Archive | `ev_838a6ea18c953114fe5288734b2dd22293e11922ab3c878a80a998f8c8c7c2fb` | Auto Labels/Always Archive/Never Archive tabs; Marketing, News, Pitch, Social rows; unchanged Save disabled. |
| Auto Labels | `ev_0b562c4e80eb19019ff65c73edd2689f2bee428b8fc44229dbb745eb04186bc3` | The same four built-in categories and New Auto Label. No classification executed. |
| Team entry | `ev_f6aeb966a644a72f5d16375612f7278b01a5ca757f1008ddd9b4da85a8cc6a23` | Create Team opens a contact picker with disabled Send Invite and a joining-seat billing notice. No team was created. |
| Cleanup | `ev_1a7c855f35bc24d696644791de673feba7efb02bb6061b774becb1a1afe09ada` | Inbox visible, no standalone composer or opened inspection overlay. |

Every UI scenario completed its declared actions, but reports missing event
coverage and `equality_eligible:false`. DOM/AX/screenshots remain private under
`evidence/private/entrypoints/`. Requested 1440×900/DPR1 is not an independently
measured effective CSS viewport. These captures establish controls and displayed
states, not their save, generation, retrieval or mailbox effects.

Pinned REA 6.8.0/skill49 inert analysis of 21 selected fragments produced
`ev_920f559b5e2ec9720bb0e140709e00a7cb531f538687145117d3ecdaf424389e`
(21 files, zero parse failures). Six additional settings/constant fragments
produced `ev_41c7bdaa0bbae734db2553d6ad1b9e69231b4eb83d30e63f46c12c23279efd84`
(six parsed files, zero parse failures). Exact original UTF-16 ranges and hashes
are retained in private `static-identity.json` and
`settings-detail-static/identity.json`. No vendor code is copied here.

## Knowledge Base

Observed selectors are `.ThreadListKnowledgeBase-Actions-attachment-button`,
`.ThreadListKnowledgeBase-Actions-url-button`, `.KnowledgeBaseEmptyState`, and
the Ask AI `.AISidebar-knowledge-base-entry-point`. Add Link's form, save rules,
and successful ingest remain unobserved; the root investigator owns that probe.

The captured file input's accept list is:
`.c, .cpp, .cs, .css, .doc, .docx, .go, .html, .java, .js, .json, .md, .pdf,
.php, .pptx, .py, .rb, .sh, .tex, .ts, .txt`.
The retained constant at JS 784:1766 is 52,428,800 bytes (50 MiB) per file.
The upload handler rejects zero bytes, unsupported extensions and sizes above
that constant, case folds extensions, and declares MIME normalization by
extension. These are client declarations; server limits, batch limits, parsing
accuracy and actual acceptance of each format are not established.

`KnowledgeBase` (783:91974) declares file/link/text entity types, pending source
IDs, private/team visibility, edit and explicit delete confirmation. The upload
flow creates a source-specific draft-like record and queues encrypted attachment
work; that does not establish original storage, encryption design or a need to
represent sources as real mail in this reconstruction. URL errors distinguish
invalid/duplicate, inaccessible/empty, private/internal address and TLS cases.
Actual crawling, redirects, authenticated pages, refresh cadence, OCR, maximum
source count, retention and model retrieval remain unknown. No default visibility
choice for the unopened Add Link form was measured.

Proposed local contract (new design, not recovered vendor API):

```ts
type KnowledgeSource = {
  id: string; accountId: string; revision: number;
  kind: 'file' | 'link'; visibility: 'private' | 'team';
  name: string; status: 'pending' | 'processing' | 'ready' | 'error';
  createdAt: string; updatedAt: string;
  file?: { name: string; bytes: number; mediaType: string };
  link?: { url: string };
  error?: { code: string; message: string };
};
```

Use a separate source table/blob store and bounded ingestion job, not the user's
mail Drafts. Proposed `/api/knowledge/sources` list/create and scoped
`/:id` read/update/delete endpoints require the selected account; updates carry
an expected revision. Explicit upload/save is the sole ingest trigger. Separate
source status and readable errors prevent an uploaded filename from implying
successful indexing. Text/code/HTML stay inert. Format-specific parsers must
report unsupported or failed extraction honestly. Server byte checks and public
URL/DNS/redirect validation accompany client validation; precise crawl budgets
would be documented local limits. Team visibility needs an actual membership
and permission implementation, never a cosmetic switch.

Acceptance candidates:

- **KB-01:** Open Knowledge Base from Settings and Ask AI; preserve the current
  mail editor before navigation and render correct account-scoped empty/loading/
  populated/error states. Reads perform no ingest or generation.
- **KB-02:** In an owned synthetic private fixture, select a supported nonempty
  text file; explicit upload yields one durable source and bounded processing.
  Cancel before upload creates nothing. Unsupported, empty and over-limit files
  fail without discarding neighboring valid selections. Original boundary
  behavior still needs comparison.
- **KB-03:** Add one owned public synthetic link; retain input on validation/
  network failure. Show ingestion state separately. Duplicate handling, title
  population and redirects need original observations before parity claims.
- **KB-04:** Refresh/restart preserves sources and status; a late account A
  response never appears in account B. Revision conflicts preserve user input.
  Deletion requires an explicit user action and does not delete mail.
- **KB-05:** With explicit local knowledge retrieval enabled, a completed source
  supplies bounded text and authoritative source receipts to Ask AI. A citation
  resolves the current scoped source, including deleted/unavailable state.
  Retrieved text cannot authorize sends, uploads, shares or settings changes.
  Resource-selection/default inclusion policy is a local choice until observed.

## Personalization and voice

The captured dialog `.Personalization-settings` contains category navigation
labelled `Personalization categories`, five text inputs (Greeting, Signoff, Job
title, Company, Company description), Writing/Scheduling/Events rich input
containers, About Me and a Knowledge Base link. Each observed text input has
`maxlength=5000`. Placeholders are examples, not defaults. The retained component
at 891:78538 also gives the three rich inputs a 5000 limit and contains a gated
Home category absent from the captured runtime. Fact-count/per-fact limits and
rich storage normalization remain unknown.

Static Save writes greeting/signoff/position/company fields and personalization
style, events, availability, facts and home preferences. Existing deleted facts
are preserved with tombstones; the personalization enabled flag is retained.
Close/Cancel declare a discard-changes prompt when dirty. These paths were not
executed. Opening may require existing AI consent; an enable/upgrade prompt must
not be silently accepted. Copy saying AI adapts to voice and tone is a product
claim, not evidence of a specific training algorithm, provider or learning time.

Proposed `/api/personalization?accountId` GET plus revision-checked PATCH returns
typed fields and availability. A separate dialog model retains unsaved edits
per account, stages ordinary fields until Save and guards delayed loads/saves.
Use named text fields and structured fact IDs/tombstones, not unvalidated HTML.
Saved preferences may be included as an explicitly identified personalization
snapshot in subsequent Claude requests; this is an implementation policy, not
proof of original prompt construction or an instruction guarantee.

- **P-01:** Open the unchanged dialog with the observed categories/labels;
  Save stays disabled. Keyboard/category navigation causes no writes.
- **P-02:** Change only synthetic fixture fields, Save once, reload and verify
  exact persistence. Apply the 5000 UTF-16 input limit while preserving editing
  state; test Unicode/control handling on the server independently.
- **P-03:** Cancel/Escape with unsaved changes retains or discards according to
  an explicit decision; no silent save. Compare original dirty-close behavior
  before marking it verified.
- **P-04:** Preserve unrelated fields, enabled state and fact deletion metadata
  during a partial edit. Late A results cannot replace B or a newer local edit.
- **P-05:** A synthetic AI test can demonstrate that selected saved context is
  supplied and can affect an answer. It cannot establish original voice quality,
  universal compliance, auto-learning or full style parity.

## Auto Drafts

The observed UI describes follow-ups when a reminder returns and requires a
follow-up, and responses when a message needs a reply; its copy says responses
can be updated as facts change. Those are displayed trigger descriptions, not
observed scheduling or successful generation. Current source declarations at
845:106821 include `followUpsEnabled`, `respondNeeded.enabled`,
`respondNeeded.emailedBeforeOnly`, legacy meeting-request flags, and a separate
assistant/teammate scheduling draft. Availability, reply classification,
emailed-before identity rules, exclusions, update cadence, threading, limits and
race handling all remain unmeasured.

Follow-up/response switch handlers call account settings immediately; the
captured screen has no Save button. The assistant scheduling subsection has its
own local state/discard handling. A universal staged-Save implementation would
therefore diverge from the known declaration. Entitlement/AI activation gates are
declared, but the current captured account's settings must not become global
defaults. An absent nested response configuration has false fallbacks in one
setter; this is not a measured new-account default.

Propose a versioned per-account `/api/automation/settings` document and separate
bounded jobs. A setting acknowledgement, classifier result, generated draft and
provider-synced draft are distinct states. Jobs snapshot settings revision,
thread/message version and personalization/source receipts. They never send.
Before updating a generated draft, recheck that the user has not edited, sent,
scheduled or discarded it. Unknown model/provider results do not create another
generation implicitly. Initial local fixture jobs remain opt-in; this default
is a reconstruction choice pending original default observations.

- **AD-01:** Render the measured controls, gates and unavailable reasons; opening
  performs no generation. A switch event is the explicit setting action; failed
  persistence retains an honest error and authoritative state.
- **AD-02:** In a synthetic mailbox with explicitly enabled fixture jobs, classify
  a new version once and create a draft only for a supported trigger. Disable,
  duplicate imports, stale messages and account changes prevent stale work.
- **AD-03:** A user editing an auto draft wins over a late regeneration; preserve
  recipients, rich body and attachments. No automatic send/schedule is exposed.
- **AD-04:** Tests demonstrate local job rules only. Actual original trigger
  equivalence, elapsed-time behavior and quality require controlled comparison.

## Auto Archive and Auto Labels

The captured Auto Archive screen is the legacy three-tab layout, with four
built-in categories and Save disabled while unchanged. It must not be replaced
by a new grouped UI merely because the bundle contains one. Static
`auto_archive_settings_dialog` at 845:315766 branches between these layouts.
`SaveAutoArchiveConfigurationAction` at 845:304922 requires a revision and handles
conflict reload; a newer digest switch has a separate immediate-save path that
was not observed in this runtime. Do not generalize every setting to one save
model. `AutoLabelsSettingsDialog` at 878:198550 declares account/tier/feature
gates and New Auto Label; its creation form/preview has not been opened here.

Propose account-scoped revisioned rules plus separate classification receipts.
A category's model classification is distinct from the authorized deterministic
archive rule. Use explicit bounded preview results before account-wide live
enablement; previews do not change Gmail labels. Provider actions retain the
existing account queue, before/after labels, durable operation identity and
read-only recovery rather than interpreting missing results as success. Rule
precedence, existing-mail backfill, sender/domain matching, exceptions, digest
schedule/timezone, undo windows and model thresholds remain unknown.

- **AA-01:** Match the captured tabs, category rows and unchanged Save state;
  opening, switching tabs and cancelling performs no mailbox mutation.
- **AA-02:** Edit fixture selections and explicitly Save one revision. Reject
  stale revisions while preserving edits; compare original conflict UX later.
- **AA-03:** On a synthetic imported mailbox, preview classification and the
  resulting archive plan separately. Unclassified/error/unknown messages remain
  unmodified, and a changed rule revision invalidates the old plan.
- **AA-04:** For an authorized controlled provider fixture, apply only the
  intended labels once, preserve unrelated labels, and expose failed/unknown
  outcomes. Account-wide enablement and broad backfill are separate work.

## Proposed implementation slices and remaining observation

| Slice | Proposed files/contracts | Separation |
| --- | --- | --- |
| Private knowledge | `api/src/knowledge-types.ts`, `knowledge-store.ts`, `knowledge-ingest.ts`; `web/src/knowledge/KnowledgeWorkspace.tsx`, `knowledge.ts`, `knowledge.css` | Source metadata/content and jobs separate from mail; citations extend the typed local source resolver. |
| Personalization | `api/src/personalization-types.ts`, `personalization.ts`; `web/src/personalization/PersonalizationDialog.tsx`, `model.ts` | Revisioned settings and unsaved form state; no model call on open/save. |
| Automation | `api/src/automation-types.ts`, `automation-settings.ts`, `automation-jobs.ts`; `web/src/automation/AutoDraftSettings.tsx`, `AutoArchiveSettings.tsx` | Config, preview/classification and provider effects remain distinct. |
| Verification | New synthetic controller/API/App tests and separately declared REA scenarios | Unit success never supplies original-runtime verification. |

Next observational probes are Add Link/Cancel (root already plans it), read-only
Personalization category/placeholder navigation, Auto Archive tab navigation,
and New Auto Label/Cancel. File upload, saved personalization and classification
comparison can use new owned private synthetic fixtures within the rebuild's
authorized reversible work. They do not inherently need a new permission flow.
Agent-driven invitations, shared knowledge/team changes, purchases and broad
account rules remain subject to the existing AGENTS/session authorization.
Earlier private handoff fields named `requiresApproval` were recommendations for
future probe planning, not additional project policy. Existing user drafts and
sources must not be repurposed as fixtures.
