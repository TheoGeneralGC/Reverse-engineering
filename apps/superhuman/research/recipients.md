# Recipient fields: discovery and candidate scenarios

Recorded 2026-10-27/28. Static discovery is followed by bounded original runtime
probes below. Replica reconstruction is in progress; no message was sent. Static
branches remain distinct from executed observations. Nothing here marks the
whole recipient feature verified.

## Evidence and identity

| Evidence | Identity and scope |
| --- | --- |
| `ev_24532bee2b2a260f736402d6848967e04e180e1d92895e5018fec0f1592cfcbf` | Retained REA `inspect_web_page` of authenticated `https://mail.superhuman.com/`; private `browser-baseline.bundle.json`. Source URL `https://mail.superhuman.com/~backend/build/db8c4288f33febf25ad9.page.js`, SHA-256 `c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`. Browser identity Chrome `156.0.8078.48`; this is the web client, not a native macOS binary. |
| `ev_7a12389ab1dbd5b35767fc954f4d59b1ad794e5c1d32305e9bd0463c1d77a2f0` | Earlier original empty-composer runtime probe; private `composer/original-probe.json`, `original-empty.dom.txt`, `original-empty.png`. It establishes the empty To input and recipient expansion control only, not entered-chip behavior. |
| `ev_5c117eb24625e19c86f9c1134d16b7989d17b63210c00dfc3a0e569311b6a3ca` | New pinned REA 6.8.0 inert analysis of a private, byte-identical copy of the captured main script. The 1,024 MiB worker heap was exhausted during static analysis. Partial result only; do not treat its absence of findings as evidence of absence. |
| `ev_b19585ba2996dd323677fe0c5cf27f95310ab6dbeb719db4b5bc39f2a32116bb` | Bounded follow-up REA analysis of private `RecipientList` and `ContactStore` class excerpts. Summary projection `ev_bcf83fde4b31d992a05b99c9fc18f8d60e1bb577794014f9894c2ef5148d9bb6`; private `recipients/focused-analysis.bundle.json`. Target code was parsed, never executed. |

The follow-up used `npm run rea -- analyze-javascript-application`, the installed
`reverse-engineer-anything` skill version 49, and the existing supported Node
24.22.1 runtime. The analysis container contains two class expressions wrapped
in parentheses for parsing; it is not an original standalone application module.
`recipients/selection-identity.json` maps their source ranges and hashes. No
captured program text is copied into product code or this report.

| Selected fragment | Original source location | Fragment SHA-256 |
| --- | --- | --- |
| `RecipientList` | Line 758, UTF-16 column 93733; original code-point offsets `[8101682,8120644)` | `2e64d086a3aa05554c848e25d28993c4b1fa8e8ccc58e9cc37b1cfec8802f699` |
| `ContactStore` | Line 736, UTF-16 column 25677; offsets `[7879225,7887831)` | `3f2c46b27a6f209d1a8ecaecc0f14afd6bb323cad8b6f723a5a65d65cf1a4dd8` |

Line numbers below are one based; columns are zero-based UTF-16 code units in
that exact original script. The original capture is attach-limited and
policy-filtered. Prior traffic, most worker activity, raw network bodies and
storage values were not retained. The bounded analyzer still reports a partial
application graph, unknown semantic coverage, and 1,915 semantic unknowns,
including unresolved external references. Manual source reading establishes
branch declarations, not that a branch executes in the current account.

## Static findings

