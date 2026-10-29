# Split Inbox: read-only form observations

2026-10-28. This supplements [the static Split Inbox investigation](split-inbox.md). No split was created, edited, enabled, disabled, reordered, or deleted. No name/query value or checkbox was changed. Account-wide mutation testing remains a separate approval-only proposal.

## Identity and capture limits

Original retained build `db8c4288f33febf25ad9`, JavaScript SHA-256 `c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`; native 1041.0.75 is the prior recorded identity, not freshly read here. Original Chrome target `D671989E0783BD8ED03CAB22FC99F38F` reported Chromium 156.0.8078.48. Investigation used REA 6.8.0 and skill 49. The existing 11-file static analysis is `ev_de2e7650bae4ed90e453916d219a992cc4a18e76dc922c7fe69e749919986970`; supplemental parser analysis is `ev_51d77d1366d94b1550f5488341e9719ae74f81aec60dce05e585f62fe44e56f8`. Static declarations are not execution proof.

Private captures, screenshots, scenarios, and retained source remain in `evidence/private/split-inbox/`. No public copy of vendor code or account/mail identifiers is included here.

| Observation | Evidence | Actions |
| --- | --- | --- |
| Direct Settings → Split Inbox Library | `ev_1c0911c95038173915136d36add19c2ee7b3cf252b071adcc4ce4e3489d75640` | 6/6 completed |
| Library → Build Your Own → untouched custom form | `ev_61c2829eb8d630bd109f677bd47a390c2cd311880e1de1e246d3b4ed80aa2ca2` | 8/8 completed |
| Untouched custom form → Cancel → Library | `ev_fd404f675a5de62935b82b24947bc75606e25f522fc6bc72fc8de219353a7d23` | 10/10 completed |
| Return to Inbox, no composer/form/library/Settings | `ev_dead3f34d84409b127aea1057a5b4495cafdc67e600dc9c7e99c295eafe601d4` | 5/5 completed |

Each capture has all requested action-state DOM/accessibility records, lacks retained events, and reports `equality_eligible:false`; no truncation is reported. An external browser was attached and disconnected. A requested viewport/DPR does not independently establish the target's actual CSS viewport or computed geometry.

## Observed form

The Library has a searchable categorized template surface and **Build Your Own**. Opening that control shows **New Split Inbox** with:

- **Name**, an empty single-line input with placeholder “Enter a Split Inbox name”.
- **Definition**, an empty single-line search-query input, with examples for sender/recipient, subject, and label criteria.
- A separate **Auto Labels** section. Its join selector displays **OR** and its label selector has no selection. Neither dropdown was opened.
- Unchecked **Also show conversations that match this Split Inbox in Important or Other**.
- Unchecked **Hide this Split Inbox when empty**.
- **Cancel** and a disabled **Create** button.

The screenshot shows the Name field with a purple underline. Active-element identity and computed focus styles were not separately measured. These values describe this untouched new form in the current account; they do not establish factory defaults, account inheritance, or persisted settings. Cancel returned to the Library without an unsaved-changes prompt because nothing was edited.

Observed selectors:

| Target | Selector |
| --- | --- |
| Read-only Library entry | `.RightPane .Footer-settings-menu:visible .Footer-row:has(.Footer-label:text-is("Split Inbox Library"))` |
| Library | `.SplitInboxTemplateLibrary-dialog:visible` |
| Build Your Own | `.SplitInboxTemplateLibrary-dialog:visible .TemplateLibrary-build-your-own-button` |
| Name | `.SplitInboxCustomSettings:visible input[name="editingSplitName"]` |
| Definition | `.SplitInboxCustomSettings:visible input[name="editingSplitQuery"]` |
| Checkbox container | `.SplitInboxCustomSettings .SplitInboxCheckbox-container` scoped by exact `.SplitInboxCheckbox-label` text |
| Untouched Cancel | `.SplitInboxCustomSettings:visible button:text-is("Cancel")` |

## Static safety and behavior boundaries

The direct Library entry changes the visible modal state; Build Your Own similarly sets the local custom-editor state. Selected handlers were inspected before those clicks. No template was activated.

The **basic Split Inbox Settings** component has a mount effect that can create a default Calendar split when its active/inactive feature flag is absent and no Calendar split exists. The current Inbox visibly already has Calendar, but this investigation did not rely on an unverified branch guard: it used the direct Library entry and avoided mounting basic Settings. A future configuration probe must preserve existing defaults and account capability state.

The custom form's Name/Definition handlers stage local values; Enter in either input calls Save/Create. Therefore Enter is not a safe exploratory key in this form. Its hide-empty checkbox also invokes a nudge-setting action before Save, so the entire form cannot be described as having no persistence until Save. The leave-in-Important/Other handler only stages a value in the selected declaration. These are static findings; no checkbox behavior was exercised.

Edit-mode **Save**, **Turn Off Split Inbox**, **Turn On Split Inbox**, and **Delete Split Inbox**, duplicate-name/replacement dialogs, query validation, template defaults, count/membership behavior, and reorder are still unobserved. The declared delete dialog warns that deletion cannot be undone. Root has a separate proposed owned fixture for those account-wide actions; this read-only record provides no permission to execute it.

REA 6.8.0's scenario action schema has no pointer-drag action. The retained original sortable uses `.SplitInboxSettingsRow-dragHandle`; no keyboard reorder handler was found in the selected component. A future approved reorder may use an independently verified ordinary-UI drag tool with exact original-target/owned-handle identity and REA pre/post captures. It must not be reported as a REA drag action or replaced by a private endpoint.

The read-only original lease ended with Inbox restored and no composer or settings overlay. No implementation or original/replica parity assertion follows from this form inspection.
