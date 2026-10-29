# Split Inbox configuration — SH002 discovery

Recorded 2026-10-28. This combines a **static specification, untouched-form
observations and a comparison plan**. Saved configuration, membership and effects
have not been verified against original runtime in this pass. The reconstruction's
fixed Important/Other/Calendar views do not establish custom Split parity. No
original create/save/toggle/reorder/delete or global-setting action was requested.
Outlook is excluded from the requested implementation.

## Evidence and scope

The retained original web build is `db8c4288f33febf25ad9`; main JavaScript SHA-256
`c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`.
Initial authenticated-page/source capture:
`ev_24532bee2b2a260f736402d6848967e04e180e1d92895e5018fec0f1592cfcbf`.
The existing settings observation
`ev_673506aefe95ecf95f476f0e6293a763b21bf22bcf06fbe3fa73fa17d9f2f624`
establishes a settings surface containing splits, not custom configuration effects.

Pinned REA6.8.0, installed skill49, analyzed eleven literal-seeded inert fragments:

- Parent `ev_de2e7650bae4ed90e453916d219a992cc4a18e76dc922c7fe69e749919986970`.
- Summary `ev_72869262ea963458801103a292d1330d0f92fbea689d7c3dd34450e6105f1b67`.
- Extracted-tree SHA-256
  `388c14471f1a7ce9aa1cc9e1a2838c1fd5fabad7ce226f7e0ad63830878b74c6`.
- 72,751 source bytes, 15,809 AST nodes, 86 findings, zero parse failures.
  Application coverage remains partial, with 3,929 semantic unknowns.
- A separate selected parser-method analysis is
  `ev_51d77d1366d94b1550f5488341e9719ae74f81aec60dce05e585f62fe44e56f8`,
  summary `ev_05b1869ae24818434c1ed251d8d6f2be4917c28c616688d08c239e0cfdb8a0d2`.

Private range/hash records, original fragments and complete receipts are under
`evidence/private/split-inbox/`. The first REA attempt failed before parsing when
macOS's process-ownership helper could not compile in the host sandbox. Its
receipt and healthy doctor record remain; the later changed-permission analysis
completed. No vendor code was executed. Supporting ListRouter/ListCounts/Gmail
query, tab-visibility and shortcut reads use the **same retained source hash**;
they are ordinary inert source reads outside the eleven-file REA semantic
selection and are identified separately below. Static declarations are not proof
of server implementation, availability, saved defaults or successful execution.

Additional runtime detail is maintained separately in
[Split Inbox runtime observations](split-inbox-runtime.md).

## Observed original runtime: untouched form only

Source agent used the source-reviewed direct library route and an untouched new
custom form, avoiding the basic-settings mount branch described below.

| Evidence | Observation | Limits |
| --- | --- | --- |
| `ev_61c2829eb8d630bd109f677bd47a390c2cd311880e1de1e246d3b4ed80aa2ca2` | Eight declared actions completed. New form showed empty Name and Definition, a separate Auto Labels area with OR selected, unchecked leave-in-Important/Other and hide-empty controls, Cancel and a disabled Create button. The Name field had a purple underline. | No values entered or change actions submitted. These are staged defaults in this account/form, not factory defaults or account inheritance. Capture events are incomplete. |
| `ev_fd404f675a5de62935b82b24947bc75606e25f522fc6bc72fc8de219353a7d23` | Ten declared actions completed; Cancel returned to the library. | No create/save/toggle/reorder/delete was clicked. This does not establish matching, persistence, backend-write absence or full equality. |

The remaining ledger is static unless explicitly marked as this runtime
corroboration. Complete runtime metadata/captures remain private; no real inbox
content or contact details are reproduced here.

## Static findings

