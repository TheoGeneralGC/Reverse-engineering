# Selection AI writing — SH-012

This is a bounded original observation and independent replica implementation.
It does not establish full AI parity or matching model output. A local Anthropic
key and explicit model are configured. Bounded synthetic API and live editor
checks passed; no substitute text is returned when the provider is unavailable.

## Observed original runtime

REA 6.8.0 used the existing signed-in target and build identity from
[source-inventory.md](source-inventory.md). Chrome 156.0.8078.48, en-US,
America/Los_Angeles, light theme, reduced motion. Only recipient-free synthetic
draft text was used. No existing draft or real message was submitted or edited.
Each probe cleared its own body and asserted composer closure. The temporarily
expanded browser window was restored afterward.

- `ev_253554e5ff8e48cddef80111a2ece3582c7ce7cc137676adf1e71fd696da985d`:
  12 actions completed at actual 500×963. Selecting synthetic text and clicking
  the floating Write with AI control opened inline editing controls. No AI
  instruction was submitted in this first probe.
- `ev_a6b00ac44338cb2e4e4a413d100942255460b70b05d12b6fb0676ba4ab15d4f5`:
  14 actions completed at actual 1920×963. The same synthetic selection opened a
  roughly 640×84 inline panel below the selected line, with a thin pink/purple
  border, prompt field and command row. Clicking Shorten produced a shortened
  replacement directly in the editor within the recorded five-second window.
  No separate acceptance preview was shown. Done and Retry then appeared;
  Escape closed the AI controls while retaining the replacement. Text content
  and captures remain private.

Both captures report missing event coverage and equality_eligible=false. They
support the recorded UI/result observations, not network completeness or a whole
product comparison. The observed command row contains Improve writing, Fix
spelling and grammar, Shorten, Lengthen, Simplify and Rewrite in my voice.
After the result, Fix spelling and grammar is absent and feedback buttons appear.
Retry, feedback, other commands, streaming, original failures, selection boundaries
and personal voice modeling were not exercised.

## Replica implementation and safeguards

The local editor opens an inline command row from its selection toolbar, compose
button or Cmd+J. It sends only the selected passage (or the whole current body if
selection is collapsed) and explicit instruction to the configured writing adapter.
Successful text replaces that retained range as an undoable edit. Surrounding
formatting remains. Done closes the controls, and Retry explicitly repeats the
last request against its original input while targeting the current replacement.
These fallback and retry semantics are local choices awaiting original comparison.

A late result is discarded after closing, unmounting or delivery locking. If the
body changed while a request was pending, replacement is rejected and the latest
user text stays. Provider/configuration failures retain the draft and show the
actual error. Requests are not automatically repeated. Closing aborts the local
HTTP request; termination of already-started provider computation is not promised.
Personal voice modeling is unavailable and reports a concrete setup limitation
instead of silently claiming an inferred user voice. Feedback persistence is open.

Five initial controller regressions cover partial/multiline replacement, surrounding
formatting, undo/redo, repeated targeting, empty bodies, stale edits and locked or
different editor rejection. Four actual React-component tests use controlled
provider promises to cover direct application/Retry, cancellation, provider
errors, newer user edits and delivery locks. They make no provider calls. Nine additional independent tests cover trailing
blank paragraphs, marker removal, literal markup/emoji, draft identity changes,
unmount and reopened sessions, plus the selected-text adapter boundary.

The user selected Claude and supplied its key to private local configuration. The server defaults to Anthropic without automatic model/provider fallback;
`ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` are required. The existing OpenAI adapter
requires explicit selection. Provider request/response/error tests use mocks. A separate synthetic local API
check returned a correct two-sentence rewrite using `claude-opus-5-5` (HTTP 200,
2,269 ms), with no real-mail context. Private evidence is indexed in
[status.md](status.md). The later live editor result is recorded below; broader quality remains open. [Anthropic Messages API](https://platform.claude.com/docs/en/api/http/messages/create)
and [model catalog](https://platform.claude.com/docs/en/models/overview) define the
external contract, not Superhuman's private model choice.

The unconfigured inline browser case passed 18 steps at the pre-Claude checkpoint:
`ev_b2d8e5fca893d66da835c78bf46c9a17e274625da4f50caf6c9495786a75a36d`.
It proves the error retains the synthetic draft at that checkpoint. The updated
Claude configuration message subsequently passed in the full 15-case run
(`ev_253e0224d86151e295f68497329dd43ad4f43dff0a9c62fa55a4e974b71fd04a`),
with live generation checked separately below.

Mailbox-wide retrieval, cited answers, action execution, summaries, knowledge,
autocomplete, automatic drafts/triage, voice matching, full original command and
error semantics, visual equality and output-quality evaluation remain open.


## Bounded live Claude result — 2026-10-28 UTC

The user supplied a key for this project. It is stored only in the ignored local
environment (0600), never in public source or browser requests. The configured
provider/model are Anthropic and `claude-opus-5-5`; no alternate model/provider
was substituted. A separate local API/web workspace used a fresh synthetic-only
SQLite database and explicitly disabled Google, Calendar and mail delivery.
No real email content was sent to Claude during these checks.

`ev_644d4b8b49e1e1af27252593e8c74ec5234da2d3a215f626fb444727a358ba13`
completed 14 actions (15 captured steps): open a recipient-free synthetic draft,
clear its seeded signature, enter/select two scheduling facts, Cmd+J, Shorten,
observe Done, verify both day names and allow autosave. Its one captured
`POST /api/ai` returned HTTP 200, the configured model, and no context thread ID.
The request contained only the synthetic selection plus rewrite instruction.
The shorter replacement appeared directly in the editor and persisted, retaining
Thursday/Wednesday and the preparation reason. Six assertions passed: owned draft
saved, facts retained, output shorter, no recipients, no hidden input markers,
and exactly one AI request/HTTP 200. Root visually reviewed the end screenshot
and saved HTML/text.

The complete implementation/fixture/scenario/runner/lock manifest plus the private
live harness/input/launcher hashes were unchanged. The owned browser was
terminated. Requested step artifacts are present, but overall event coverage is
incomplete and `equality_eligible=false`. This establishes the bounded direct
replacement/save flow; it does not establish complete network coverage, identical
model output, visual equality, live Retry, or all AI commands. Compare the
original Shorten flow above, `ev_a6b00ac44338cb2e4e4a413d100942255460b70b05d12b6fb0676ba4ab15d4f5`.
Private capture/report/owned draft/screenshot:
`evidence/private/ai/claude-inline-live-20261028T051438Z/`.

Separate one-attempt synthetic API checks also returned HTTP 200:

- Plain writing preserved two facts/day names (2,269 ms).
- Selected synthetic-thread summary preserved the next-week plan and feedback
  sequence (5,029 ms).
- A missing-information question explicitly declined to invent an exact meeting
  date/time and distinguished the message timestamp from a scheduled event
  (4,405 ms).

Those reports are private under `.local/live-tests/claude/`; they are a few
reviewed fixtures, not corpus-wide factuality or original-output equivalence.
An earlier loopback transport attempt failed before any HTTP response and was
retained. No ambiguous provider result was automatically repeated.
Rich answer/Markdown rendering, citations, mailbox-wide retrieval, action tools,
personal voice, streaming, quality under failures/long context and full original
assistant behavior remain separate open work.
