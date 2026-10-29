# Vercel setup and deployment checkpoint — 2026-10-29

The user-approved Vercel grant now works, normal reauthentication completed, and
a new collector project has a dedicated Turso Starter database on the selected
$0 plan in `iad1`. Database credentials and dedicated signing/cursor keys are
configured as sensitive **Production-only** variables. The stable owned origin
is [rea-superhuman-tracking.vercel.app](https://rea-superhuman-tracking.vercel.app).
The stable alias and unauthenticated GET/HEAD `/healthz` now pass:204, no-store,
no redirect. Health alone does not prove the signed protocol.
Main tracking remains off; no real tracked message or original parity is claimed.

The first configured regional database hostname was rejected **before network
access**. The exact two-file correction is commit
`611b5db1bbad39039b9ced9e68cd7f5bdaf05a6c`, with 23 package tests, strict types and
restricted import checks passing. Its reviewed source hold is
`1cb3aa66bd43c42156b0b9266c2b6b17b03254ae05228252bd7137af927e87d5`.
The first deployment of that commit failed during compilation with **TS5097**,
before runtime. That failed attempt is preserved. Commit
`7a4ff57ed8e15ae58e4b41ddc8100c887749ac2a` adds the package TypeScript configuration;
local TypeScript 7 project checking and JavaScript emission passed. Exact24-file
source identity is `5967987e729f68479b0c868d4319bdc62c1e76ebf8c6d02fa2a621cffcc71aa1`.
Build02 and the separate unchanged-source replacement build 03 are **READY**. Vercel CLI 65.4.0 used its built-in
TypeScript 5.9.3, Node 24 setting and iad1; the build completed in 4 seconds.

The actual pinned SDK preflight against **only the newly created database**
passed: SQLite 3.47.0, foreign keys enabled on the selected session, empty user
schema, and an explicit transaction rollback. Sanitized Root review identity is
`82c0373068a99f431c7cad796d51feabe048cf5df3ce18a3c3353b465b8b9b33`.
This preflight did not install schema or prove collector request handling. The
separate explicit operator then installed schema once, with commit-confirmed
completion and no unknown outcome, using the reviewed runtime/schema bytes.

All 31 synthetic external wire actions passed: one registration, four lifecycle
receipts, two anonymous image-fetch events, exact-key recovery and cursors, plus
negative signature, nonce, query, header and Origin controls. These are owned
collector fixtures, not mail delivery or evidence that a person opened email.

| Acceptance boundary | Current result |
| --- | --- |
| Approved project/resource and Production-only configuration | Completed |
| Actual SDK empty-primary/FK/rollback preflight | Passed |
| Explicit collector schema installation | Passed once; commit confirmed |
| Deployment build 02/stable alias/health | READY; GET/HEAD204, no-store, no redirect |
| External signed lifecycle/recovery/pixel/cursor/negative checks | All 31 synthetic actions passed |
| Fresh-process receipt/current/cursor persistence | Seven exact GETs passed before and after replacement |
| Fresh nonce across logical deployments | New seed 200 → same signed replay 401 on replacement; no lifecycle writes |
| Concurrent hosted requests | Ten requests passed: same-key equality, one nonce winner and one CAS winner |
| Remote 100-event page | All 144 requests passed;100 unique events, exact bindings,16/16/16/16/16/16/4 distribution |
| Consistent logical export and isolated restore | All eight tables and 210 rows exported after confirmed rollback; separate memory restore matched exact table data/FK/clock checks |
| Main activation or real tracked delivery | Not performed; tracking off |

The earlier 403 grant failure, rejected regional host and first failed build stay
in the record. Local 23 tests remain separate from the existing collector 53 suite;
none is relabeled as a remote result. See the [source preparation checkpoint](vercel-collector-checkpoint-20261029.md)
and [operator runbook](../collector-vercel/deploy/OPERATOR.md) for transaction,
clock and exact-target requirements. The original smoke nonce had expired before its first persistence check, so it
was correctly skipped and is not relabeled as a pass. A separately journaled fresh
nonce was consumed on build 02, then rejected as replayed after build 03 became
Current on the same stable alias. Both builds use the exact same source and
unchanged database/signing/cursor configuration. Seven fresh-process receipt,
current-state and saved-cursor reads passed after replacement. This proves
storage across logical deployments, not an observed function PID or cold start.

The concurrency run accepted one registration and one revision 2 transition; the
competing CAS failed without a receipt. Page100 created seven new synthetic
confirmed registrations and 100 anonymous events, with no throttling. A signed
account page verified every binding; GIF responses alone were not the oracle.
Actual per-SQL network round trips were not measured. These later writes
intentionally advance the tenant revision beyond the original saved cursor.

The resource view shows one Node 24 function in IAD1, 649 kB and a 10s maximum.
A consistent logical snapshot subsequently read all eight tables in one primary
transaction and explicitly rolled back before publishing the private export.
The 210 rows restored successfully into an isolated in-memory SQLite database;
a separate process repeated the restore against the independently retained
whole-file digest. Table data, schema, foreign keys, registration bindings and
clock watermark checks passed. No remote DML or production restore occurred.
This is an application logical round-trip, not managed backup/PITR recovery.

A complete deployed file inventory, observed cold start, managed backup/restore
and real tracked delivery remain open. Git remains disconnected; a
repository push does not automatically publish production. `hostingVerified`, effective read statuses and effective feed
remain false. Image fetch evidence is anonymous; it establishes neither a named
recipient nor a human read. All 22 feature statuses and full-parity gaps remain
unchanged.
