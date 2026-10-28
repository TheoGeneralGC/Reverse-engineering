# Auto Archive and Auto Labels: observed configuration surfaces

Recorded 2026-10-28. This is a bounded original-app investigation and a candidate
acceptance specification, not implementation verification or classification
parity. Read alongside [the earlier settings inventory](knowledge-settings-acceptance.md).
The original target was returned to Inbox with no composer or inspection dialog.

## Identity and coverage

The original browser was Chromium 156.0.8078.48, attached through pinned REA
6.8.0 with installed reverse-engineer-anything skill49. Native Superhuman version
1041.0.75 and web build `db8c4288f33febf25ad9` identify this investigation.
Retained main-script SHA-256 is
`c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`.
See [source inventory](source-inventory.md) for the broader source provenance.

Passive preflight `ev_cc6293de3f4ed5ed9c97dbfd83de7575486f1224d094adf3c21b94ebac4b9027`
established Inbox and no standalone mail composer before navigation. All form
fields below remained blank: no name, criterion, contact, label, or prompt value
was supplied. No Create Auto Label, settings Save, template activation, preview,
or upgrade/AI-consent confirmation was invoked. Local empty form rows were
cancelled; they are not persisted rules. Remote settings history was not audited.

Counts below exclude REA's initial `scenario_start` capture.

| Probe | Evidence | Declared actions / result |
| --- | --- | --- |
| Archive tabs | `ev_8080032feccf622b287c53f53ffe71c71340a55287deb2ec921e78a2027e51e8` | 14/14 completed; Inbox restored. |
| New-label assumption | `ev_0643ec8e37ea564cace621a9a85962c5dfbbfa1956505006724beffddb634f00` | 6 completed, 1 failed, 5 cancelled; New opens a library, so an assumed Cancel button was absent. |
| Build Your Own / Back | `ev_2bfbcadce7ada5242871b6b95140f830747cf37bd4dcbdf7a4bf89f774e3d205` | 16/16 completed; empty form and library cancelled, Inbox restored. |
| Starting-point selector failure | `ev_166bb36a8d29f3742727d52a6c18e5efb59a67d445e8e2b014b7bc7fb50c0521` | 9 completed, 1 failed, 32 cancelled; exact text was on a child span, not its containing row. |
| Five empty starting points | `ev_bd86f13e90a7657da834e08125da9c843cead2a63bdbc2bbfc06ddb8fdb4b022` | 42/42 completed with corrected leaf selectors; Inbox restored. |
| Include and Exclude groups | `ev_29a5c1395f7a7d10695d742a43e5e0229270e2e7337c41c5e7dfe34df9c094e4` | 21/21 completed; Inbox restored. |
| Operator/prompt pointer failure | `ev_c69eb5870d2d779d32519bc2a3e40c4ba357049bb2722f65e8679c326a369849` | 14 completed, 1 failed, 12 cancelled; the Or/And hover tooltip intercepted the next pointer action. |
| Operator/prompt keyboard follow-up | `ev_823b12bd8f0e2617dd61263c80f0a0a440e467b81dd338ec522a813f09dfc38a` | 28/28 completed after moving off the tooltip and activating the native AI Prompt button with plain Enter; all forms cancelled and Inbox restored. |

Captures retain DOM, accessibility, screenshots and URL after each action.
They report missing event coverage and `equality_eligible:false`; these limits
also apply to successful action sequences. Captured PNGs are 742×963 despite
requested 1440×900/DPR1; effective CSS viewport and DPR were not independently
measured. No pixel-equivalence claim follows. Raw captures, failures and selected
vendor excerpts remain under `evidence/private/automation-settings-20261028-01/`.

## Runtime: Auto Archive

`.AutoArchiveSettingsDialog` has Auto Labels, Always Archive and Never Archive
tabs. The first tab shows Marketing, News, Pitch and Social with native
checkboxes. In this existing personal account, Marketing and Social were checked
and News and Pitch were unchecked. These are observed account values, not
new-account defaults. Save remained natively disabled in every untouched tab.

Displayed copy says selected categories skip Inbox going forward and remain
discoverable through search, Auto Labels and Auto Archived. It describes two
exceptions: a sender/domain previously emailed by the user, or a custom Auto
Label applied that is not configured for Auto Archive. This is displayed product
behavior, not a tested precedence table or observed mailbox effect.

