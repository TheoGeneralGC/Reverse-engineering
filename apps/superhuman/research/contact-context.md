# Contact context pane: discovery and next implementation boundary

Recorded 2026-10-28. This investigation reads retained original captures and
shipped source only. It operated no browser, fetched no profile, modified no
account/draft, and changed no product implementation. Runtime observations,
static declarations and reconstruction choices are separated below. The contact
pane is not verified as a complete replica feature.

## Identity, evidence and coverage

- Original page: authenticated `https://mail.superhuman.com/`, main web build
  `db8c4288f33febf25ad9`, captured by REA parent
  `ev_24532bee2b2a260f736402d6848967e04e180e1d92895e5018fec0f1592cfcbf`.
  Script SHA-256: `c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`.
  Browser identity was Chrome `156.0.8078.48`; native macOS implementation details
  were not inspected by this task.
- New focused static analysis used pinned REA 6.8.0 through `npm run rea --`,
  the installed `reverse-engineer-anything` skill version 49, and existing Node
  24.22.1. Corrected parent evidence:
  `ev_c7999f107017775356aefc12cb512d7ad79418825e63d40f5ad3ab5ac672e6db`;
  summary projection:
  `ev_ac3ddc6d4e9be659d12027cb94d0e0528e46d0d47eb1bea539bf7dd8e9ae0ac8`.
  Private export: `evidence/private/contact-context/analysis-corrected.bundle.json`.
- Seven selected class expressions were wrapped for inert parsing, not executed.
  Their source mapping and hashes are in private `selection-identity.json`. This
  is an analysis container, not an original standalone module or reconstructed
  backend. No vendor program text is copied into this document or product code.
- The selected application graph has no parse-unknown node, but semantic coverage
  remains incomplete with 2,443 unknowns, including unresolved injected services
  and dynamic references. Summary-view exhaustion does not prove full application
  coverage or runtime execution. A superseded excerpt analysis,
  `ev_98dc7f9b813c29c91ff92e6b35226d3bab73ec9175709434978876d410f8f50a`,
  had a local selection-boundary parse failure; that was analysis packaging,
  not observed original behavior.

Source locations below are one-based lines and zero-based UTF-16 columns in the
exact main script above. The retained page capture starts after attachment and
omits prior traffic, most worker activity, raw network bodies and storage values.

| Selected class | Original location | Fragment SHA-256 |
| --- | --- | --- |
| `ShowContactAction` | 588:318118 | `b9a8938c708a6c2303a94141400f1a269e9ca2fcf03f3a122051df2ee0cdb1d1` |
| `SetRightPane` | 588:382162 | `8fa6aa3c2de03114e0086de00ef252ab248434d42927054e7f0a7aea9b5c8e28` |
| `ProfileModel` | 736:59772 | `d4b343e6ecdcfb518f839e048fc7584b7e7ef5e227783aaa88c2dc48d34ed944` |
| `ProfileStore` | 736:61032 | `ccd41a5548ceae70e2f6445f7aea1356dd81c6d55533fa49bc4e29d6bb09faf2` |
| `ContactBio` | 990:30937 | `13905941020640205791464321d5e490d65f9de38d9a4cc8df18e737b920ef45` |
| `ContactPane` | 990:47716 | `dde761d35b36196b9153685ba5667b57dadad127c6640cb5b869662910b291f1` |
| `RightPane` | 990:250191 | `9f07ae0d7a557c19c21a0714b99771b36b83ca561dfab34f09d99f618414f56f` |

## Observed runtime from retained recipient probes

No new actions were executed. Existing DOM snapshots were compared locally;
private contact identities and message subjects were reduced to ordinal identities
and structural counts. The sanitized comparison is retained privately as
`contact-context/sanitized-runtime-observations.json`. It contains no names or
email addresses. These captures have missing event coverage and are
`equality_eligible=false`; a changed DOM establishes an observed end state, not
which unrecorded asynchronous request caused it.

