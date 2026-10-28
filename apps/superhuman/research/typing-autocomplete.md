# Typing Autocomplete: retained-source investigation

This record describes static declarations, not a verified typing-completion
implementation or a successful original acceptance test. Recipient-address
autocomplete, contact lookup, calendar/location completion and agent parameter
completion are separate features. The existing
[settings observation](auto-drafts-autocomplete.md) establishes only the inspected
account's enabled switch, not a new-account default or model readiness.

## Identity and evidence boundary

The retained original main script belongs to build
**db8c4288f33febf25ad9**, SHA-256
`c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`.
Pinned REA **6.8.0**, skill49, analyzed exact inert slices. Private inventories
retain source UTF-16 ranges, original-slice hashes, wrapper hashes and exclusion
notes. Vendor fragments and fetched scripts remain ignored private evidence.

| Scope | REA parent evidence | Bound |
| --- | --- | --- |
| Controller, worker wrapper, context and outgoing-cleanup helpers | `ev_da0f1c4cc7448a36410f0cd733181ce77bceada47297a86096d1a62dd880d7c2` | 18 files; 34,101 bytes; zero parse failures. Tree digest `6226c4c4e40f8dd6d6ab13742da7e1e7cdd9170e0dc72ece80ea90c071df1fbd`. |
| Exact embedded package-version property | `ev_962128598d87c38485956bc5cac8aa024de84f080748c43b44e3474083ffb7f6` | One inert 78-byte wrapper; zero parse failures. The earlier empty extraction remains a failed selection, not package evidence. |
| Three observed worker scripts | `ev_01ee87a4c1544c6e50c5c202acbdc061803a27581cade9ef7396aff50a3e0664` | Three files; 148,558 bytes; zero parse failures. Tree digest `abac3b66e3291af8e01000f0a367cd12d4e0c02268ace944c625dadc47c57ed4`. |

Useful original main-script starts are `AutoCompletion` at **632:12199**,
`TypingAssistantWorkerWrapper` at **1000:3373**, its asynchronous dispatcher at
**1000:1937**, and the worker factory at **645:107942**. These are one-based
line/UTF-16-column locations in the retained minified source, not product files.
Outgoing-message preparation starts at **394:33681**, its annotation cleaner at
**394:7339**, and before/after-cursor helpers at **394:13300/13514**.

The graph remains partial, with dynamic and external relationships unresolved.
Inert parsing did not invoke bundle bootstrap code, workers or SDK methods. No
completion service, model asset, WASM binary or imported inference library was
downloaded or executed by this investigation.

## Static eligibility, triggers and context

Initialization waits for feature flags and the typing SDK's initialization path.
It can exit when assistance is disabled or the native support condition fails.
The selected controller requires the account's Autocomplete setting, a collapsed
selection, and no competing compose-assistant suggestion. Worker prediction is
declared for English and depends on enabled/detected language. An internal
fallback value is not evidence of an account default. The helper named as a
test-settled check returns a constant and does not establish worker readiness.

Ordinary single-character keys or Backspace, without Ctrl/Alt/Meta, can request a
completion. Space/Enter also participate in language detection. Navigation and
selection changes clear or recompute predictions. The normal request path checks
that the cursor is at the paragraph end, rejects a signoff-like suffix and uses
text before and after the cursor. Those text helpers normalize nonbreaking spaces
and remove a zero-width marker. The selected caller has no explicit byte limit;
this does not establish the SDK's internal context or model limits. IME, mobile
and multi-code-unit input behavior remain unmeasured.

Local greeting and contact-name candidates precede worker prediction. The greeting
path requires a single-line prefix and one or two resolved To contacts with usable
first names; email-only contact names fail that path. Thus a recipient-free draft
does not supply greeting candidates, even though another local name path may use
the account contact. Greeting candidates depend on enabled language and a strict
prefix match. The separate name path uses resolved From/To/Cc/Bcc names and a
capitalized partial token. These declarations do not prove a particular contact
was resolved in a browser probe.