| ID | Finding | Source boundary / limits |
| --- | --- | --- |
| SI-S01 | A split stores identity, external identity, name, textual query, compiled provider query, referenced labels, type/template, enabled state, leave-in-Inbox flag, hide-empty flag and an iOS notification field. | `split_model_and_mutations.js`; original line645/column249855 onward, UTF-16 coordinates. Notification delivery was not investigated. |
| SI-S02 | The custom form has Name and Definition fields, a separate Auto Labels selector with a join choice, a leave-in-Inbox checkbox and a per-split hide-empty checkbox. | `split_custom_settings.js`, original line896/column18837 onward. Untouched form controls are also runtime-corroborated above; saved behavior is not. |
| SI-S03 | A custom split needs a name and an effective definition. Text and name are outer-trimmed; a separate label selector can supply the definition. Names are checked through a shared slug helper and against other splits. | Exact Unicode/punctuation slug normalization and runtime validation are not established. New custom form state initially stages both booleans false; that is not an observed persisted or new-account default. |
| SI-S04 | Reserved custom names include Inbox, Important, Other, VIP, Team, News, Docs, Shared and Calendar through the model's reserved-name checks. | Model helper. No new custom name was submitted. |
| SI-S05 | The field labeled Definition does not accept arbitrary ordinary search. Bare text and unsupported split tokens are rejected; typed `autolabel:` is rejected in favor of the separate selector. Missing labels have a validation path. | `split_query_validation.js` plus selected parser methods. No runtime matching or validation comparison yet. |
| SI-S06 | Static parser-valid families are broader than the four form examples: contact, subject/list-header, label, date, attachment/filename, category, AutoLabel and shared token families appear. Status-style exclusions include done/other/important/muted/snippets/reminders/snoozed/archived and, for splits, unread/all. | Parser token categories do not prove the full concrete spelling, provider compilation, negation or matching semantics. Do not silently implement unsupported families as text/body search or zero matches. |
| SI-S07 | Name/hide/order edits are distinct from definition identity. Query, enabled state or leave-in-Inbox changes can produce a new matcher ID, while external identity is preserved on replacement. | Model update and replace paths. This suggests separate stable identity and definition generation in the replica; it does not recover vendor ID protocol. |
| SI-S08 | A legacy split array and a newer dictionary-plus-order model coexist. The newer path requires a feature flag and a nonempty stored order. Account access filters enabled splits and selects Inbox versus Important/Other according to unified mode. | `split_account_access.js`. Which branch is active for a selected account and its inherited/default values remain unobserved. |
| SI-S09 | Explicit create/edit/enable/delete/reorder paths persist settings and reset counts. The newer write includes an updated-history/version field and handles a stale-version failure. A private backend path candidate is `splitInboxes.modify`. | Model/actions and previously retained modifier/backend methods; no private endpoint was called. Reordering operates on external IDs in V2 and internal IDs in the legacy array. |
| SI-S10 | Gmail limits are checked against URI-encoded compiled new-split **and aggregate Other** queries, with a client threshold7800. | Model helper. A raw local string limit would be an implementation limit, not equivalent provider-query validation. |
| SI-S11 | AutoLabel selection can depend on AI/plan capability. Custom prompt-backed labels have an upgrade path; deleted/disabled/unavailable labels can produce a split-definition issue. | Custom/template settings. Full entitlements, current account grants and classifier behavior are not established. No upgrade or purchase was initiated. |
| SI-S12 | Unsaved custom edits have a discard-changes prompt; Enter invokes save validation. Custom deletion has an explicit destructive confirmation. Existing-name creation can offer replacement rather than silently creating a duplicate. | Custom settings and Create/Delete actions; notifications can reopen settings. No corresponding action was executed. |

The source declares template/library paths as well as custom definitions. Examples
include VIP, Team, News, Calendar, Shared, Documents and Reminders, with additional
application-specific templates. The library is supplied through account settings;
this inspection does not establish a complete entitled inventory or which are
enabled. Templates must not be reconstructed as invented prompt strings or
silently activated on entry.

## Supporting static membership/count/navigation reads

The following come from narrowly selected same-build source ranges, not a new
runtime or provider observation. Supplemental private provenance is in
`supporting/identity.json`; further visibility/shortcut offsets are retained in
the original hashed bundle.

- `ListRouter.getListIdsForThread` (original line647/column9139) evaluates all
  matching split definitions for eligible Inbox threads. A thread can receive
  more than one custom split ID. If **any** matching split has leave-in-Inbox
  false, Important/Other membership is removed. A true flag on another matching
  split does not reverse that exclusion. This modifies computed logical list
  membership; it is not evidence that Gmail INBOX is physically removed.
- The same router has special handling for spam, muted mail, drafts, scheduled
  mail, reminders, shared mail and Calendar feature variants. The general overlap
  statement must not erase these conditional branches or imply their complete
  runtime behavior has been verified.
- Gmail approximation builds Inbox/Important/Other queries that subtract the
  union of enabled splits whose leave flag is false. Alias-sensitive provider
  compilation and calendar heuristics remain conditional. Local view matching
  and provider search can differ; neither should be inferred from a source string.
- `ListCounts` (original offset7064435, UTF-16) stores `total`, `isComplete` and
  `isEstimate`. It adjusts estimates on thread changes and refreshes from local
  storage. These are conversation counts, not a declaration of unread badges.
  Overlapping custom totals must not be added together as an Inbox total.
- Tab visibility (around offset11775800) keeps a selected split visible even
  when empty. A zero estimate can retain its previous visibility. Per-split
  hide-empty state is separate from enabled state and membership.
- The hide-empty settings surface excludes Important and Inbox from its
  selectable rows; Other has a separate V2 setting. It has select-all controls
  and writes a nudge state. A single global hide-empty boolean is incomplete.
