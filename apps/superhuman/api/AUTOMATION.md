# Manual automation configuration

This implementation extends the recovery456 baseline with persisted
Auto Archive/Auto Label configuration and an explicit synthetic preview/apply
path. It has no Google mutation adapter, model classifier, startup classifier,
automatic backfill, automatic apply, or account-wide activation. Opening a panel
or saving configuration never classifies mail. A production start without an
explicit trusted `automationFixture` option exposes configuration only.

Original evidence is recorded in
`apps/superhuman/research/automation-settings.md`: web build
db8c4288f33febf25ad9, retained main-script SHA-256
c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94,
pinned REA6.8.0/skill49. The final empty-form probe
`ev_823b12bd8f0e2617dd61263c80f0a0a440e467b81dd338ec522a813f09dfc38a`
completed28 declared actions, with incomplete event coverage and
`equality_eligible:false`. It established form structure and connector changes;
no original rule was created, saved, classified or applied. Original paid-model
quality, filled validation, matching, precedence, activation and existing-mail
backfill remain unknown. The original account's checked Marketing/Social rows
are account values, not new-account defaults.

The applied 480/429 checkpoint, full regression and real-mail data audit are in
[the comparison record](../research/automation-runtime.md). Actual automatic
classification and Google label/archive effects remain unimplemented.

## Types and configuration

The browser-safe contract is `src/automation-types.ts`. An account settings
response contains `settings`, definition `labels`, `availableLabels` (up to200
account-owned mailbox-label metadata rows), `labelOptionsLimited`, sixteen
informational `templates`, `capabilities` and `limitations`. It never loads all
message bodies to render settings. `providerEffects` and `automaticProcessing`
are always false. Real Google accounts have preview/apply unavailable.

Configuration has the native-shaped structure:

```ts
{
  labels: Array<{
    id: string; name: string; prompt: string;
    groups: Array<{
      operator: 'or' | 'and' | 'exclude';
      queryOperator: 'or' | 'and';
      items: Array<{type: 'from' | 'to' | 'subject' | 'label'; value: string}>;
    }>;
  }>;
  archive: {labelIds: string[]; always: string[]; never: string[]};
}
```

The initial local configuration has no definitions or archive selectors. Four
reserved builtin IDs (`builtin-marketing`, `builtin-news`, `builtin-pitch`,
`builtin-social`) have fixed names, empty prompt and no invented criteria.
Selecting a builtin for archive explicitly stages its definition before Save.
The other library entries have `criteriaPreset:'unmeasured'`; displaying them
does not enable a rule or manufacture its prompt. New custom identities are
stable client-generated IDs; browser creation uses UUIDs, and the server accepts
safe alphanumeric/underscore/hyphen identifiers up to128 characters.

Save trims names/Subject values, preserves prompt bytes and all definition/group/
item ordering, canonicalizes email/domain selectors, and sorts/deduplicates
archive arrays. Names are case-insensitively unique; builtin names are reserved.
Label criteria retain opaque account-owned IDs. From/To currently accept a bare
email or dotted DNS domain, with per-label IDNA and literal numeric-domain
preservation; display-name/contact resolution is unavailable. Controls, malformed
addresses and partial fragments fail validation. Builtins cannot contain custom
criteria. A custom definition needs a nonblank prompt or a nonempty group.

Local resource budgets (not recovered original limits):100 definitions,
8 groups/definition,20 items/group,100 selectors per Always/Never list,
2048-byte names,2000-byte Subject values,1000 UTF-16 prompt units and64KiB
normalized configuration. Invalid populated rows are rejected; empty staging
placeholders belong to the browser editor. The configuration route has a256KiB
JSON budget so valid escaped text fits the normalized limit.

On an explicit changed **demo** Save, mailbox labels are created/renamed locally
with stable account/definition-derived IDs. A stored managed hash prevents Save
from replacing a manually edited/deleted label. A no-op Save performs no repair.
Removing a definition leaves existing mailbox labels/tags intact. Google Save
only persists local configuration and creates no provider/local mailbox labels.

## HTTP contract

All routes require a single explicit account scope, reject unknown request fields,
and return the existing `{error:{code,message}}` envelope. Path values must be
encoded. IDs/keys use `[A-Za-z0-9_-]{1,128}` except account IDs (up to1024 bytes).

| Method | Path/input | Result |
| --- | --- | --- |
| GET | `/api/automation/settings?accountId=...` | Settings response. A default read creates no settings row. |
| PATCH | Same path; `{expectedRevision,configuration}` | Canonical settings response; no-op retains revision, changed config increments by1. |
| POST | `/api/automation/previews`; `{accountId,clientRequestId,expectedSettingsRevision,threadIds}` | `202` new/`200` replay `{preview}`. At most20 explicit distinct IDs. |
| GET | `/api/automation/previews/:id?accountId=...` | `{preview}`. |
| GET | `/api/automation/previews/by-request/:key?accountId=...` | Original `{preview}`; no classification retry. |
| POST | `/api/automation/previews/:id/apply`; `{accountId,clientRequestId,expectedPreviewHash}` | `{application,receipt}`; explicit local-only transaction. |
| GET | `/api/automation/applications/by-request/:key?accountId=...` | Historical `{application,receipt}`; no reapply. |