| Evidence / captured step family | Observed contact-pane result |
| --- | --- |
| Named-recipient probe `ev_40b6cceba647fcc8c8b70b060ae7b9d9705dbbc3d4f15a3c66766a6817f95211`, `quoted-name-address` → `commit-quoted-name` | Typing left the preceding pane unchanged. Enter changed it to the synthetic named recipient. A second named recipient behaved the same way. |
| Same probe, `invalid-email-fragment` → `commit-invalid-fragment` | The incomplete synthetic address `rea-invalid@` changed the pane on commit. The screenshot shows its raw label at the top and in the email/details area. No enriched biography or location was observed for it. |
| Focus probe `ev_e4c2017d6ca3d12d44188d41b50121db2a8b829780e457362db93c124e2250bb` | Committing a name-only invalid fragment without `@` left the preceding contact pane unchanged. Committing Cc/Bcc or a replacement To address changed it to that recipient. Moving focus to an empty field alone retained the preceding pane. |
| Suggestion probe `ev_98686d78acac23c3ddc08db99b70d5890d7e34f6f1e5599cbc1cc0253730e159`, `suggestion-down-*` / `suggestion-up` | Keyboard-highlighted rows and the pane email matched. Cycling the five rows changed the pane accordingly. Different rows showed zero to four recent-mail entries; identities and subjects remain private. |
| Same probe, `approved-contact-query` / `exact-suggestion-visible` → `accept-settled-suggestion-tab` | Replacing the query and displaying a new selected suggestion did not itself change the preceding pane in these snapshots. Accepting with Tab did. The first name query happened to match the already displayed contact, so that case cannot establish whether initial highlight alone triggers an update. |
| Repeated Escape probe `ev_9f60ad8fefdb05b6dc72b1bf4112b82656d83a69a4d7b976d9d25a629e970305` | Name-only Escape commit retained the prior pane; exact-address Escape commit changed it. This is consistent with committing the literal input, not necessarily accepting the highlighted suggestion. |
| Focus / move cleanup, including `ev_8713a9bed616fba45c5e8ffbd8c9dcb98f72104f427a115a7c263c2bbc4d4ef6` | Selecting a recipient changed the pane. Deleting selected chips retained the last contact, including after all three recipient fields were empty. Clearing subject/body also retained it. Inbox restoration hid the pane. |

The named screenshot is private `recipients/original-names.png`, 2880×1800 pixels.
Its CSS viewport and DPR were not independently measured. It supports the visible
fallback arrangement; it is not a reliable source of CSS pixel geometry.
No full enriched-profile, CRM, alias, invitation or message-hover runtime scenario
was captured by this task.

## Declared triggers and clear/retain rules

| Trigger / state | Static declaration | Location |
| --- | --- | --- |
| Explicit contact | `ShowContactAction` selects a contact email, publishes cached profile data immediately, then optionally refreshes. A returned refreshed email is checked against the current selected email before publication. Account isolation and cancellation outside this action are not established by that check alone. | 588:318118 |
| Empty contact | A null contact or empty email clears the `rightPane` selector. The separately cached `contactPane` payload is not explicitly erased by that branch; the renderer gates visibility on the selector. | 588:318118; 990:253591 |
| Recipient text input | Raw input changes load suggestions; this method has no direct show-contact call. Suggestion keyboard/pointer highlight may separately update the pane. | `_onInputTextChange` 758:103201; selector update 605:277725 |
| Recipient chip / commit | Selection uses the current edge recipient; a contact with no email can fall back to the account's cached author contact. Addition shows the last added recipient when its email is nonempty. Thus a name-only invalid commit and an incomplete address with `@` can differ. | `RecipientList`, 758:93733, documented in `recipients.md` |
| Recipient removal | Empty-input Backspace has an explicit previous-recipient/author fallback path. Selected-chip removal does not directly clear the pane; selecting a remaining neighbor can still publish its contact. These distinct routes should not be collapsed into a universal deletion rule. | `RecipientList._onBackspace` / `remove`, within 758:93733 |
| Contact-name hover | `ContactNameChildren` has hover-intent show-contact behavior when email exists and `disableContactAction` is false. From-field hover and several recipient/read-detail controls also dispatch that action. | 605:2921; original offsets 6801624, 10352041, 10522077 |
| Message focus | `FocusMessage` updates the selected message and requests `SetRightPane`, unless `skipRightPane` is set. An expanded message prefers its nonself sender, then its first nonself recipient. | 588:385557; expanded-message contact 647:40313 |
| Thread / label context | Default thread contact selection considers messages visible in the current label (all messages for drafts), prioritizes unread/draft-related messages, then reverse-orders remaining senders, preferring nonself. Recipient and self fallbacks exist. This is richer than always choosing the thread's latest sender. | `getContactForContactPane` 647:39126 |
| Contextual navigation | `SetRightPane` clears contact selection for contextual transitions, then can choose a message/thread contact, invitation/calendar, activity feed or snippet pane. Explicit command/calendar states and current view alter precedence. | 588:382162 |
| Search / recent mail | Clicking the pane name or Mail heading starts search with contact preservation. Clicking one recent-mail row opens that thread with `preserveContact:true`. Ordinary search entry can clear contact selection unless that option is set. | `ContactPane.onClick` near 990:59157; recent-mail render near original offset 14474776; search action offset 8308852 |
| Other pane modes | Calendar creation/details, CRM forms, bulk selection, Go, settings and certain snippet/knowledge modes can take precedence over the contact renderer. This does not by itself prove the underlying contact cache is cleared. | `RightPane`, 990:250191 |

