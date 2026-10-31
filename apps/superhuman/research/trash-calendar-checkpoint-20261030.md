# Scoped Trash/Undo and hosted Calendar checkpoint

This records a reviewed implementation and bounded comparisons. It does not
establish full parity or prove that a Git commit is deployed. Production rollout
and its live health checks remain a separate gate. All22 feature families remain
open; the current hosted beta remains private.

## Trash and immediate Undo

Trash now shares immediate row reservation and account-scoped FIFO admission
with Done. The next eligible row becomes available before a response arrives;
an owned Undo can return its row immediately while its inverse waits behind the
original action. The existing horizontal dismissal presentation remains separate
from selection highlighting. Unknown issued work keeps its original key and is
checked through status reads; it is never automatically replayed.

The backend adds a dedicated keyed Trash receipt/inverse and two authored schema
objects. Fresh source, account incarnation, grant, linked Undo and competing
Draft/Archive/Reminder work are checked at admission. Strict8192-byte UTF-8 JSON
and duplicate-key rejection apply only to the new Trash routes. Existing ordinary
request decoding and Archive wire contracts retain their previous behavior.
See [the protocol](../api/TRASH-ACTIONS.md) for its conservative refusal and
unknown-history rules.

One approved Original Trash/Undo case completed33 steps on build
49584c503344063bea77/version2026-10-30T19:06:29Z in Chrome156.0.8078.76:
`ev_e1fffdf6504545b761aa0befbafed7c86ff5b3e7a81bace022617f6cd1b5c2d4`.
An independent provider read confirmed restoration. The isolated reconstruction
pair used earlier741 source and confirmed one forward/inverse with protected
copy checks. That pair does not prove this successor's rapid-key behavior,
moving pixels or complete native equivalence. Missing event coverage remains;
the key runner's step durations are not physical typing cadence.

## Validation and native storage

Current source composition preserves the complete existing Google callback,
diagnostic wiring and hosted runtime. Independent source review found no new
actionable issue. Its affected44 Calendar/OAuth/worker purposes, one summary
unknown-Trash purpose and strict checks passed. Historical762 validation remains
qualified: full API1131/1132 initially, with only its new fixture corrected and
passing separately; web842/842, hosting176/176 and recorded strict/build passed.
These are separate source/run identities, not one current full-suite result.

A pinned native HTTP SQL fixture tested actual Actor/ThreadedCore/Core with
the child statement cache enabled: public749 baseline, unchanged749 reopen,
cold768, upgrade and fresh768 reopen. The migration namespace advanced epochs
1→2→3→4 through observed worker exit before quiescence. Only the Trash table
and index were added. Prior schema, all138 other old typed tables, recipient-free
draft,128KiB binary, encrypted fictional slot and unknown Archive/Undo remained
exact. On the final reopen the new empty Trash table was protected too.

The original first run failed in the object-row snapshot oracle. A raw-column
successor reached a second failure because the inherited Auto Draft close path
updates its foundation clock even with zero jobs. Both failures are retained.
The final fixture first demonstrated that update on unchanged749, then required
the exact typed clock row/hash, integer identity, nondecreasing stamp and actual
close-time window at every stage. It did not omit or rewrite the clock table.
All five stages passed; all owned containers/network were confirmed absent.
Exactly one synthetic Archive callback was counted separately from zero real
provider/model/Blob calls. No real database or mailbox was used in that fixture.

This is synthetic native storage evidence, not populated real Calendar,
Knowledge or delivery migration, managed-cloud latency or live rollout proof.

## Hosted personal Calendar

A fresh approved personal Calendar OAuth flow succeeded on publicb466 source.
The encrypted hosted Calendar slot and granted response scopes were confirmed;
the connected UI displayed two selected calendars without a loading/connection
error. The earlier callback500 remains unexplained. The opt-in redacted stage
diagnostic supplies observation, not a claimed cause fix. No event, invitation
or Calendar mutation was submitted during this connection check.

## Acceptance cases and remaining work

| Case | Evidence and limits |
| --- | --- |
| TC-01 Rapid Trash/Done reservations | Actual React and queue controls; current Original rapid Trash repeat remains open. |
| TC-02 Immediate owned Undo | Local held-response controls and one earlier-source native pair; no fabricated Undo stack or automatic unknown replay. |
| TC-03 Unknown/source conflict | Keyed status, fresh competing-action guards and protected receipt controls; cross-client Gmail atomicity is unavailable. |
| TC-04 Cold/upgrade/reopen | Final synthetic native sequence passes with exact inherited clock observations; actual Production remains separate. |
| HC-01 Personal Calendar connection | Actual hosted grant plus connected calendar list observed; hosted mutation/meeting lifecycle and full parity remain open. |

The shared moving selection highlight, pointer/scroll policies, exact motion
timing/pixels, all views, public arbitrary-Gmail sign-in and ordinary delivery
beyond the approved test pair remain unfinished. Licensed typing completion and
broader team/CRM behavior remain separate requirements.
