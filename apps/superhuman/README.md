# Superhuman browser reconstruction

Objective: reproduce the observed Superhuman experience in a browser, including
appearance, interaction, keyboard behavior, and real email functionality backed
by persistent storage. The user selected real provider integration and permitted
inspection of any existing account on this Mac.

The setup phase does not establish full parity. The feature inventory is a
candidate checklist; discovery must expand it to cover the accessible product.

- [Current implementation checkpoint](research/status.md)
- [Applied tracking and keyboard checkpoint](research/tracking-keyboard-checkpoint-20261029.md)
- [Vercel collector preparation and limits](research/vercel-collector-checkpoint-20261029.md)
- [Team/CRM discovery and access limits](research/team-crm.md)
- [Setup and access](research/setup.md)
- [Investigation and delivery plan](research/plan.md)
- [Parity inventory](research/parity.csv)
- [Finding ledger](research/findings.md)
- [Local search grammar and limits](research/search.md)
- [Provider draft observations and acceptance](research/provider-drafts.md)
- [Provider draft lifecycle and rollout](research/provider-draft-live-check-20261028.md)
- [Controlled mapped Send and recipient difference](research/mapped-send-live-check-20261029.md)
- [Local custom Split Inbox checkpoint](research/split-inbox-local-check-20261029.md)
- [Paired custom Split case and applied footer correction](research/split-inbox-paired-checkpoint-20261029.md)
- [Combined delivery, Knowledge and personalization checkpoint](research/combined-checkpoint-20261028.md)
- [Knowledge receipt recovery checkpoint](research/knowledge-recovery-check-20261028.md)

Keep private source material in `evidence/private/` and `evidence/raw/` (ignored).
Store sanitized specifications and synthetic fixtures under version control.

Layout: `web/` contains the browser client, `api/` the persistent backend, and
`research/` the observed behavior, acceptance scenarios and comparisons.

## Applied tracking and keyboard checkpoint

The preceding tracking/keyboard **682 API/646 frontend/45 collector** source passed the existing
**16 cases/407 browser steps**, all eight persistence assertions and 436 stable
source/runtime entries. Separate synthetic read-import and keyboard checks passed
75 and 50 actions respectively. It adds guarded tracking preferences/delivery,
local anonymous read-cache/feed UI and bounded physical Ask AI/help focus behavior.
Public hosting/TLS, effective read/feed capability, real tracked delivery and full
original parity remain unverified. Root applied 111 source paths matching all 391
frozen files, checked the stopped migration, then passed fresh 682/646/45 tests
and build before restarting main. Inbox rendered with Read Statuses and Recent
Opens off. The postrestart audit preserved protected data and explicitly classified
normal-sync timestamps/counters rather than claiming all-row equality. See the
[applied checkpoint](research/tracking-keyboard-checkpoint-20261029.md) for exact
source identities, retained failures and coverage. No collector credentials or
real-account tracking activation is implied.

A subsequent [Render deployment proposal](collector/deploy/PROPOSAL.md) adds source-only
packaging and eight reproducible controls, bringing the collector suite to
**53 passing tests**. It has not been deployed or provisioned. The user has since
selected Vercel; the Render option is unapproved history. The separate [Vercel collector](collector-vercel/README.md) is now applied with
23 passing package tests, strict types and a restricted import check. It uses a
remote libSQL primary and a standalone nested lock. Account access remains pending
after a 403 response; no service has been deployed. See the
[Vercel checkpoint](research/vercel-collector-checkpoint-20261029.md).

A separate [paired custom Split case](research/split-inbox-paired-checkpoint-20261029.md)
completed one authorized original create/name edit/off/on/delete and exact
observable restoration. The corrected footer passed 101 synthetic browser
actions, seven immutable receipts and strict stopped checks. Root applied its
three UI paths and passed 11 focused checks, all 652 frontend tests, types/build
and an HTTP serving check. Current source is **682 API/652 frontend/53 collector**;
the earlier 407-step regression retains its 682/646 identity. Original ordering
was skipped for tool binding, and original Other retention, negative matching,
Library/template activation, original confirmation focus/geometry and full Split
parity remain open. A later copy/order-only follow-up now matches the retained
Delete Alert's two paragraphs and Delete/Cancel button order. Root passed the
existing 11 component cases, types/build and an HTTP serving check; no broad
suite or matched-browser repeat is claimed. The 101-action/652-suite identities
above remain historical.

## Run the current implementation

The preceding serving version passed **561 API/536 frontend tests**, build and strict types,
plus **16 cases/407 browser steps**, all eight persistence assertions and 165
stable source entries. Custom Split Inboxes now support account-scoped saves,
edit/off/on, overlap filtering, empty views, ordering and deletion. A separate
synthetic continuation completed 256 actions and verified twelve exact settings
receipts, including one lost-response recovery without PATCH replay. Its earlier
empty-badge test failure remains retained. At that checkpoint, original custom
settings comparison, Library activation, Auto Labels and full query parity
remained open; the later paired case is separate. See the
[Split Inbox checkpoint](research/split-inbox-local-check-20261029.md).

The preceding **531 API/495 frontend** version added automatic saving, stable
cloud Draft identity and keyed discard for newly owned Gmail drafts. A real
recipient-free create/two-update/discard lifecycle and separate fresh-process
receipt check passed. The subsequent controlled mapped Send completed Undo,
future-schedule cancellation and one native delivery. The received attachment
bytes match; the strict received plain-text assertion failed after the
recipient copy changed formatting. No retry or resend followed. See the
[provider lifecycle](research/provider-draft-live-check-20261028.md) and
[mapped Send record](research/mapped-send-live-check-20261029.md).