Body mailto/mention hover and entitled URL-profile “powerup” paths also exist.
`ShowProfileFromUrl` selects cached URL-derived data, then requests a backend
profile by URL (783:83280). These are additional candidates, not measured behavior
for ordinary body links in the current account.

## Declared contents and actions

The base pane's title prefers enriched profile name, then the selected contact's
display name, then a known contact-store name. Without enrichment it can show just
name and email/details, as the synthetic screenshot demonstrates. A complete
placeholder card should not be mistaken for available enrichment.

| Section | Declaration and important limits |
| --- | --- |
| Title | Selectable name with copy control; name click initiates contact-preserving search. `_getName` 990:59157; `_renderName` 990:59607. |
| Header / fallback details | Email with copy and compose-to controls. Enriched header can include avatar, membership/CRM badge and location; the location links to a map. Fallback details do not require those profile fields. `_renderHeader` 990:60206; fallback 990:68708. |
| Aliases | Team-member alias resolver supplies primary email and aliases. First four aliases show initially; Show more/less toggles local expansion, reset when selected email changes. This is not proof of general address-book alias discovery. 990:65979. |
| Biography | Optional, initially truncated at 200 characters with an expansion control; linkification depends on declared biography source. `ContactBio` 990:30937. |
| Mail | Cached/retrieved recent threads, excluding the currently open thread and displaying at most four. Rows show subject and relative date; row navigation preserves the selected contact. 588:319202; 990:66728. |
| Links | Optional provider links and a derived website link for nonpopular email domains. Known social links are ordered; mailto links duplicating the contact address are omitted. URL schemes are filtered. A derived domain website is not evidence that enrichment found or verified a company website. |
| Insight sections | Provider-supplied headings, linked/text data, timestamps, notes and tags. Notes initially truncate at 140 characters. CRM fields depend on provider, feature flags and write permissions; some are editable. `_insightSections` 990:65041; note 990:37728. |
| Account / integration actions | Refer, Add to Team, Join team, Edit Profile, add-to-CRM and sequence actions are conditional. These can mutate settings, billing/team membership or external CRM data. They are outside the narrow read-only profile reconstruction boundary. |

The compose-to email control dispatches `ComposeAction` with that contact; an
unmodified Shift-click requests popout composition (604:15504). It is not a passive
mailto link. Copy, compose, social/map navigation, CRM controls and referral/team
buttons therefore need distinct probe and implementation boundaries.

## Data sources and unknowns

Static `ProfileStore` data flow (736:61032) declares:

1. In-memory profiles keyed by lowercased email and a separate URL cache.
2. Local disk profiles and recent-thread metadata updated from thread activity.
3. Backend profile reads using `/~backend/v2/profile?email=<email>&name=<name>`;
   URL-derived profiles use the same service family with a URL parameter.
4. A refresh candidate when insights are absent, lack a timestamp, are older than
   60 seconds, or there are no recent threads; repeated work is serialized per
   contact. This is a client freshness declaration, not a service SLA.
