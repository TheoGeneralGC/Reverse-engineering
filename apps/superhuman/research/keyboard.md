# Keyboard and command reference inventory

Bounded research, 2026-10-29. The original Inbox command menu, Shortcuts reference
and one physical Ask AI shortcut were inspected. The
[functional inventory](keyboard-reference-inventory.csv) contains **124 reference
rows in 12 sections**, including search operators. These are declarations in the
rendered reference DOM, not 124 exercised actions or verified replica bindings.
Every inventory row remains `not-compared`.

## Identity and evidence

REA CLI6.8.0 and the installed reverse-engineer-anything skill49 were used against
the existing external original target `D671989E0783BD8ED03CAB22FC99F38F` on local
CDP9222. Browser metadata reports Chromium156.0.8078.48. The retained original
build remains `db8c4288f33febf25ad9`, main JS SHA256
`c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`;
current served bytes and native version were not independently rechecked.
Requested viewport was1440×900/DPR1 and saved PNGs2880×1800. Actual external CSS
viewport/DPR remains unmeasured; this is not pixel equality evidence.

| Observation | Evidence | Outcome |
| --- | --- | --- |
| Inbox Cmd+K | `ev_e9ae3c011640b69d75bc523a1839c2639f2c9a811394fb398562998fc073128f` | Three actions completed; command input/menu observed, no command selected. |
| Search for Shortcuts | `ev_88b41c36539391d528896fd21029c931fefcd6e271c7f449b5235244bf3d54ed` | Five actions completed; named help result observed. |
| Open Shortcuts reference | `ev_7d6901cc2ea04999eeda31ab8d9e09a3da1c7244d8c342116c47c77d14919838` | Six actions completed; in-app reference rendered. |
| Literal automation `?` | `ev_9187bc938ae07da003a08821b7552ff670cd0068ac8b3396832432be30e9cbbb` | Three actions completed; screenshot shows Search. Persisted AI DOM presence did not establish a visible AI pane. |
| Physical Shift+/ | `ev_ef7750b1065613cb1a55a628e91c3002454cb17ab021c20407e449ebd20c3b75` | Four actions completed, including a visible-pane wait; reviewed screenshot shows the empty Ask AI pane and focused question field. |
| Return to Inbox | `ev_885d424e28fa7c90e7264844f06f947b16f1f8896c2e5f7a4e12124418bbe2ec` | Four waits completed; Inbox/Recent Opens visible, no composer or settings editor. |

Each action capture also has the initial passive step. They lack retained events,
report equality-ineligible, and disconnect from the externally owned browser.
Private captures, screenshots and derived raw inventory remain under
`evidence/private/keyboard/`. No declared action edits or submits mail/drafts,
changes settings, or submits an AI question. That statement does not prove
absence of background network work. Only the read-only Shortcuts help command
was selected. The literal-question trace is retained as a distinct outcome;
the physical chord does not retroactively change it. A preliminary inference
from persisted AI DOM was corrected after reviewing its screenshot.

## Observed reference and interaction

Empty-query command suggestions in this Inbox context contain ten actions,
including label removal and link opening. They are context suggestions, not a
complete command catalogue. Searching `Shortcuts` exposes the named help action;
opening it renders Actions, Navigation, Conversations, Labels, Messages, Compose,
Pop Out Compose, Format, Folders, Windows, Calendar and Filters sections.

The CSV preserves each label and its concatenated rendered key text. This does
not independently establish whether adjacent badges mean a chord, a sequence,
an alternative, or an operating-system-specific action. Pop-out/native/window
entries are declarations even when the current inspection target is a browser.
Search-operator rows are identified separately. Dynamic visibility, platform and
account/context gates remain open.

The reference declares Ask AI on the question-mark key. The explicit physical
Shift+/ trace visibly opens the empty AI sidebar from Inbox. The then-current
replica top-level Mail handler mapped `?` to its shortcut dialog. A separate
reviewed 646 candidate now passes the bounded physical Inbox Ask AI comparison and
synthetic History/help-focus checks. Its source is now applied with the reviewed
tracking rollout; the original comparison remains bounded. See the
[tracking/keyboard checkpoint](tracking-keyboard-checkpoint-20261029.md). The literal
automation `?` trace showed
Search, so future keyboard tests must distinguish physical key chords from
character-only automation. Hidden or persisted component DOM alone is not a
visibility oracle.

The current [official keyboard documentation](https://help.superhuman.com/hc/en-us/articles/46005701270541-Keyboard-Shortcuts-in-Superhuman-Mail)
also identifies Command as the action/shortcut discovery surface and directs
users to its Shortcuts entry. The [navigation guide](https://help.superhuman.com/hc/en-us/articles/46005789591693-Speed-Up-With-Shortcuts)
describes folder and calendar navigation. These corroborate the discovery path;
they do not verify the 124 runtime declarations or replica implementations.

## Acceptance work

1. **KB01:** physical Shift+/ opens/focuses Ask AI from Inbox; preserve existing
   AI input/history and do not submit a question or modify a draft.
2. **KB02:** keep Shortcuts available through the observed command name and help
   control, including keyboard focus/Escape behavior without losing an editor.
3. **KB03:** compare command search selection, filtering and contextual suggestions
   in Inbox, open conversation and a new owned composer. Do not execute a mail
   mutation merely to inventory its label.
4. **KB04:** verify navigation/message/account/selection bindings with explicit
   context and focus; editor text and modal handling must be compared separately.
5. **KB05:** format, recipient, scheduling and Send shortcuts need owned fixtures,
   exact before/after payloads and the approved delivery audience. A reference row
   alone does not authorize a new mail or invitation experiment.
6. **KB06:** compare Mac browser/native, sequence timeout, international layout,
   OS-reserved bindings and conflicting editor shortcuts before wider parity claims.

No keyboard feature family or inventory row is marked verified by this research.

## Bounded replica candidate follow-up

KB02 completed 50 actions on the actual final candidate, with exact unsent prompt/
existing-session storage, a physical chord on the real focused History button and
immediate passive Subject-focus proof after Command→Shortcuts→Escape. One normal
identical authored PATCH occurred; zero questions/new sessions/model/provider calls.
The stopped audit passed. KB01's earlier final-close origin403 remains failed; the
successor fixture used explicit WEB_ORIGIN, preserving product CORS. This is bounded
KB01/KB02 support, not implementation/comparison of all 124 reference rows, platform
contexts or full focus behavior. No CSV reference row is promoted to verified.
