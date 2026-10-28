# Superhuman browser reconstruction

Objective: reproduce the observed Superhuman experience in a browser, including
appearance, interaction, keyboard behavior, and real email functionality backed
by persistent storage. The user selected real provider integration and permitted
inspection of any existing account on this Mac.

The setup phase does not establish full parity. The feature inventory is a
candidate checklist; discovery must expand it to cover the accessible product.

- [Current implementation checkpoint](research/status.md)
- [Setup and access](research/setup.md)
- [Investigation and delivery plan](research/plan.md)
- [Parity inventory](research/parity.csv)
- [Finding ledger](research/findings.md)
- [Local search grammar and limits](research/search.md)
- [Provider draft observations and acceptance](research/provider-drafts.md)
- [Combined delivery, Knowledge and personalization checkpoint](research/combined-checkpoint-20261028.md)
- [Knowledge receipt recovery checkpoint](research/knowledge-recovery-check-20261028.md)

Keep private source material in `evidence/private/` and `evidence/raw/` (ignored).
Store sanitized specifications and synthetic fixtures under version control.

Planned layout: `web/` for the browser client, `api/` for the backend, and
`research/` for observed behavior and comparisons. Choose implementation details
after the initial data-flow and interaction inventory.

## Run the current implementation

The running version passed **480 API/429 frontend tests**, build and strict types,
plus **16 cases/407 browser steps** and all eight persistence assertions.
Manual Auto Archive/Auto Labels settings and explicit synthetic preview/apply are
applied; real automatic classification remains open. See the
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
`npm run test:superhuman` runs backend persistence/integration and frontend state tests.
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

Outlook is outside the current scope at the user's request. Tracking, team
collaboration, and many advanced settings remain unimplemented. A local demo
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
