# Original Done interaction and motion

This record supports the Done rebuild requested on 2026-10-29. The later
[applied checkpoint](done-applied-checkpoint-20261030.md) records the exact local
implementation, comparison gates and remaining gaps. This original observation
keeps its separate identity; no feature family is verified here.

## Target and static declarations

The inspected browser client identifies build `db8c4288f33febf25ad9`, version
`2026-10-27T19:07:55Z`, in Chrome `156.0.8078.48`. Retained JavaScript SHA-256 is
`c5e83a32dfaa067db99686840de45806f4f78ecdf9d568f39433696ea6fabc94`;
stylesheet SHA-256 is
`487dc45e96a4d54d4069a9552f28f97883ba07f7962b83788e7b5d8d80e2e396`.
Vendor source and account captures remain private.

The stylesheet declares a leftward exit of 100% over 200 ms with
`cubic-bezier(0.525, 0.0825, 0.215, 1.18)` and a 400 ms return transition.
The selected rules declare no opacity or row-height collapse. Naming a delayed
visibility transition does not itself prove that visibility becomes hidden.

Static list logic retains departing presenters, skips them when choosing the
next highlight, and starts a 550 ms cleanup tick on the first dismissal.
Cleanup removes entries older than 450 ms; subsequent dismissals do not restart
that tick. Fewer than 30 departing rows receive individual transitions.
The shared dismissal path first predicts whether a mutation removes each row
from the current view. A label change that leaves a row matching need not exit.
E and Shift+E are explicitly consumed without Done in Spam.

These are static findings. An attempted pinned REA static analysis stopped in
the macOS ownership helper before semantic analysis; its partial evidence and
cache/FSEvents diagnostics are retained. Direct static parsing supplies the
declarations above and is not relabeled as successful REA semantic analysis.

## Controlled runtime observation

REA operated an exact search containing only three owned synthetic threads,
after account, no-composer, result-membership and highlighted-row guards.
Environment: light theme, motion enabled, 1512 × 862 requested viewport,
device scale factor 1, en-US, America/Los_Angeles.

Capture `ev_63b4dc6193c21e0bb9ba4280fbc84b4419052c6d33e65a7d1c8dafad822c05af`
shows three consecutive E actions:

| After action | Retained rows with exit class | Highlight |
| --- | --- | --- |
| E on A | A | B |
| E on B | A, B | C |
| E on C | A, B, C | None |
| After the 900 ms observation wait | None | None |

REA reports the E steps as 73, 42 and 49 ms. These are runner step durations,
not directly recorded operating-system key-down intervals. DOM observations
establish transition classes, retention and immediate logical advancement;
they do not independently measure moving pixels or exact runtime easing.
Intermediate screenshot capture was omitted because the installed REA
screenshot adapter disables animations, which would alter this experiment.

Z restored C. A second Z did not restore B within the five-second guard, so
the run stopped before a third Undo. Static notification logic explains this:
there is one current notification, replaced by a later action and cleared
before its Undo callback. This is evidence for latest-notification Undo,
not an observed multi-entry Undo stack. The entire scenario remains incomplete
because that second result guard failed; its later actions were cancelled.

Separate exact searches restored A and B with Shift+E. All 24 restoration steps
completed in `ev_03f52332b0e384c2b30b7a5ba79fe7a4803ac3981d50c9a9f566447bf15346be`;
missing event coverage still prevents equality eligibility. One owned synthetic
reminder-carrier message also required an additive label-only restoration.
Fresh provider reads then matched every starting message ID and label set
across the three threads. These controlled actions sent no mail, submitted no
AI request and edited no user draft. Original internal reminder, notification and history state
was not compared or claimed restored.

## Replica acceptance scenarios

These are acceptance requirements. The [applied checkpoint](done-applied-checkpoint-20261030.md)
now records bounded results and remaining gaps for each purpose.

| ID | Scenario | Required result |
| --- | --- | --- |
| DM-01 | Press E three times while the first response is held | Three distinct reservations and immediate next selection; no duplicate target or per-key refresh dependency |
| DM-02 | Observe eligible row dismissal and return | Stable retained row, declared exit/return transitions and cleanup behavior; compare against the original |
| DM-03 | Complete several Done actions, then press Z twice | Current notification restores its owned latest action once; older receipts do not become a fabricated keyboard Undo stack |
| DM-04 | Definitive refusal or uncertain response | Refusal restores only its owned presentation; uncertain issued work stays recoverable without replay |
| DM-05 | Change account/view while work is pending | Late results do not replace the current list, selection or editor; disposed queues issue no new Undo |
| DM-06 | Use reduced motion or dismiss at least 30 rows | Deliberate transition policy and stable selection; original reduced-motion behavior still needs comparison |
| DM-07 | Hydrate a previously cached thread, return to its list | Authoritative allowed summary fields refresh the existing row without resurrecting a dismissed row |
| DM-08 | Trash, Move, label change or reminder removes a row | Reuse the eligible presentation path with each operation's own persistence and recovery rules; matching rows remain visible |

Broader action motion, keyboard contexts, physical held-key repeat, responsive
geometry, reduced-motion equivalence and full animation parity remain open.