| Area | Declared behavior and limits | Original source location |
| --- | --- | --- |
| Chip representation | `RecipientList` renders separate recipient elements and an autosizing text input. Chips have selected/invalid states, a remove tail, and a double-click edit handler. Invalid input is representable; chip creation alone does not prove validity. | `renderInput` 758:109549; `renderRecipient` 758:110080 |
| Enter | Plain Enter finishes the current edit and prevents propagation. Cmd/Ctrl+Enter bypasses this local commit handler and can reach outer send handling: exclude it from recipient-only probes. | `_onInputKeyDown` 758:101205 |
| Comma / semicolon | Unshifted, non-Meta comma or semicolon commits only when the current text contains `@`. A name-only query follows a different path. This is a key-event branch; filling a value containing punctuation does not prove delimiter behavior. | `_onInputKeyDown` 758:101205 |
| Tab | With nonempty suggestions, Tab is prevented and finishes the edit. Without suggestions, this handler does not prevent Tab. Exact next focus depends on the outer focus manager and must be observed. The local condition does not exempt Shift+Tab. | `_onInputKeyDown` 758:101205 |
| Commit choice | Finishing an edit first takes the highlighted suggestion, if present, otherwise parses the typed text. Empty editing text removes the edited existing chip. Appending can advance to an empty input; editing an existing chip uses replacement semantics. | `finishEdit` 758:102710 |
| Escape | First hides a nonempty suggestion list. With no suggestions, nonempty edited text is committed; when empty or not editing it dispatches the outer compose Escape action. The eventual focus/card-close result remains a runtime question. | `RecipientList.componentDidMount`, within 758:93733 |
| Backspace / Delete | Empty-input Backspace directly invokes removal of the preceding recipient (or current selected rank), rather than declaring a two-step select-then-delete interaction. In nonediting chip selection, Backspace/Delete removes selected ranks. Normal text Backspace is left to the input. | `_onBackspace`, within 758:93733; `_onInputKeyDown` 758:101205 |
| Left / right | While editing, arrows remain text navigation unless the caret is collapsed at the relevant boundary. At a boundary, arrows select neighboring chips/input positions. Shift+arrow expands/reduces chip selection; Shift+click and Cmd/Ctrl+click select ranges or toggle chips. | `arrowWasForInput`, `_onArrow`, `_onShiftArrow`, within 758:93733 |
| Edit / clipboard | Selected-chip Enter or double-click enters editing. Cmd+A selects all chips only when input text is empty. Chip copy formats selected recipients, joined by comma-space. Cut copies then removes selected recipients. Recipient undo/redo has a separate controller path. | `RecipientList.componentDidMount`, `_copySelection` within 758:93733 |
| Paste | The special paste handler applies when the recipient region has focus and there is no nonempty editing text. It replaces selected chips, removes `mailto:` prefixes, applies NFKC normalization, splits addresses and retains trailing invalid text as editable input. Pasting into a nonempty edit is left to normal input behavior. | `_onPaste` 758:106948; `addRawText` 758:104995 |
| Paste splitting | Bare-address input splits on comma, semicolon, or whitespace. When angle brackets occur, a different splitter preserves quoted-name delimiter groups. This is not a claim of complete RFC mailbox grammar. | `splitPastedEmails` 445:69217; contact parser 368:7719 |
| Duplicates | Addition deduplicates its incoming contacts and removes matching existing entries within that recipient list by exact email/raw equality. Autocomplete's result deduplication separately lowercases addresses. Case behavior across fields and move/reply composition requires runtime comparison. | `add`, within 758:93733; `ContactStore.recipientListAutoCompleteAsync` 736:30641 |
| Cc / Bcc expansion | Header expansion creates To/Cc/Bcc lists with tab indices 1/2/3; available From is 4, body 6. Expanded headers with existing Cc/Bcc show those fields by default. Change To/Cc/Bcc commands expand the header and request field focus. Tab indices are declarations, not proof of the entire traversal sequence. | `_renderRecipientList` 760:30109; header render near original offset 8185270; default state 368:34617; `expandHeader` 778:7326 |
| Focus shortcuts | Cmd+Shift+O / C / B target To / Cc / Bcc, respectively. Command aliases include Add CC and Add BCC. | 765:28205 / 28447 / 28728 |
| Move recipients | Alt+Up/Down finishes an edit, then requests movement of selected contacts to an adjacent To/Cc/Bcc list. The controller adds to the destination, removes from the source, focuses the destination and expands the header; end-of-list moves are guarded. Drag/drop paths are also present. | `RecipientList.componentDidMount`; controller original offset 8323442 (763:58663) |
| Suggestion navigation | Up/down wrap through a contact selector; the default selected index is zero. Existing list addresses mark suggestions disabled. The exact disabled-item navigation/acceptance outcome requires a probe. Mouse selection and hover highlight are present. | `ContactSelectorList` 605:276827; `_isDisabled` 605:278011 |
| Suggestion removal | An autocomplete row's remove action writes persistent `excludedContacts/<email>` state and offers Undo. This differs from removing a draft recipient chip. Do not exercise suggestion exclusion as an incidental recipient probe. | `_onContactRemove`, within 758:93733 |

The empty-composer runtime DOM contains `.RecipientList-input-to input` with
`spellcheck=false` inside a `FocusRegion RecipientList` having tab index 1.
The input itself has no observed accessible label. It is nested in an autosizing
wrapper, so targeting `.RecipientList-input-to` alone selects a wrapper, not the
input. The retained DOM also contains the “Expand recipients” icon. Cc/Bcc input
selectors below are derived from the source class naming, not yet observed here.