Requests carry an identity checked again after asynchronous completion. Matching
subsequent typing/Backspace can reuse a remaining prediction. The worker result's
first candidate is filtered, including trailing whitespace removal; an empty
filtered result is ignored. A visible element wait alone cannot establish a
stable, nonblank prediction or the exact candidate active when acceptance runs.

## Static ghost, acceptance and serialization

The controller inserts a noneditable `sh-autocomplete-prediction` span and assigns
its suggestion through text content. Placement checks the active request and
prefix/caret. Declared style is muted inline text, with theme and display-density
branches; effective pixels have not been compared here.

ArrowRight calls the acceptance path. Tab is installed through Squire's existing
Tab handler and falls back when no prediction is accepted. Acceptance requires an
active prediction, a matching ghost text and the same prefix used for the
request. On a match it records an undo boundary, replaces the annotation with a
real text node, moves the caret and emits input. A mismatch can clear/requery
instead. Escape removes a present prediction and contains that key; cursor/click
changes clear it. Undo/Redo listeners request a new prediction. These are static
declarations; accepted text, key timing and actual undo restoration still need a
controlled original comparison.

The one-line text walker rejects prediction annotations. Outgoing-message
preparation calls an annotation cleaner that removes them. That proves a
specific declared cleanup path, not universal exclusion from every autosave,
local draft record or provider draft. Saved-body comparisons must separately show
that an unaccepted ghost is absent and an accepted completion persists.

## SDK and worker provenance

