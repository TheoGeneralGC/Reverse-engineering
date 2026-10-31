# Summary-route basis batching

The inbox summary response now reads its page, privacy projection and displayed
Archive witnesses in one bounded read snapshot. Existing eligibility/incarnation
checks run once per account, with one parameterized head batch for at most100
pairs/128KiB. Other routes and future Archive/Undo admission retain their existing
fresh checks. No authority, result or grant survives as a cache after the request.

Unsupported shapes, bounds or ill-formed Unicode choose the prior path before
batch work. Missing/invalid witnesses stay null. An unexpected batch/storage
failure deliberately fails the GET instead of returning a partly available page;
there is no scalar replay after failure. This availability distinction is an
explicit design choice. No schema, dependencies, scheduler, frontend, credentials,
tracking preferences or deployment resources change.

The five-path change was transplanted onto current059bf66, preserving its JSON
tracking loader, worker, Command/Ask AI UI and downloads. The composed742-path
source passed44 affected controls and strict types. Two independent narrow
controls passed on the same five-path implementation before composition. Tests
use explicit isolated databases and deny external traffic. They cover privacy,
pair ownership, unsafe native cells, coherent snapshots, rollback/ABA, bounds,
failed release/authority and fresh later action refusal.

A separately declared paired local experiment used the actual Actor, threaded
Core and native remote SQL stack with identical fictional data/instrumentation
on both legs. Each invoked metadata bootstrap and one50-row summary once:

| Actual mail database HTTP requests | Baseline | Candidate |
| --- | ---: | ---: |
| Metadata bootstrap |44|44|
| Summary |610|24|

Both response byte hashes and all eight source/projection/authority snapshots
matched. The real SQL transport passed INTEGER/REAL/TEXT/BLOB and unsafe-integer
projection comparisons, rolled back its five temporary probes, and retained
schema/integrity/FK/empty-secret checks. Both normal drains observed Core close
and worker exit before quiescence; clients/resources closed and all eight owned
containers/four internal networks were removed. No real mail, provider, model,
public networking or Production data was used by that experiment.

These are local fixture request counts, not a measured Vercel speedup or a proof
of the earlier cold-tab cause. Native held-response/external-writer/revocation
experiments remain outside this paired scope; local snapshot/frontier controls
are separate evidence. An earlier large diagnostic's unexplained final audit
failure remains preserved and is not relabeled resolved by this new success.
Current original-app comparison and complete1:1 parity remain open; all22 feature
families keep their unverified status.