5. Up to five cached recent threads. If the cache is empty, a Google path queries
   sender/To/Cc/Bcc matching excluding drafts, requests at most five threads, and
   loads their metadata. This fallback returns no threads on the Microsoft branch.
6. Profile insights/CRM sections and explicit provider integration services.

These declarations do not identify the private backend's enrichment vendors,
licensing, completeness, account permissions or actual calls during a particular
hover. No new Google People, CRM, social or enrichment grant is justified by this
source alone. Recent-mail rows observed at runtime may have come from existing
cache or service reads; missing events cannot resolve that provenance.

## Safe original probes, selectors and candidate acceptance

Root retains both browser leases. New probes should use one freshly owned draft
with reserved addresses, or an already approved synthetic mail thread. Capture
DOM/AX end states and identity metadata, with screenshots only where useful.
Never publish private contact names, addresses, profile links or mail subjects.

| Candidate | Safe controlled action and assertion |
| --- | --- |
| CTX-01 | Empty owned composer → type reserved address → Enter. Compare pane before typing, while pending and after commit. Establish exact name/email fallback and whether domain link appears. |
| CTX-02 | First select a synthetic valid address; commit a name-only invalid value, then separately an invalid address containing `@`. Distinguish retention from raw-address fallback. Select the name-only invalid chip to test the declared author fallback. |
| CTX-03 | Two owned chips → select/arrows → remove via selected Delete, then repeat with empty-input Backspace. Measure distinct retain/previous/author outcomes and pane after all recipients are empty. |
| CTX-04 | Existing suggestion query → arrow through rows without accepting a real contact or clicking its exclusion X. Confirm highlight/pane correspondence; change query and measure whether initial new highlight alone updates the pane. Keep all identities private. |
| CTX-05 | Approved synthetic conversation with incoming and self-authored messages → focus each message, then hover synthetic participant names. Measure sender/nonself-recipient fallback, retention on pointer leave and message-navigation behavior. |
| CTX-06 | Name/Mail search or recent-mail row from an owned synthetic context. Record contact-preservation behavior and resulting account-scoped query/thread; return to the tracked draft/thread for cleanup. |
| CTX-07 | Open settings/Calendar/AI UI and return without changing settings. Observe precedence and whether prior contact is retained or recomputed. |
| CTX-08 | Rapidly select two controlled contacts; optionally switch to another explicitly authorized account. Check that late profile data cannot replace the selected contact or expose previous-account mail. No profile provider mutation is needed. |
| CTX-09 | Close and clean only the owned draft, then assert the original Inbox/view is restored. Distinguish Inbox Zero from a list with an actively selected conversation. |

Selectors are static candidates unless already present in the retained synthetic
DOM. Scope each to the visible right pane and verify uniqueness against fresh AX:

- `.ContactPane`, `.ContactPane-name`, `.ContactPane-email`,
  `.ContactPane-contact-details` — observed fallback structure.
- `.ContactPane-mailSection .ContactPane-data` and `.ContactPane-data-title` —
  observed in retained suggestion-navigation snapshots; never log real titles.
- `.ContactPane-header-container`, `.ContactPane-image`, `.ContactPane-location`,
  `.ContactPane-bio`, `.ContactPane-ellipsis` — declared optional profile structure.
- `#ContactPane-aliases`, `.ContactPane-aliases-toggle` — declared alias controls.
- `.ContactPane-network-container a`, `.ContactPane-sectionHeader` — inspect
  targets and labels before deciding whether a click is safe.
- `.ContactName`, `.ContactSelectorItem.isSelected`, recipient region/chip
  selectors from `recipients.md` — trigger candidates; names do not prove ARIA roles.

Do not click email/compose, copy, external links, Edit Profile, integration sign-in,
CRM edit/create, Refer/Add/Join Team or dismissal controls during basic probes.
Some dismissals persist preferences. Optional compose/copy coverage requires its
own explicit synthetic fixture and cleanup/clipboard plan. Do not use fabricated
profile data to fill missing original sections.

## Narrow reconstruction design — not an original implementation claim