The embedded package-version map at **586:852193** declares
`@typewise/autocorrect-predictions-sdk` version **2.3.3**. A separate version helper
reads that dependency entry, and the factory is explicitly named for Typewise.
Independently, [Typewise's official SDK page](https://www.typewise.app/typewise-ai-sdk)
names Superhuman as a customer. These support an attribution to the shipped SDK;
they do not establish licensing rights, active model version, quality or the
vendor's current service requirements.

Passive original evidence
`ev_5410f5d0971c316a8358f0fcf0e9ac29b0778cb4228bc2403c201c82cc1829fa`
identified registered worker targets. Worker execution/coverage attachment was
limited. Three exact observed same-origin JS URLs were then fetched without
cookies or credentials, with redirects disabled and bounded responses:

| Worker basename | SHA-256 |
| --- | --- |
| `db8c4288f33febf25ad9.app_web_workers_autocorrect_tsx.js` | `489e7ac59da96e2638756b2fd1f953204a4f36bc946b6a1498e74bedfc04eb4a` |
| `tf-js-web-worker-predictions.js` | `7c456fdaf784bb346049addaa26ad00e668f15fe6c844c9b525a8050fe8a737b` |
| `tf-js-web-worker-autocorrection.js` | `0a3ccc146d48f61aca3fc47463440a76cf23a6b48605fab612739a3d9df7666e` |

The declared route is the main controller → typing worker wrapper → correlated
worker message → **GET_WORD_PREDICTION**. It is not a recovered
GET_TEXT_COMPLETION protocol. Initialization constructs the SDK's AI library and
prediction object using a same-origin versioned resource path. The worker calls
the SDK prediction method with before/after text, language, capitalization and
prediction settings. Contact-name dictionary/cache support is also declared;
these snippets do not prove which contacts reached a worker or a remote service.

Despite the prediction worker's filename, its TensorFlow code is commented. The
active declarations import an **ONNX 1.18.0** runtime script, configure WASM paths,
load an inference session and run tensors. The readable prediction script retains
these operations at lines **33–50, 61–85 and 124–151**. This supports a declared
worker inference path, not observed model loading or execution. No direct remote
completion endpoint was found in the selected caller/wrapper path. Resource
imports and inference-session loading can still perform network reads; neither
an offline guarantee nor absence of remote processing follows from this bounded
static search.

## Remaining comparison and implementation requirements

The original typing probes and cleanup are recorded separately by the runtime
operator. No acceptance, model readiness, timing, saved-body or full-parity claim
is made here. Concrete follow-up must:

1. Establish a nonblank, current ghost and compare Tab/ArrowRight acceptance,
   Escape/navigation dismissal, accepted-text Undo/Redo and exact persisted body.
2. Compare local greeting/contact completion separately from worker-generated
   continuation; retain disabled, unsupported-language and initialization-failure
   outcomes without attributing them to a vendor or permission gap prematurely.
3. Fence account, draft, cursor, selection and authored-revision changes. Bound
   context explicitly in the reconstruction and keep unaccepted annotation text
   out of every save/send serialization path.
4. Make a separate implementation/access decision for the prediction engine.
   Shipped SDK strings and assets are evidence, not permission to redistribute
   vendor code, models or licensed assets. Current SDK access requirements remain
   open and do not block the offline provider-draft review.

## Bounded runtime follow-up and cleanup

The parent used one newly owned fictional draft. No existing draft was targeted,
no message was sent and no account preference was toggled. These observations
remain separate from the static controller/worker analysis.

| Stage | Evidence | Retained outcome |
| --- | --- | --- |
| New recipient-free prefix | `ev_e9c02bc872573c089e03eb3dfe94a7602f3ccde215aedeea789459c9e84037a2` | Eight states completed, including initial capture. A fill, one printable key and 1.8-second observation did not establish a stable visible suggestion. |
| Individual key events | `ev_3caa4c36b0acc3e56374e16a71c58b34bc07e50a16fe433be73605b7cb5b41c3` | All 49 states completed. A generic scoped prediction-element visibility wait passed, but retained screenshot/AX did not establish nonblank suggestion text or acceptance. |
| Source-driven greeting | `ev_b1b934c3a74642d27aa503162e5aefb37517391293b108ef2ac459c3f7110929` | Thirteen states completed before the nonblank recipient-name prediction guard timed out. Right Arrow and the later wait were not executed. One approved counterpart was present, and only the fictional greeting was authored. |
| Initial cleanup guard | `ev_c977772d60937ba169c9417e534bb4800b5bcefc7656d40079335914745e87b2` | Two states completed; exact text on the rich-editor wrapper did not match its nested text child. Discard was not executed. |
| Owned cleanup continuation | `ev_6306e6a0b88178641ba043c1ac5871608823c708f5c4b1e0e2fb77f4d9966359` | All six states completed. Exact owned subject, greeting text child and counterpart preceded Discard; Inbox was restored. |

Separate scoped Gmail searches/batch reads found one DRAFT with the typed
fictional prefix, then the short greeting and sole approved counterpart. After
cleanup the same exact-subject Drafts search returned zero matches. These reads
do not prove permanent deletion or behavior of any other draft. Neither Right
Arrow nor Tab acceptance was exercised successfully. The failed captures remain
failed, and general model readiness, completion quality and timing remain open.

The retained light-DOM export omitted the shadow editor body even while AX
contained authored text. A zero-result DOM query therefore cannot prove that no
suggestion existed. A generic visible-element predicate likewise cannot prove
that an accepted, nonblank prediction was present. All successful captures have
missing event coverage and equality ineligibility, with disconnect-only cleanup
of the externally owned browser.

A separate passive inspection,
`ev_5410f5d0971c316a8358f0fcf0e9ac29b0778cb4228bc2403c201c82cc1829fa`,
reported registered autocorrection/prediction worker targets. Coverage was
attach-limited, policy-filtered and worker detail unavailable; registration does
not prove that model initialization or inference completed.

## External SDK access

[Typewise's SDK page](https://www.typewise.app/typewise-ai-sdk) independently
identifies Superhuman as an SDK customer and offers predictions/autocorrect
integration. This is vendor documentation, separate from the retained package
metadata and registered worker targets. Legitimate JavaScript SDK/package, model
and license access has been requested for the reconstruction. No extracted
vendor implementation or model assets are incorporated into product source;
model-equivalent typing behavior remains an access and comparison gap.

An unauthenticated public npm registry metadata GET for the observed SDK
version returned HTTP 404 on 2026-10-28. This is a bounded availability check; it
does not distinguish private-registry access from unpublished metadata or prove
license terms. No npm credentials were used.