Always Archive and Never Archive each had zero existing rows and an empty picker
with placeholder `Enter name, email, or domain`. The copy describes future
conversations from selected senders always/never skipping Inbox; Never Archive
also warns that the email provider can still send messages to Spam. No picker
value, recipient, exception, or checkbox was changed. Matching aliases, domain
boundaries, precedence between lists, sent/unread/thread scope, and activation
timing remain unknown.

## Runtime: library and blank custom-label form

New Auto Label (`#new-auto-label-button`) first opens
`.AutoLabelTemplateLibraryDialog`. Its captured DOM contains this inventory:

| Category | Template | Displayed description |
| --- | --- | --- |
| General | Marketing | Marketing and promotional messages. |
| General | News | Newsletters and digests you can read later. |
| General | Pitch | Cold pitch and outreach messages. |
| General | Social | Social network and online community messages. |
| General | Respond | Messages that need you to respond. |
| General | Meeting | Messages about scheduling meetings. |
| General | Signature | Documents you need to sign. |
| General | Login | Password resets and one-time passcodes. |
| General | Comment | Tool notifications and comments related to you. |
| General | Recruiting | Messages about job openings and hiring. |
| Finance | Tax | Tax documents and tax deductible receipts. |
| Finance | Invoice | Invoices, bills, and payment notices. |
| Purchases | Order | Orders, receipts, and purchase confirmations. |
| Purchases | Shipping | Tracking information and delivery updates. |
| Travel | Travel | Tickets, reservations, and check-in information. |
| Legal | Contract | Contract terms, changes, or approvals. |

The first four had an in-use indicator in this account. The remaining templates
were not activated. The DOM inventory does not establish simultaneous visibility
of every card, entitlement, template criteria, or classification quality.

Build Your Own (`.TemplateLibrary-build-your-own-button`) opens the blank
`.CreateUpdateAutoLabelDialog`. A static navigation-handler check preceded that
click. The dialog has an empty Name input, a starting-point menu, Back and a
native enabled Create Auto Label submit button. There is no Cancel button in
this new-label mode. Back returns to the library; library Back returns to Auto
Labels; Escape closes the latter. No Create click or validation submission was
performed, so an enabled blank button does not establish acceptance of blanks.

| Starting point | Observed editor/control |
| --- | --- |
| From / To | Empty contact picker, `Enter name, email, or domain`; autocomplete/autocorrect/capitalization disabled. |
| Subject | One-row textarea, `Enter text in the subject`. |
| Label | Unopened dropdown, `Select a label`; available options were not inspected. |
| AI Prompt | Empty `#autolabel-prompt`, `name=prompt`, native `maxlength=1000`, placeholder `Enter a prompt for this Auto Label`. |

Name is `#autolabel-name`, placeholder `Enter a name`, with no native maxlength
attribute. No Name limit was established. AI Prompt help names sender,
recipients, subject and email contents; examples were not opened.

Choosing From, then adding Subject, displays Include followed by Or. Clicking
the native separator changes it to And. Adding an empty AI Prompt places that
prompt first with Include, followed by And From and And Subject. This establishes
the displayed connector, not AI/deterministic matching semantics.

Add exclusions opens a separate Exclude starting-point menu containing From,
To, Subject and Label, with no AI Prompt option. Choosing To opens an empty
Exclude To picker. Include and Exclude groups have independent add/remove
controls. No multiple-exclusion connector was exercised. Archive and Split Inbox
fields were absent from this new-label form at the captured viewport; later
edit-mode or settings actions were not inspected.

## Static declarations, kept separate from runtime

Inert REA analysis of the selected library/form declarations produced parent
`ev_8bcafffcfb6b2e1d279a465eb8353acf7a0dfc78d4e1471897d787b791bac77d`
and summary `ev_96fa10c8e2440542ebaa3088ea266bc65c1785efde7738864cb9ab1e6a8a1f37`.
The library is at original JS 878:177278 and the form at 881:70393 (one-based
line/column). Their private fragment hashes are respectively
`de59c6d2128412f71ef9d70011a0e2a395991147a0d29ed012d4f619176f6b6a`
and `932ea583d284cf3dd63efb7621fecc9368c7c203b6ee1ce8ffb532455850f2e9`.

