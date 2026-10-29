# Vercel collector preparation — 2026-10-29

The user selected Vercel instead of the unapproved Render proposal. A separate
[collector package](../collector-vercel/README.md) is applied, with an explicit
[deployment proposal](../collector-vercel/deploy/PROPOSAL.md) and
[operator runbook](../collector-vercel/deploy/OPERATOR.md). No service, database,
credential, environment setting or paid resource has been created. Main remains
682 API/652 frontend/53 existing collector tests with tracking disabled.

## Implemented source and local evidence

The package uses Vercel's native Express default export, Node 24 major selection
and a remote Turso Cloud **libSQL** primary through the pinned HTTP SDK. It imports
the existing own-source canonical protocol exactly; it has no mail, Google,
Calendar or model dependency. Durable nonce, CAS, receipt, binding, sequence and
rate authority lives in database transactions. A function filesystem or process
counter is not authoritative. Schema installation is an explicit operator action;
runtime and health do not migrate. The runbook requires checking the actual
Marketplace engine, selected plan, origin, region and project scope.

Root installed the separate nested lock offline with lifecycle scripts and
optional dependencies omitted; no native `.node` binary was installed. All
**23 package tests**, strict source/test types and a restricted filesystem import
probe passed. The root package and lock are unchanged. Install and test this
standalone package as documented; root monorepo installation does not install it.
These 23 tests are separate from the existing collector's 53 tests.

Tests use explicit in-memory SQLite and synthetic keys. Actual pinned SDK clients
send Hrana messages to an injected transport whose SQL runs on that database;
there is no listener or remote database. Nineteen serialized comparisons against
the retained collector cover lifecycle/current/history/error/image/cursor
behavior. Independently random event IDs are grammar-checked and normalized only
for that comparison. These fixed-clock comparisons do not prove every behavior.

Independent review reproduced two initial findings before their fixes:

- Per-event proof lookups exceeded the five-second transaction budget on a
  100-row page under simulated network latency. The successor loads proof fields
  together and checks every row, with the same account-wide binding checks in
  the same transaction. Its event unit uses 12 simulated 40 ms round trips,
  480 ms; all 100 individually corrupted proofs and missing/mismatched/null
  confirmation bindings still refuse. This is a deterministic request-budget
  check, not managed-host performance.
- A clock captured before transaction acquisition could reject an older queued
  pixel after a newer monotonic observation. Each unit now samples after
  acquisition, checks signed age again and fences rollback before COMMIT. Both
  queued pixels persist; expired signatures and actual rollback still refuse.
  The clock policy is documented in the [audit](../collector-vercel/CLOCK-AUDIT.md).

Seven independently authored unchanged controls pass after the fixes. The two
large-page controls were also rerun independently; they overlap the 23 package
tests and are not additional unique cases. Initial failures, unchanged oracles,
predecessors and source identities remain retained privately. Publication removes
only the private predecessor import/negative branch from one test; all positive
page, corruption and budget assertions remain exact. Runtime changes from the
reviewed successor to the publication package are comments only.

## Source identity and limits

Reviewed runtime hold SHA256 is
`23c8258728c210c11d05eb65a310c8bbda597024b345328a69e948a46d46aa62`;
independent final review is
`35679f4ae56eb3e3c66e449ba86346b13bd621e085201299201de4b5a0efc275`.
The 20-file publication hold is
`f63d9b9b772cd600f17a6708a61403a0a9cbfea22519724e23bc3520532a6a07`.
Root's exact copy, publication-heading/status correction and fresh gates are
bound by review
`e42a4766395ecfef034072ebcec924eb371b2bbc065aa65d9ae77b8eb46da46e`.
No private evidence, real address, credential, capture or vendor source is included.

The connected Vercel account currently lacks the intended team's grant and
returns 403. Workspace authorization remains a user action. The proposed first
target is eligible personal Hobby plus Turso Free with no paid upgrade; actual
team plan, available engine, resource quote and quota behavior are unknown.

Actual Vercel build tracing, external raw-target/Host behavior, TLS, cold starts,
Turso session/FK/isolation, concurrency, transaction latency, persistence and an
isolated backup/restore still require deployment and synthetic remote checks.
No real tracked Send or effective read/feed capability is established. Image
fetches remain anonymous and do not establish a human or named reader. Full
original parity and all feature-family completion claims remain open.
