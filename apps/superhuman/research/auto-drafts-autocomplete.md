# Auto Drafts and Autocomplete: bounded original inspection

Recorded 2026-10-28 using pinned REA 6.8.0/skill49 against the then-selected
authenticated account. No account switch, toggle, checkbox, Save, activation,
draft edit, model submission, Send, upload or purchase was declared. The account's
current values below are not new-account defaults.

## Runtime evidence

The original target was the existing Chrome page at `https://mail.superhuman.com/`,
Chromium **156.0.8078.48**, build **db8c4288f33febf25ad9**. Passive preflight
`ev_72907f78e4a8d27e43e13bd7a922287db29e3de21304e6b1c2b364ca130bad89`
retained the main script's CDP digest
`c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`,
matching the [retained source inventory](source-inventory.md). Requested viewport
was 1440×900/DPR1, locale en-US and timezone America/Los_Angeles. Effective
original CSS geometry was not independently measured. Account material, captures,
screenshots and vendor fragments remain private.

| Declared observation | Evidence | Bounded result |
| --- | --- | --- |
| Inbox/no composer → Settings → Auto Drafts | `ev_d6a0d06afe9a73f7144b11e36b2f7ff10c2e546aba8a23ff8422eb44720c489d` | All 6 steps completed. The settings form opened directly; no upgrade dialog appeared on this path. |
| Settings → observe Autocomplete row without activation | `ev_b3e291f5cd7b6867732e8ce2777ad510c43f490bb3d8b4ee8ba866f51b799c13` | All 5 steps completed. Autocomplete is a direct checked switch in the Superhuman AI menu section. No separate form, help/example or paid dialog was opened. |
| Restore Inbox, no settings/dialog/composer | `ev_08dc94f51ec134cd0ce1aeaf9f8d95714c8f8324bb26461f6dc2b15962856ea2` | All 5 steps completed; the external browser remained open and disconnected. |

Auto Drafts displayed:

- **Follow-ups**, checked: a reply is described for a returning reminder that
  needs a follow-up.
- **Responses**, checked: a reply is described when a message needs a response,
  with a claim that its draft can be updated as facts change.
- **Only draft a reply to people I've emailed before**, unchecked.
- **Add teammate on Cc to handle scheduling**, unchecked, with no selected
  teammate, prompt or preview fields displayed.
- A **Personalization** link. No Save button or separate help/examples were
  displayed in this unchanged state.

The first Autocomplete wait failed in
`ev_814d62403fe967187680e4e7cbede420888a9497eba92f2fddc77bba7372da31`.
Retained DOM already contained the checked row. Its nested-text locator was
replaced with an observed `has-text` selector and a single-match read-only wait;
the failed capture remains failed. No toggle was clicked in either attempt.

All three successful scenarios have missing event coverage and
`equality_eligible:false`; page-error capture was requested, network mutation
coverage was not. Completed navigation does not establish zero settings requests:
the static unmount cleanup described below can have effects. No network-absence,
generation quality, timing, keyboard acceptance or backend-persistence claim is
made from these inspections.

## Focused static findings

REA parent `ev_86845d7614090b3e5b2449f09a44eb4d667acd51c905fc62ccee97bccc2df3a1`
analyzed five exact retained fragments: Auto Drafts access, modal entry, settings,
AI confirmation and Autocomplete toggle. All five parsed, with zero parse
failures. Call/data-flow dependencies outside these fragments remain unresolved;
this is not full application coverage or runtime execution. Private source ranges
and hashes retain their exact UTF-16 provenance. An unrelated tool-parameter
autocomplete hook was excluded rather than treated as typing assistance.

The shipped declarations indicate:

- Auto Drafts access depends on AI availability/activation, the reminders
  auto-drafts feature and a billing-SKU exclusion. The entry can show either a
  Business-upgrade action or an admin-contact message depending on tier-change
  permission. Activation has a separate AI confirmation/update path. These gates
  were not triggered on the inspected account, and their server enforcement is
  unknown.
- Follow-up and response controls write account settings directly. The
  emailed-before option requires Responses to be enabled. A universal staged
  Save for all three would diverge from these declarations. A nested setter's
  false fallback is not evidence of a new-account default.
- Teammate scheduling is a separate staged configuration. Enabling its local
  editor exposes a contact selection, a prompt capped at 1,000 units and a
  read-only generated preview. The prompt declares quoted wording and a teammate
  placeholder; Save and discard handling depend on that staged state. A feature
  flag selects this layout versus legacy meeting-request controls. These hidden
  fields, validation, preview and Save were not exercised.
- Unmount contains conditional cleanup writes for stale disabled teammate
  metadata. Thus even an unchanged close is not proof of no settings writes.
  No assertion establishes whether those conditions held in this account.
- The typing-assistance Autocomplete toggle writes one account preference
  immediately. That action alone does not establish the completion model,
  context, display, latency, acceptance keys or universal availability. It is
  separate from recipient-address autocomplete.

The first inert REA attempt could not compile its process-ownership helper under
the sandbox; its partial result remains incomplete. The successful host analysis
above used the same five inert fragments and no vendor execution.

## Concrete implementation and comparison requirements

1. Keep Auto Drafts and typing Autocomplete separate from manual Auto Labels/
   Archive configuration. Scope every preference, pending update and generation
   to one account; do not copy the inspected account's enabled values into
   defaults. Opening settings must not itself start a local generation job.
2. Separate direct preference updates from staged teammate scheduling. Preserve
   acknowledged values and report failures; an unknown acknowledgement requires
   a read of the same setting before another write. The staged editor needs
   explicit Save/discard, teammate validation and honest preview state.
3. Treat a trigger classification, generated local draft, provider-synced draft
   and eventual Send as separate events. Returning reminders and incoming-message
   versions need durable settings/input identities. A late generation must not
   overwrite a user-edited, sent, scheduled or discarded draft; no automatic Send
   follows generation. The observed product copy does not prove trigger quality
   or original update cadence.
4. Typing completions need a separately controlled fictional compose comparison
   before implementing claimed ghost-text style, trigger delay or acceptance/
   dismissal keys. Bound model context and reject late account/editor/revision
   results. Never confuse generated suggestion text with an accepted user edit.
5. Gate and unavailable states need explicit reconstruction policy. The present
   account was sufficient to inspect the form; there is no observed credential
   or entitlement blocker for that read-only task. Testing disabled-tier/admin
   branches requires a known eligible test context; inspecting hidden teammate
   fields or comparing automatic generation needs a separately scoped controlled
   setting/fixture experiment. No purchase, tier change, consent acceptance or
   trigger activation was attempted here.

Acceptance cases AD-01–AD-07 and AC-01–AC-04 are maintained in
[knowledge-settings-acceptance.md](knowledge-settings-acceptance.md). The 22-family
inventory remains incomplete; no Auto Drafts or typing Autocomplete parity is
marked verified from this form inspection.