A preview persists `prepared → classifying → completed|failed|interrupted`, a
monotonic revision, configuration identity, selected thread hashes, fixture
provenance and proposed deltas with mailbox-label hashes. It contains no extra
full-body snapshot. Thread bodies are read only after SQL account scope and demo/
non-provider checks (64KiB/thread,256KiB/selection). Failed/interrupted work needs
an explicit new preview; key replay never redispatches. Another live owner cannot
steal a preview. Shutdown fences late callbacks and interrupts owned work; restart
only marks proven dead-owner work interrupted, without automatic classification.

Apply rechecks the completed preview hash, exact settings revision/hash, selected
thread hashes and label identities inside one transaction. It preserves unrelated
state, adds only own labels and removes Inbox membership for proposed archive.
Writes pass through Store, so list/contact/search projections roll back with the
thread, application and receipt if any statement fails. A changed input makes the
whole batch stale before any effect. One application is unique per preview;
different action keys can point to it but never replay its effects over later
manual edits. Preview/apply keys share a namespace within the account, so key
reuse with a different intent conflicts. By-key recovery verifies local effect
scope and `providerEffects:false`, including after restart.

Principal errors:400 `automation_invalid_request`;404 `automation_not_found`;
409 `automation_revision_conflict`, `automation_request_conflict`,
`automation_preview_stale`, `automation_demo_only`, `automation_label_conflict`,
`automation_label_unavailable`;413 `automation_preview_limit`;503
`automation_classifier_unavailable`/`automation_stopping`;500
`automation_settings_corrupt`/`automation_artifact_corrupt`. Low-level malformed/
oversized JSON can return the existing `request_failed` before acceptance.
Unknown transport outcomes must recover by the exact durable key; do not invent
a new key or automatically repeat a write.

## Controlled fixture policy and runnable isolated seed

`createAutomationFixtureClassifier` consumes immutable explicit synthetic
annotations and exact registered thread hashes. Builtin/prompt outcomes absent
from those annotations remain unknown; there is no fake paid classifier. The
local deterministic policy matches sender email/domain, last-message To, Subject
substring and existing committed label membership. `queryOperator` combines items;
group `operator` folds separate groups/prompt and exclusions. Label criteria see
the input snapshot, not other proposed labels in the same batch.

The local archive policy is Never, then Always, then controlled correspondence
history exemption, then custom-label exemption/unknown, then selected categories.
A previously emailed synthetic address also exempts its domain/subdomains. Missing
history or protective custom-label evidence prevents category archive. These are
explicit local choices awaiting original behavior comparison, not recovered
vendor semantics or a claim about a complete mailbox/address book.

The test-only `test/automation-fixture-data.ts` exports
`automationDemoFixture()` with a fixed-date demo account, four fictional threads,
mail preferences, configuration and exact classifier annotations. Its explicit
`seed(Store)` refuses any populated records table and is never used by production
startup. For a parent-owned isolated browser harness:

```ts
const fixture = automationDemoFixture();
const app = createApp({
  databasePath: temporaryPath, env: {DATABASE_PATH: temporaryPath},
  seed: false, runJobs: false, automationFixture: fixture.classifier,
});
fixture.seed(app.store); // only empty synthetic Store
// Optional explicit fixture configuration save; opening alone stays inert.
app.automation.save(fixture.account.id, {
  expectedRevision: 0, configuration: fixture.configuration,
});
```

Account `automation-demo` has `automation-marketing`, `automation-cedar`,
`automation-both` and `automation-protected`. The configured fixture archives only
the first, labels Cedar matches, and keeps the latter two in Inbox via the custom
label/Never exemptions. After apply their changed hashes are not registered for
a fresh classification; old key recovery remains valid. Use a fresh isolated
fixture dataset for a different test lifecycle. No fixture can deliver mail.

This proves a bounded local mechanical path. Live automatic triage, real Gmail
label/archive effects, template activation, entitlement/consent behavior, full
matching/model quality and original classification comparison remain open.

## Private source checkpoint

The additive candidate passed480 API tests (456 baseline,15 owner automation,
9 independent automation), with strict all-source/all-test types. Independent
review found two persistent-artifact validation gaps: a truncated application
could acknowledge an empty thread set, and a preview key mapping could retarget
a different owned preview. Both REDs remain retained; shared validators now bind
exact preview identities/effect subsets and the original request key/fingerprint.
The prior owner471 archive remains unchanged. No original classification or
replica browser comparison has run at this API checkpoint, and no provider/model
call or live database was used.