Start with a local text-only contact pane: selected contact label/email and up to
four account-scoped imported-mail summaries, excluding the open thread. Use
already imported names and addresses; display an honest empty/loading/error state
rather than inventing biography, employer, avatar, aliases, team status or links.
External enrichment and CRM remain separate integrations.

A small contact-context controller should own account, contact, trigger source,
current thread/message, retention intent and request generation. Recipient commit,
chip selection and explicit suggestion navigation can emit intents without
mutating draft text. Do not emit a new contact merely because a replacement query
has selected index zero: retained runtime shows the old pane can remain. Keep
invalid name-only versus nonempty raw-email behavior separate. Preserve the last
contact on selected-chip deletion unless a measured fallback applies.

Use immediate known contact data, then a bounded local metadata read. Cache by
account and contact identity; abort/reject stale completions after contact,
account, thread or mode changes. The original's email comparison alone is not a
sufficient reconstruction account-isolation guarantee. Do not restore full-message
bootstrap downloads or fetch bodies to populate a four-row list.

Initially support explicit recipient context and focused opened-message context.
Keep the richer unread/label/thread representative heuristic as a separately
tested extension. Contact-preserving search/recent-mail navigation should retain
selection intentionally. Other right-pane modes can cover the pane without
asynchronous profile results reopening it or disturbing the existing AI guards.
A dedicated account-scoped local contact-summary response is a reasonable next
API boundary; any new service, scopes, account mutation or enrichment source is
outside this phase.


## New controlled removal comparison

A passive, nonnavigating preflight found the existing target at Inbox with loaded
mail controls and no Subject textbox:
`ev_27ea487fb3119f5e6148e3232d853fa0736b279d15fe02ae88fdf8a9f80c3e18`.
This capture is policy/attach-limited; attributes were inventory names only and
no script source, storage keys or network bodies were requested.

`ev_e6b8f71895fec0db33d80b0f000a9652456ac622a417e4d7cbf172526ab021ee`
then completed 28 synthetic-draft actions, including recipient/subject/body
cleanup and Inbox restoration. With reserved contacts A and B:

- Pending B text retained A; committing B displayed B.
- Empty-input Backspace removed B and displayed A. Removing final A by the same
  route displayed an approved account contact, consistent with the static author
  fallback; the exact account identity remains private.
- After re-adding A, committing a name-only invalid chip retained A. Selecting
  that invalid chip displayed the account contact.
- Deleting the selected invalid chip while A remained selected the neighbor and
  displayed A. Thus selected-chip deletion is not universal retention when a
  remaining neighbor is selected.
- Deleting selected final A left zero chips and retained A through subject/body
  cleanup. Closing the owned draft hid the contact pane.

The new returned capture has complete requested actions/artifacts but missing
events and `equality_eligible=false`. Private capture:
`contact-context/original-backspace.json`. No send, existing-draft edit, account
setting or profile mutation was performed. Pointer X-removal and richer group
selection cases remain unmeasured.


## New controlled navigation comparisons

A newly owned draft addressed only to the approved counterpart displayed four
recent rows. `ev_22ed7331cba84c920293edfde752f78151b25e5589ca4907eae1310843cc4336`
completed the first seven of eight planned actions, then a nonunique four-row
wait locator failed strict matching. This was a probe-selector failure, not an
absence of mail. The exact draft identity was retained privately.

The corrected continuation,
`ev_e0fc11806ebd761fa23e09fbc6d608304eea718c2c75fd2bb63862b59bde55cf`,
completed 21 actions, including cleanup and Inbox restoration. Name and Mail
heading clicks both produced the plain contact email with **one trailing space**
in `textarea.SearchBar-input.Editable` and the search route. This is not a
from/To/Cc query expression. The contact remained during draft-origin search and
recent-thread navigation. An initial continuation request used an unsupported
`goto.url` shape and was rejected before browser execution with no Evidence ID;
the corrected `destination`/`wait_until` input is retained alongside it.

Escape was then measured in separate controlled contexts:

| Origin | Evidence and result |
| --- | --- |
| Owned draft, first visible search frame | `ev_4646192d3f5845089e6516dad8242e21441f211f5eeb938a4a20154af1760851`: 11 actions completed. Composer/Subject and contact remained; Escape returned to the exact owned draft. |
| Owned draft, settled repeat | `ev_8cc84023413f606b2d1bb9e3ce090426f0638fd0de614359ce0b0af680669b41`: all 12 actions completed, including a 1.2-second search wait. Screenshot still visibly showed the New Message header/composer and contact. Search state/textarea existed underneath; Escape removed search and returned to the same draft. Hidden input/layering mechanics are not fully explained. |
| Opened controlled test conversation | `ev_f5ed0b4921a03c9f5eeb5d792b18f48b99dac27634d4498a469f585cb3368cdd`: all eight actions completed. After 1.2 seconds, full search results and Tips were visible, with no contact pane. Escape restored the same prior read conversation and its contact. Inbox was restored afterward. |
| Recent conversation opened from an owned draft | `ev_60ede91570159ebde2bd42f0895e3f228cfa618aff72b67fe31c56f44c006bfd`: all 12 actions completed. Recent-row navigation unmounted the composer and retained contact; Escape returned to Inbox and hid contact, not to the prior draft. |

Each independently created draft was then cleared through its exact retained
URL (only its recipients, subject and body), with nine-action cleanup records:

- `ev_f2b2931118f4a4b2c57ef022793011b9f9f7fe3ef8607a79e5fe019f079c2b76`
- `ev_739cd16172508f4e71865a4c653b375ca187aca6f6c27dda671e860234a3ea8c`
- `ev_ede70c3e6e1ce16fe703f241b6f81af10c1c5edef91a3b3b583101614cb55e61`

All returned navigation/cleanup captures have missing event coverage and are
equality-ineligible; the first selector-failed capture also lacks its failed
action section. No mail was sent, and no existing user draft was edited. The
read conversation was an already approved synthetic integration fixture. Private
captures/screenshots are under `evidence/private/contact-context/`. Actual end
screenshots are 3024×1724 pixels; attached CSS viewport/DPR were not independently
measured. The earlier passive preflight still inventoried the same main build
`db8c4288f33febf25ad9.page.js`.

## Bounded contact-pane style findings

Retained original stylesheet SHA-256
`487dc45e96a4d54d4069a9552f28f97883ba07f7962b83788e7b5d8d80e2e396`,
recorded build above, line 746 declares: recent-row timestamps hidden normally
and right-floated/shown on row hover; title overflow hidden with nowrap/ellipsis;
rows 13px/16px with 8px vertical margins; section bottom padding 20px; Mail header
13px bold/16px with 8px bottom margin; name 17px/24px normal with 32px/2rem/24px
padding; email 13px bold/16px. These are static declarations, not computed layout
or a runtime hover timing measurement. A pinned `inspect-artifact` attempt on
that CSS was unsupported and returned no Evidence ID; no successful result is
invented from it. Root's steady screenshots/retained DOM are consistent with
hidden timestamps containing relative hours/weeks/months rather than an always
visible Today/Yesterday label. Keyboard-focus timestamp visibility in the replica
is a deliberate accessibility choice.

## Replica focused failures and bounded corrections

The first focused demo run, `20261028T061452Z`,
`ev_f28dba72a9406c987f2e649528130a967f1589364bacfc95ec07854ef060d9fe`,
completed 15 steps, failed `backspace-final-a`, then cancelled 62. Empty append
Backspace removed B but selected A and removed the input; a second Backspace
could not address the combobox. This was an implementation fidelity defect
against the controlled original `ev_e6b8f71895fec0db33d80b0f000a9652456ac622a417e4d7cbf172526ab021ee`,
not a reason to change to selected-region deletion, whose final contact-retention
semantics differ. The corrected component keeps the empty append input focused,
publishes previous contact then author, and preserves distinct selected deletion.
An independent actual-React regression fails against the former handler and
passes against the correction, including two Undo/two Redo actions; 34 related
offline recipient tests passed. These tests use synthetic data and no provider.

The second run, `20261028T062318Z`,
`ev_7539e6e16e85f4c4d272c8c4019100c076858db478fdfbe9179dd245deecb460`,
completed 73 steps before `reopen-owned-draft` failed and four were cancelled.
Draft/search/editor/contact transitions passed to that point, and the persisted
owned draft assertion passed. The Drafts DOM omitted the current owned draft
while the final persisted snapshot included its exact subject/body/recipients.
The old bootstrap cache had not incorporated the acknowledged draft before
recent-thread navigation cleared the composer. This is a second product bug,
not a selector/fixture error; the saved draft was not lost. A fix and passing
recapture must be recorded separately.