- Tab routing builds an ordered set of visible split tabs. The regional shortcut
  path binds Tab/Shift+Tab movement; selection wraps and opens the chosen list
  while leaving search and preserving a filter. Some other focus regions consume
  those keys, so global interception is not equivalent. Exact focus, scroll,
  selection and count-filter behavior still need controlled runtime comparison.

## Original inspection and approval boundary

A static **basic-settings mount effect can create a default Calendar split** when
one is absent and a feature flag selects that branch. Opening that surface is
therefore not universally read-only. The hide-empty checkbox also writes a nudge
immediately; not every change waits for Save. Do not click a toggle merely to
inspect its appearance.

The read-only route used above was a source-reviewed direct library entry, then
an untouched custom form and cancel/back. Recheck actual handlers and current
state before repeating it. Creating, editing, toggling, reordering or deleting an original
Split, or changing a global/unified setting, requires a separate action-scoped
approval under the repository's account-wide-mutation rule. No approval for configuration mutation or corresponding executed mutation is
claimed here. Untouched-form/cancel observations above do not grant it.

## Concrete acceptance scenarios

These are **planned**, not verified. Use controlled local synthetic fixtures for
implementation tests. Original mutations require approval bound to an owned
unique split/query, the existing configuration/order fingerprint and cleanup.

| Case | Trigger and expected comparison |
| --- | --- |
| SI-A01 entry | Read untouched library/custom form; compare labels, controls, keyboard/focus, defaults and entitlements without changing settings. Verify no mount-time account mutation before calling an entry read-only. |
| SI-A02 create/reload | Create an owned split on synthetic subject/from criteria; compare match/nonmatch membership, exact name/definition, enabled state and persistence after reload. |
| SI-A03 validation | Compare empty name/effective query, duplicate/reserved/Unicode names, malformed groups/quotes, unsupported/bare-text criteria, missing labels and typed AutoLabel rejection. |
| SI-A04 edit/identity | Edit name versus query/leave/enabled/hide separately; compare stable navigation, counts and order without changing existing mail or unrelated splits. |
| SI-A05 overlap | One thread matches two custom splits; test both leave=true, both false, and each mixed ordering. Compare Important/Other exclusion and physical Gmail INBOX membership independently. |
| SI-A06 ordering | Reorder custom and built-in tabs, reload, disable/re-enable a split and inspect insertion position. Compare keyboard cycling over only eligible visible tabs. |
| SI-A07 empty counts | Compare selected-empty retention, unselected complete zero, loading/estimated zero, nonzero arrival and filtered lists. Distinguish total count from unread count. |
| SI-A08 label lifecycle | Bound label identity to one account; compare rename/deletion/recreation, AutoLabel capability loss and unavailable-definition presentation without silently retargeting. |
| SI-A09 mixed threads | Received-plus-draft, INBOX+SENT, archived, snoozed, trash/spam and Calendar reply fixtures preserve their distinct eligibility. Date/timezone/alias semantics need dedicated comparisons. |
| SI-A10 staged close | Unsaved settings, conflict, failed/uncertain save, cancel/back and account switching preserve fields and an unrelated composer, rich/recipient undo, contact pane and AI history. |
| SI-A11 pagination | New mail, moves, rule/label edits or account changes between pages must not mix membership/count generations or leak another account. Equal-date Unicode IDs keep stable order. |
| SI-A12 deletion | Delete only the owned custom configuration after approval; compare confirmation and landing list, and prove no mail, label or provider resource was removed. |

## Replica design and remaining work

The proposed implementation is an account-scoped revisioned configuration with
stable local split IDs, definition generations, strict validated metadata-query
ASTs, immutable scoped save receipts and explicit recovery. Preserve legacy
Preferences and all Draft JSON byte strings; reads must not seed settings for
other accounts. Original global/unified and template branches remain separate
coverage items rather than being relabeled implemented.

Use a new **role-preserving, body-free header projection** for From/To/Cc. Existing
contact occurrences merge roles and cannot correctly answer those predicates.
Common list/count paths should compile validated metadata predicates to bound SQL,
return only ThreadSummary rows and preserve the thin-list performance work.
Keep physical mail labels unchanged; custom membership is a view. Counts/page
cursors must bind account, configuration/label/data generation and sort context.
Pending projections or unsupported criteria are unavailable/partial, never exact
zero. Do not send a saved local query to Google or a model implicitly.

Initial local grammar, normalization/limits and per-thread versus same-message
matching are explicit design choices until compared. Dates, filenames, categories,
list headers, shared/team criteria and typed AutoLabels require real metadata and
capabilities before exposure. No automatic classifier, provider backfill, original
server protocol, or complete SH002 parity is established by this plan. Private
API and membership plans retain the detailed migration/performance/recovery cases.