Eight additional declaration fragments were parsed without executing vendor
code: parent `ev_e3751ff19d013b0e37ed7d0476c7f6571e98a5aab1f241e9769744e3b654890c`,
summary `ev_26cd1d4fa6b8b84b4b035403253c3ca6fa05b643358b10e7214dc597bb844026`.
All eight parsed, zero parse failures; application relationships remain partial
and semantic relationships contain unknowns. Exact UTF-16 ranges/hashes are in
the private `static-operators/identity.json`.

| Declaration | Original location | Static finding |
| --- | --- | --- |
| Creation permission helper | 878:196003 | Checks entitlement; unavailable paths show explicit upgrade/admin/AI-consent dialogs. No silent consent was inferred or accepted. |
| Separator button | 881:31331 | Group query operator is And/Or; changing the first group also updates its group operator. More than one From item forces Or and a noninteractive explanatory separator. The multiple-From case was not exercised. |
| Group component | 881:39972 | Adds empty prompt or deterministic items locally. Prompt is separate from the groups array; exclusion has no prompt-add action. |
| Prompt constant | 881:67359 | 1000; independently matched by native textarea maxlength. |
| Item schema | 881:67366 | Declares types from/to/subject/label and string values; Subject trimming, From/To email-or-domain validation candidates. Validation was not executed. |
| Group schema | 881:68154 | Separate `operator` (or/and/exclude), `queryOperator` (and/or), and `items`. |
| Group/context schema | 881:68399 | A context-dependent ten-custom-label limit when a nonempty prompt is present; this does not establish a universal deterministic-label cap. |
| Form schema | 881:68707 | Trimmed required name, case-insensitive trimmed uniqueness, trimmed prompt at most 1000, and at least a prompt or a nonempty item group. Empty-present prompt has a separate validation error. |

Build Your Own declares navigation to the new form. AI Prompt's native
`type=button` handler prevents the default and adds an empty prompt after a
permission check. The surrounding form handles modifier+Enter for submission;
the observed plain Enter field activation did not invoke Create. A declared
preview path is gated by entitlement and a minimum 980px viewport and returns
early for an empty prompt with no nonempty criteria; nonempty criteria can
schedule preview after 1000ms. No preview result or model request was inspected.
These guards informed the empty-only investigation boundary, not a claim about
the vendor backend or all browser sizes.

## Candidate reconstruction contract and acceptance

A local account-scoped revisioned configuration can preserve the declared shape:
separate optional prompt, ordered groups containing operator/queryOperator and
typed string items, category archive flags, and separate always/never sender
selectors. The local API envelope, validation limits beyond observed fields,
matching policy, replay ledger and classifier implementation are design choices.
Names entered into contact search should resolve to explicit email/domain
selectors before being treated as rules; the data source and ranking are unknown.
Do not invent a saved prompt/group precedence from the blank form alone.

- **AUTO-01:** Opening all tabs reads current account settings; unchanged Save is
  disabled. Closing untouched controls performs no settings write.
- **AUTO-02:** New opens the category library; Build Your Own opens the blank
  form; Back follows the observed library/settings path. Templates remain inert
  until an explicit activation action is implemented and tested.
- **AUTO-03:** Render the observed five starting points, native prompt limit,
  Include Or/And, and separate four-type Exclude menu. Empty field-add controls
  do not submit Create. Compare filled validation and multiple-From behavior
  separately before claiming those runtime details.
- **AUTO-04:** Explicit Save/Create uses an account-scoped expected revision;
  a conflict retains staged input. Delayed loads and acknowledgments cannot
  replace another account or newer staged edits. These are local safety rules,
  not recovered vendor protocol.
- **AUTO-05:** A bounded synthetic preview binds settings and source-thread
  hashes and distinguishes fixture classifications from model output. Explicit
  demo-only application is separately journalled and cannot mutate real Google
  mail. No startup activation or implicit backfill follows merely from opening
  settings or generating a preview.
- **AUTO-06:** Before a future real classification release, measure saved-rule
  persistence, exceptions, custom/built-in conflicts, thread versus message
  scope, category quality, backfill and new-mail triggers with controlled mail.
  Those effects and original matching precedence remain unverified here.

No feature is marked verified by this document. The present backend work may
implement durable settings and deterministic fixture mechanics independently;
those mechanics cannot establish learned classification or original behavior.