Both failed runs had stable manifests, no captured page errors and owned-browser
termination. Both remain incomplete/equality-ineligible, with missing
accessibility/action/DOM/screenshot/URL sections and no truncated sections.
App SHA-256 was
`a3f8c6f6eb8a77064bed2146632b7b895c346ae1dafa8eb6401945373cee9a78`;
RecipientFields changed from
`9082cd53967670281308447df47b81aa7e42e8fb74f087ac70f96a71f96de6fd`
to corrected
`3c5b92c810a58c59243c4e4be6719400bbecdc29c722dbfef47136137676a40c`.
See the [failed-run record](scenarios/README.md#contact-context-focused-failures-2026-10-28).
Neither run establishes complete contact-context parity or changes the previous
full-browser checkpoint.

The third focused demo run, `20261028T064120Z`,
`ev_488896026ae3dcc59e3eacfd8a85d4831108714d9af5aaf71d871489dc28e3b9`,
completed 56 steps, failed `recent-thread-navigation`, then cancelled 21 of 78.
Its preceding DOM retained the composer/recent rows with Saving…; its failed
step ended at Inbox. Immediate Escape after the second contact-search click had
no explicit search-entry wait. A controlled held-PATCH actual-App reproduction
proved the old handler could close the draft before search registered a return
target; absent retained events, that explanation of the capture remains an
inference rather than a complete event trace. The local handler now registers
the return target synchronously. Original evidence measures settled search
return, not this instantaneous pending-save edge case.

The scenario additionally waits for real contact-search state after both name
and Mail clicks (scenario SHA-256
`0cb82a6a664683d78855be1fce574e7b414afc1f0c80a03021bc90cef19cf585`).
The failed run had zero captured page errors, stable App
`d291c9af4cf55ee6eca1dd90ebd0c2b86e4dfe0ec76a63bea00c759bf61978de`,
owned-browser termination, incomplete/equality-ineligible capture, missing
accessibility/action/DOM/screenshot/URL sections and no truncated sections.
It remains failed. Corrected App
`43246ef97d71e3bccc3d445bf11b85ddc7fc65e30a6df3042264cad21c5d3975`
passed 175 offline web tests plus build/strict types; this does not establish a
passing browser checkpoint or full original parity.

## Frozen bounded contact checkpoint

The corrected focused run `20261028T065146Z`,
`ev_7000515880a9edfeae9b9ad93d9ee9e0e822ae175f8327e395acc860d1cc2313`,
passed 80/80 steps and its saved-draft assertion, with stable sources, zero page
errors and owned-browser termination. Its overall capture remains incomplete and
equality-ineligible because the initial `scenario_start` lacks DOM; all action
DOM/accessibility sections were captured. This narrow missing section is retained.

The subsequent frozen full run `20261028T065257Z` passed 16 cases/380 steps and
all eight persisted assertions. Its contact case,
`ev_89a73bc19401b200243fd2e81163bbb99a678a5159f1a16e34be8507d601a670`,
passed 80/80 with complete requested sections, no page errors and owned-browser
termination. App SHA-256 was
`43246ef97d71e3bccc3d445bf11b85ddc7fc65e30a6df3042264cad21c5d3975`;
all 74 source/configuration/scenario/fixture manifest entries stayed unchanged.

The browser case covers recipient commit/typing/removal contact intents,
previous/author Backspace, invalid selection/neighbor retention, explicit local
suggestion selection, exact draft editor preservation and Undo across contact
search, recent conversation navigation, read-thread search return, current-thread
exclusion and reopening the saved latest draft. These are synthetic local demo
assertions. Bounded original intent/settled-return evidence is recorded above;
the instantaneous pending-save Escape guard remains a local choice. Enrichment,
aliases, external contacts, copy/compose links, broader message heuristics and
complete visual/behavior parity remain open. No feature family is marked fully
verified from this run. Later source changes require a new checkpoint.