The preceding **480 API/429 frontend** version added manual Auto Archive/Auto
Labels settings and explicit synthetic preview/apply. Real automatic
classification remains open; see the
[automation checkpoint](research/automation-runtime.md).

The preceding recovery version passed **456 API/398 frontend tests**.
The earlier **444 API/385 frontend** version retains its **16-case/407-step** full
browser regression. The subsequent recovery version passed a focused 9-step
Knowledge journal-remount check and a separate 7-step source-editor check; the
upload acknowledgement loss was terminal-controlled, not a browser chooser test.
A controlled normal-composer lifecycle passed 93 steps: Z Undo, future schedule
cancellation and one Instant Send with a matching imported receipt pair. Received
attachment bytes and exact delivery timing were not verified. The
[combined checkpoint](research/combined-checkpoint-20261028.md) and
[recovery record](research/knowledge-recovery-check-20261028.md) preserve source
identities, data audits, failed checks and remaining parity gaps. Earlier counts
below retain their historical scope.

From the monorepo root, run `npm run dev:superhuman`, then open
http://127.0.0.1:5173. Node 24.22.1 from the existing Codex runtime is selected
by the launcher; set `REA_NODE_BINARY` to another supported runtime if needed.
The API binds to 127.0.0.1:3001 and stores state in the ignored
`.local/superhuman/mail.sqlite` database. Stop with Ctrl+C.

`npm run build:superhuman` checks frontend types and builds the browser client.
`npm run test:superhuman` runs backend persistence/integration, frontend state
tests and the collector suite.
See [browser scenarios](research/scenarios/README.md) for REA interaction checks.

The current implementation is an incomplete development version. It includes
the mail shell, keyboard commands, search over imported data, thread reading,
local drafts and attachments, labels, snoozes, and undo. Gmail is connected locally and controlled two-way delivery is verified. Rich
compose, paginated mailbox summaries and lazy conversation loading are implemented.
Claude is configured; synthetic API and inline-editor rewrite checks passed with
no recipients or real-mail context. Calendar reads and a
controlled create/Meet/edit/cancel lifecycle passed; its completed test write gate
is closed. Recipient chips, Cc/Bcc editing, moves, shared undo/redo and
account-scoped local-participant autocomplete are implemented; external
address-book coverage and ranking remain open. Bounded contact-pane selection,
recent mail and draft/thread search-return behavior are implemented and tested;
enrichment and complete contact parity remain open.

Persistent Ask AI includes scoped history/recovery, streaming, bounded local
retrieval, Markdown/citations and guarded source navigation in an independent
left pane. The subsequent local Create Draft scope passed 280 API/249 web tests
plus build/strict types.
Three live Claude browser cases passed 70 steps on synthetic data: formatting/
history, a controlled source with independent right contact, and local Stop.
Event coverage is incomplete. Earlier New-prompt/focus failures remain recorded;
their fixes passed the subsequent full demo run. See the
[bounded AI browser record](research/ai-chat-browser-check.md).

Outlook is outside the current scope at the user's request. Tracking has the
bounded applied checkpoint above; public hosting/effective flags remain unverified.
Team collaboration, CRM
integrations and many advanced settings remain unimplemented. A local demo
account contains synthetic email; it cannot send mail.

The earlier frozen Send/Undo-source regression passed **16 cases/407 steps**, all eight
persisted assertions and 98 stable manifest entries, with **325 API/290 web
tests**, build and strict types. App hash is
`5650ebf07a4bf3c92535204d9bfb6a20733d5375fee73f07e617a05e14df492b`. Reply-all retains incomplete
event coverage. These synthetic/mocked checks do not establish full original
parity. A subsequent controlled live artifact Send/Undo and fresh-generation
delivery passed, with all 17 existing drafts unchanged and matching approved-pair
receipt identities; see the separately retained failed-guard/recovery record in
[Undo observations](research/undo-send.md). The separate current-source Create
regression passed 45 steps: exact keyboard edit/save/reopen, owned empty discard
and fresh generation3 creation, with no new model or Send call. It preserves the
original seed provenance and earlier failed content assertion. See the
[Create ledger](research/ai-draft-design.md),
[Undo observations](research/undo-send.md) and
[scenario record](research/scenarios/README.md) for exact identities, earlier
checkpoints, original/runtime distinctions and coverage limits.

## Connect services

The API's [environment example](api/.env.example) lists configuration names.
`node scripts/configure-superhuman.mjs --google /absolute/path/client.json`
imports a Google OAuth Web application client into the ignored API `.env` file.
The script generates a token-encryption key if one is missing and never prints
credential values. Restart the API after changing credentials. Connect Gmail
from Settings → Add Accounts, completing provider sign-in and consent yourself.

Set approved test recipients only after the account owner has authorized sending
to those exact addresses. Claude is the default AI provider and requires
`ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`; optional `ANTHROPIC_WORKSPACE_ID` selects
a workspace when the key needs it. Script flags
`--ai-provider anthropic --ai-key-file /path/key.txt --model MODEL_ID` configure
these values privately. OpenAI is optional only with `AI_PROVIDER=openai`.
See the [API contract](api/README.md) and [provider access checklist](research/provider-access.md).

Reference fonts used for local visual comparison are private ignored files. A
fresh clone uses a fallback font until licensed assets are supplied locally.
