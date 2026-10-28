# Account Personalization (private implementation candidate)

This candidate is separate from the running root application. It adds a staged,
account-scoped Personalization editor and persistent settings, and supplies a
bounded snapshot to explicit AI requests. It does not establish full original
parity, automatic voice learning, original save behavior, or original fact limits.

## Observed basis and local choices

The retained original form has Greeting & Signoff, Job Title & Company, Writing,
Scheduling, Events, About Me and Knowledge Base category controls; five named
single-line fields, three rich input containers, Add a fact, Cancel and unchanged
Save disabled. Its single-line inputs and selected source declarations have a
5,000 UTF-16 unit limit. Only opening/navigation/static declarations were
investigated; no original account-wide settings were saved. See the sanitized
research/knowledge-settings-acceptance.md in the application repository.

The candidate preserves those field names and staged Save. Plain multiline
textareas, an explicit per-account revision, 100 active facts of 1,000 UTF-16
units, 512 retained fact tombstones, conflict resolution and error recovery are
local implementation choices. Automatic adaptation to voice is not claimed.
Knowledge navigation is wired only after the separate Knowledge host is merged.

## HTTP and persistence

`GET /api/personalization?accountId=...` returns `{settings}` and creates no
record. `PATCH` on the same exact account query accepts only
`{expectedRevision, changes}`. `changes` permits greeting, signoff, jobTitle,
company, companyDescription, writing, scheduling, events and an ordered active
facts array of `{id,text}`. No cross-account/default account fallback or enabled
flag setter is exposed. Unknown/duplicate query keys and unknown body fields
are rejected. Noop writes retain the exact original row bytes and revision.

A short SQLite transaction rechecks the revision before applying changes.
Unrelated metadata, the existing enabled flag, fact metadata and tombstones are
preserved. An omitted formerly active fact becomes a tombstone; a removed ID
cannot silently be resurrected. Corrupt existing rows are errors, not missing
defaults that may be overwritten. Unsafe revision overflow and a full fact
history are rejected atomically. Reads, Save and category navigation perform no
model call, provider operation, draft modification, delivery or Calendar action.

The frontend retains unsaved input through failures. A 409/unknown Save requires
an explicit read before another write; accepted matching values are reconciled
without another Save. Independent remote fields are retained on reload. A true
same-field conflict requires an explicit Keep my changes/Use saved changes
choice. Delayed reads/saves are scoped to the current account and editor epoch.
React StrictMode reactivation preserves monotonic epochs and does not leave a
permanently closed loading editor. Closing dirty input asks for a discard choice;
closing does not imply rollback of an unconfirmed prior Save.

## AI context

An explicit new Ask AI turn reads a bounded settings snapshot synchronously
and persists its clone with the turn acceptance transaction. It binds account, revision, the full known
preference hash, full/supplied character and byte counts, and truthful truncation.
A repeated request key returns its original turn/snapshot even if current
settings have changed or become unreadable. The accepted snapshot is not
refreshed at Run. Legacy completed turns without a snapshot remain readable.

Preference JSON remains valid and Unicode-safe. It is bounded by 32,000 UTF-16
units and a **24,576-byte JSON string-wrapper budget**, including escaping.
The full original preference hash and total sizes survive truncation. These are
local context policies. Whole-turn byte/token/retrieval limits still apply;
combined large contexts may exhaust them. Disabled settings supply no profile
text. Removed facts and unknown metadata are excluded. The model receives
preference data, not new tool authorization or a claim of learned voice quality.
Inline writing also snapshots the explicitly selected account's preferences.

## Validation and remaining work

The private API passed 349 tests including independent corruption, CAS,
rollback, Unicode/budget, account isolation, immutable accepted snapshot and
request-handler controls. The browser client passed 304 tests including actual
App/React StrictMode, stale response and keyboard/dirty-close guards; build and
strict source checks passed. Upstream model/provider responses are mocked in
these gates. Preserved failed regressions remain private, including the original
character-only budget expectation superseded by the byte cap.

A separate provider-disabled demo passed a pinned REA browser case of 32 steps:
edit synthetic fields/fact, dirty Escape/Keep editing, command guard, one Save,
reopen and exact persistence. The read-only SQLite postcheck found revision1,
exact synthetic fields/fact, unchanged baseline drafts, zero model dispatches
and zero deliveries. Browser cleanup was confirmed. Event coverage is incomplete
and equality is false; no unobserved request absence or original save equivalence
is inferred. Source SHA inventory was taken after capture, with all runtime
source modification times preceding the armed scenario. A subsequent read-only seven-step browser case verified Greeting focus and the
Close control with stable before/after runtime hashes. The measured desktop
modal bounds, field spacing and footer now match the retained original; the
truthful two-line copy and synthetic account data intentionally differ. These
measurements do not establish pixel parity across viewports or complete
original keyboard behavior.

One real Claude-only synthetic turn supplied the accepted revision1 profile,
answered the fictional sample count and marker correctly, and left all
application records unchanged. Its single provider dispatch created no drafts
or deliveries. A separate seven-step browser history case reopened the exact
completed turn without a new question. Both cases remain private. They establish
this controlled profile fact retrieval, not original voice/style quality or
universal compliance.