## Autocomplete data: what is and is not established

The recipient control requests at most five suggestions with a trimmed query and
current thread metadata. Its contact store combines scored global contacts and
thread participants, lowercases result deduplication, and can optionally include
team contacts/domain results in other callers. The recipient control shown here
uses the normal defaults, rather than explicitly enabling all those options.
These are static call relationships, not network observations.

The store declares an in-memory address book, ordered-contact tries in workers,
excluded-contact state, background contact loading, and thread-contact scoring.
Its background loader records disk and Google-refresh timing metadata; user
contact loading switches between Google and Microsoft adapters. These names
support candidate data paths. They do not establish which service populated a
particular suggestion, that Google People is called per keystroke, that directory
results are complete, or that a new OAuth scope is necessary for a local replica.

A first reconstruction can suggest account-scoped participants from already
imported messages and saved local contacts. That is an implementation choice,
not a claim about Superhuman's source or ranking. Keep account isolation, duplicate
handling, stale-query rejection and accessible selection explicit. Broader
address-book/directory parity and ranking remain open until measured.

## Official documentation corroboration

The vendor's [recipient editing release note](https://new.superhuman.com/edit-cut-copy-paste-recipients-28146)
describes editing a selected recipient with Enter or double-click and selecting
multiple recipients with keyboard or pointer modifiers. The official
[Mac shortcut sheet](https://download.superhuman.com/Superhuman%20Keyboard%20Shortcuts.pdf)
lists To/Cc/Bcc focus shortcuts and moving contacts to Bcc. These public documents
corroborate intent; they do not verify the exact captured build's focus and
validation edge cases.

The vendor's [Copy Recipients release note](https://new.superhuman.com/copy-recipients-28910)
describes a command on an existing message. It is distinct from editing draft
chips. The [Autocomplete help page](https://help.superhuman.com/hc/en-us/articles/46005685782669-Autocomplete)
concerns next-word predictions inside the body and must not be used as evidence
for recipient suggestion data sources.

## Candidate acceptance scenarios — runtime comparison pending

Use reserved addresses such as `rea-one@example.test` and
`"REA, Two" <rea-two@example.test>` in a newly created, owned probe draft. These
scenarios never send. Preconditions include recording exact draft identity,
source build, viewport/DPR and initial recipient count. Record chip count/text,
input value, suggestion state and the focused field after each action.

| ID | Controlled action | Candidate assertion / uncertainty to resolve |
| --- | --- | --- |
| REC-01 | In empty To, type a reserved full address; press Enter. | One valid chip, no literal delimiter retained; determine focus after commit. |
| REC-02 | Repeat independently with comma and semicolon physical key presses; compare a name-only query containing no `@`. | Confirm delimiter commit guard and what name-only punctuation does. Do not substitute `fill('a,b')` for actual key events. |
| REC-03 | Type a reserved full address, wait until suggestions settle, then Tab; repeat with no suggestions and with Shift+Tab. | Distinguish highlighted-suggestion acceptance from ordinary field traversal and record whether focus stays or advances. |
| REC-04 | With a suggestion list, Escape once; then Escape with nonempty input and once when empty. | Determine hide/commit/outer-Escape stages and whether focus changes before composer closure. |
| REC-05 | Enter two reserved chips, focus the empty trailing input, press Backspace once; then test text Backspace and selected-chip Delete. | Confirm immediate previous-chip removal and independence of text editing. |
| REC-06 | Click a chip, press Enter, alter its address and commit; repeat via double-click. | Preserve display-name/address distinction; replace rather than append the edited chip. |
| REC-07 | Navigate from a partially typed input with caret in the middle, then at each boundary; use Shift+arrow and Cmd+click on chips. | Text navigation vs chip navigation, selection expansion and removal/copy of selected ranks. |
| REC-08 | In an empty recipient input paste bare comma/semicolon/space/newline-separated addresses, then quoted-name angle-bracket addresses; separately paste over selected chips and into a nonempty edit. | Confirm grammar branches, trailing-invalid preservation, ordering, and paste replacement behavior. |
| REC-09 | Add the same address twice, then a case variant; repeat across To and Cc. | Measure exact deduplication and cross-field behavior without assuming Gmail canonicalization. |
| REC-10 | Expand recipients by the visible control; invoke Cmd+Shift+C/B/O from the body, then Tab through fields. | Observe actual field reveal/focus and To→Cc→Bcc→From/Subject/Body traversal; verify no content loss. |
| REC-11 | Select an owned chip and use Alt+Down/Up between visible fields; test a boundary field. | Confirm destination order, source removal, focus and safe no-op at boundaries. Drag/drop is a separate candidate. |
| REC-12 | Use a query with existing suggestions; navigate down/up past an end and accept with Enter/Tab; issue two queries rapidly. | Confirm default selection, wrapping, duplicate-disabled behavior, ranking stability and stale-query handling. Capture no suggestion names in public records. |
| REC-13 | Enter invalid text, blur, reopen/edit it, and remove it. | Observe invalid styling and preservation; do not click Send to test validation. Server delivery validation is a separate controlled test. |
| REC-14 | Save/close and reopen only the owned probe draft with To/Cc/Bcc and display names; then remove all owned values and clean up that draft. | Confirm persistence and separation of display names from addresses; do not touch existing user drafts. |

## Safe runtime probe plan and selectors

Root retains the original-browser lease. A future probe should declare a short
REA action sequence, use a unique synthetic marker, operate one exact newly owned
draft URL, and include cleanup. Never press Cmd/Ctrl+Enter, select Send, click an
autocomplete suggestion's removal X, exclude contacts, or mutate account settings.
Avoid clipboard operations that would copy real suggestions or replace the user's
clipboard; use explicit synthetic clipboard injection only if the tool supports
it without changing system clipboard state. Otherwise mark paste unobserved.

Candidate selectors, each scoped to the owned composer and checked for uniqueness:

- **Observed empty To:** `.RecipientList-input-to input`.
- **Derived Cc/Bcc:** `.RecipientList-input-cc input`, `.RecipientList-input-bcc input`.
- **Derived field region:** `.RecipientList` filtered by its `.RecipientList-label` text.
- **Derived chip states:** `.Recipient`, `.Recipient.isSelected`, `.Recipient.isInvalid`, scoped to that region. Prefer exact synthetic text over ordinal selectors.
- **Derived chip removal:** the owned synthetic chip's `.tail`; never use a page-wide X selector.
- **Derived suggestions:** `.ContactSelectorList` and its selected item, with locator names established from the current AX/DOM snapshot before clicking. Do not assume combobox/listbox roles from the static component name.
- **Observed expansion icon:** the glyph named `Expand recipients`; resolve its clickable ancestor from a fresh DOM/AX snapshot rather than assuming it is a button.
- **Observed subject/body:** `input.ComposeForm-subject`; body host `[data-editor-location="compose"]` with a shadow-root contenteditable. Recipient fields are ordinary DOM, not inside that editor shadow root.

Run keyboard transitions without intermediate screenshot caret hiding when testing
undo/redo; see [screenshot interference](screenshot-undo-interference.md). End-of-
scenario screenshots, AX/DOM snapshots and value-free metadata are sufficient for
most recipient checks. Private captures can contain contact data even when no
suggestion is chosen. Public results should retain only synthetic values, evidence
IDs, source identity, action outcomes and explicit unknowns.


## Original runtime checkpoint — 2026-10-28 UTC

The existing signed-in target and exact build above were used with pinned REA
6.8.0, Chrome 156.0.8078.48, en-US and America/Los_Angeles. The requested
viewport was 1440×900 with DPR 1; successful end screenshots are 2880×1800
pixels. Actual attached CSS viewport/DPR were not independently measured, so
these observations do not establish geometry or pixel equality. No new account/scope or contact exclusion was used. Every recipient was
synthetic at `example.test`; existing drafts were untouched and no send action
was present. Requested screenshots were deferred to the end.

| Evidence | Scope and outcome |
| --- | --- |
| `ev_96d60265f0c4412045d22ed9223d4c6905906164bee5935e92596218084ead88` | Core 32-action plan: first 21 actions completed, then the next input locator timed out in 10 seconds; remaining actions were cancelled. Enter, comma and semicolon each committed a reserved address. Empty trailing-input Backspace removed the last chip immediately. Click + Enter edited an existing chip; committing its replacement kept that chip selected and removed the editing input. The next fill incorrectly assumed a trailing input still existed. This is a bounded probe failure, not an app failure or a complete pass. |
| `ev_7e7535d857d97cfd6ad335894d09287f0bcfaa9314205eaffa0a182ad336fbfb` | Nine-action recovery navigated to the exact newly owned draft, selected/removed only its synthetic recipients, cleared its subject/body and asserted Inbox restoration. All actions completed. |
| `ev_e4c2017d6ca3d12d44188d41b50121db2a8b829780e457362db93c124e2250bb` | All 37 actions, including cleanup, completed. Name-only comma, nonempty Escape, To/Cc/Bcc shortcuts, no-matching-contact Tab and double-click editing were observed as detailed below. |

All three records have missing event coverage and `equality_eligible=false`.
The first additionally has missing artifacts/action sections after its failure.
Private full captures are `recipients/original-core.json`,
`original-core-cleanup.json` and `original-focus.json`. They establish the recorded
DOM/AX transitions, not complete network coverage or full original/replica equality.

- Comma in an unmatched name-only input remained literal text and made no chip.
  Escape committed that text, including the comma, as an invalid chip; the
  composer stayed open, its To input became empty, and the observed focus-region
  class moved from RecipientList to ThreadPane. The exact active DOM element was
  not independently recorded.
- Cmd+Shift+C, B and O expanded all recipient fields and selected Cc, Bcc and To,
  respectively. Their existing contents remained visible.
- A reserved full address followed by Tab committed a To chip and moved the
  focus-region class to Cc in the expanded header. This had no matching stored
  contact; acceptance/navigation with a real suggestion remains unmeasured.
- Double-click entered an existing To chip's edit. Enter replaced it, left that
  chip selected, and showed no To input. Other fields retained empty inputs.
- Cmd+A and Backspace scoped to each owned recipient region removed its chips.
  Subject/body clearing and composer closure restored Inbox.

The follow-ups below address duplicate entry, moves, shared history, suggestion
wrapping and Escape. Paste, complete selection behavior, original blur/reopen
persistence, ranking and external contact coverage remain open.
The pinned scenario API has no clipboard action; filling a string is not evidence
of the original paste-event handler. Replica tests may cover a local parser while
that runtime comparison remains pending.


### Duplicate, move and history follow-up

`ev_a8642d90a945dfe1f7c82ae67c7f244be275e5cf1ea86a9846980afb9004671c`
completed 14 actions before a nonunique case-insensitive chip selector failed;
its remaining actions were cancelled. Repeating the exact lowercase address
left one To chip. Adding an uppercase-localpart variant created a second To chip,
although both displayed the same lowercase text. Adding the lowercase address
to Cc left both To chips and one Cc chip. Raw/persisted address casing remains
unverified; display normalization does not prove stored canonicalization.

`ev_8713a9bed616fba45c5e8ffbd8c9dcb98f72104f427a115a7c263c2bbc4d4ef6`
continued that exact owned draft with a field-scoped first-chip selector. All
19 actions completed, including cleanup. Alt+Down moved the selected first To
chip to Cc and focused Cc: To went from two to one, while destination deduplication
kept one Cc chip. Deleting scoped Cc, Cmd+Z and Cmd+Shift+Z produced zero, one,
then zero Cc chips without changing the remaining To chip. All three fields,
subject and body were cleared and Inbox restored. No screenshots intervened in
the history check. The first record has failed-action/artifact coverage; the
continuation has missing events only. Both are equality-ineligible and retained
privately as `original-duplicates.json` and `original-move-cleanup.json`.

Two permission-review attempts timed out before launching their respective shell
captures; one allowed retry per timeout then ran successfully. The timeouts
produced no REA evidence and are not runtime behavior findings.


### Suggestions and repeated Escape result

`ev_98686d78acac23c3ddc08db99b70d5890d7e34f6f1e5599cbc1cc0253730e159`
completed all 24 actions and cleanup. A name query produced five actual
`.ContactSelectorItem` rows. Selected index started at zero; six Down presses
produced 1, 2, 3, 4, 0, 1, then Up returned zero. Contact identities remain private.
An exact approved counterpart query produced one selected row; Tab committed it
and kept focus in To. This differs from the unmatched-address Tab that moved to
Cc in the earlier expanded-header probe. Ranking, excluded/disabled contacts and
asynchronous query replacement remain unmeasured.

The name-query Escape result contradicted a standalone static-branch expectation:
one Escape both hid the suggestions and committed the literal typed name as an
invalid chip, leaving the composer open and moving the observed focus-region
class to ThreadPane. A focused 17-action repeat confirmed the result with five
real suggestion rows: `ev_9f60ad8fefdb05b6dc72b1bf4112b82656d83a69a4d7b976d9d25a629e970305`.
The same repeat used one exact-address suggestion; Escape committed the typed
address and moved focus out of the recipient region. It did not accept the
highlighted suggestion for the unmatched name. An outer blur/focus handler may
explain the static/runtime difference, but that causality is an inference.
Replica reconstruction follows the observed end state, not the isolated branch.

Both suggestion captures have complete requested actions/artifacts but missing
event coverage and `equality_eligible=false`. Captures are private
`original-suggestions.json` and `original-escape-repeat.json`; each cleared only
its owned recipients/subject/body and asserted Inbox restoration. No suggestion
exclusion, real-mail body, send or account-wide mutation was performed.


### Named and invalid chip appearance

All 11 actions completed in
`ev_40b6cceba647fcc8c8b70b060ae7b9d9705dbbc3d4f15a3c66766a6817f95211`.
The authored quoted name `"REA, Two"` rendered as `Two REA`; unquoted `REA Three`
retained its order. The incomplete address `rea-invalid@` became an invalid chip.
The screenshot shows plain inline valid names with bullet separators, plus a red
invalid chip. Raw persisted name ordering was not measured. Replica presentation matches that observed display. Canonical draft-header
formatting and escaping of malformed fragments are local persistence choices,
not a claim about the original stored representation.
The exact newly owned draft was subsequently cleared (recipients, subject, body)
and Inbox restoration asserted by the separate nine-action cleanup capture
`ev_011217b2e478fd81ac4b3dd7e33eb6895c2269e092e4de9c7cc0a0f07caab6c4`.
The captures remain private as `original-names.json`, `original-names.png` and
`original-names-cleanup.json`; both returned captures are equality-ineligible
because event coverage is incomplete. No message was sent.


### Interleaved history comparison

`ev_0bac95bcb0327400a0cbfb9941ae22933e1f7ba815b53772db343aaf163c500e`
completed all 29 actions, including owned-draft cleanup and Inbox restoration.
After deleting Cc and then To, focus returned to Cc: its first Cmd+Z restored To
alone, and its second Cmd+Z restored Cc. Focus then moved to To; Cmd+Shift+Z removed
Cc while preserving To. This establishes shared recipient history across fields
for that controlled sequence. It does not measure interleaving recipient history
with body/subject edits. No screenshots intervened; event coverage remains
incomplete and equality-ineligible. Private capture: `original-history.json`.

The named-chip screenshot also shows the right context pane displaying the last
recipient's label/address. Matching the full contact/context pane, enrichment,
hover interactions and permissions remains a separate UI/data gap.


## Replica checkpoint and bounded comparisons

The full 15-case demo run `20261028T051129Z` passed 300 steps and seven persisted
assertions, with unchanged implementation manifests. Its recipient case passed
65 actions (66 captured steps):
`ev_6ad98e9504d41001662496c42e5977d7e156a4d9207bf64617b118b294c551d8`.
It exercised Enter/comma/semicolon, immediate previous-chip removal, selected
chip editing without a trailing input, literal invalid Escape, local suggestions,
Cc/Bcc shortcuts, moving a chip, recipient undo/redo, save/reopen and automatic
Cc/Bcc reveal. Headers and body exactly matched the synthetic saved fixture.
Artifacts/event coverage are complete for this replica case; that property alone
is not original/replica equality. Original evidence above remains attach-limited.

The measured Enter/delimiter/Backspace/edit replacement, Cc/Bcc reveal, move and
shared-history transitions have both original and replica support within these
fixtures. Full address-book/ranking equality, clipboard/drag/drop, From/alias
selection, right contact pane, complete focus/history semantics and broader
recipient grammar remain open. No broad compose feature is marked verified.

Recipient editing keeps synchronous draft-ID-bound snapshots for autosave,
sending/scheduling and account switching. Independent adversarial tests cover
malformed fragments before valid entries, safe scalar round trips, duplicate
moves, request races and pre-render delivery locks. Invalid draft text remains
editable/persistent. Send/Schedule use the same browser-safe strict outgoing
parser as the backend and MIME builder; every malformed fragment blocks dispatch.
The deliberately supported outgoing grammar and remaining address-book limits
are documented in [the API contract](../api/CONTACTS.md). This is an independent
adapter choice, not proof of the original's entire address grammar.
