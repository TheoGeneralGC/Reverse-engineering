# All-Vercel runtime candidate checkpoint

This is an implementation and local-validation record, not original-product
runtime evidence or a completed hosted release. The user selected Vercel for the
backend and authorized production publishing. All22 feature families remain
open and unverified. The applied local baseline was1035 API/766 frontend;
this separately staged candidate passes1044 API/781 frontend.

## Implementation and design choices

The candidate adds an explicit synchronous SQL contract while preserving native
SQLite defaults, a primary-only libSQL adapter, separate asynchronous control
storage, persistent worker ownership and durable HTTP commands. Actual pinned
drivers reproduced an event-loop/SQL lock when both writer styles shared one
file; distinct files avoided it. Remote Turso timing is not established by that
local control. Mail and control databases must therefore be distinct.

The worker owns the actual Core through standard loopback Node HTTP. It accepts
concurrent requests, gates native work, drains active models/provider operations,
flushes queued cloud drafts and closes Core before publishing clean handoff.
Lease expiry or missing heartbeat does not prove process death. The initial
operational policy refuses automatic dirty takeover and preserves uncertain
receipts. Immediate unissued Sends retain `not_dispatched` on shutdown; uninterrupted
Send across deployments remains a behavior gap.

Private Blob staging keeps large bodies outside the Function limit. Grants bind
namespace, command, API path, length and SHA-256; command acceptance binds the
manifest atomically. Cleanup excludes queued/claimed/uncertain work. Browser
transport is explicit, validates grant origins/bytes, and recovers late responses
by reading the original receipt without repeating the mutation. Poisoned control
clients are retired after their active handlers drain.

## Validation and retained failures

The complete API gate passed1044/1044 across120 test files; the full frontend gate
passed781/781 across73 files. Pinned Node24.22.1, allowlisted environment and exact
source/support hashes were used. API permits numeric loopback fixtures and records
120 zero-attempt denial footers; deliberately isolated subprocess environments
and dns/promises are outside that interceptor's scope. Parser subprocesses retain
their own permission limits. Frontend denial-first counters are zero. Historical
API tests required31 environment-path alignments in nine files to satisfy the
current isolation instruction; assertions and production behavior were unchanged.

Focused actual Core controls pass for OAuth state cookies, ten MiB attachment
bytes, ten-second Undo, concurrent AI Stop, no-abort model drain, single cloud-save
flush, healthy standby without second Core construction and owned subprocess
SIGTERM. Unexpected flush rejection and a cancelled reminder callback were first
reproduced as failures, then corrected. A real committed-but-unacknowledged control
write exposed permanent warm-Function poisoning; replacement/overlap controls now
pass without replay. A short gateway timeout exposed stranded inline AI output
and a lost command ID; bounded read-only receipt recovery now passes against an
actual local HTTP bridge and durable command log. Local socket-denial failures
and corrected loopback-authorized runs remain in private evidence.

These are local implementation proofs. They do not establish hosted Gmail/model
behavior, complete original coverage, visual/motion equality or full parity.

## Platform and resource observations

A protected Preview diagnostic loaded the native binding/FTS in Vercel's Linux
x64 Node24.21.0 runtime and preserved the rewritten original request path. It
used an ephemeral memory database and had no Production credentials; it did not
prove remote durability. Dedicated mail SQL and private Blob resources were
created after explicit approvals and restricted to Production. The old Blob
read/write token variable was removed in favor of OIDC configuration. Actual OIDC
and browser CORS/file-transfer checks remain pending.

The dedicated control database grant, staged Production SQL diagnostic, cloud
file test and persistent worker activation remain separate release steps. No mail
worker is deployed or activated at this checkpoint. The canonical production
origin still has no usable hosted mail release. The existing tracking service
and unrelated projects are unchanged.

The full private logs, synthetic fixtures, source holds, failed controls and
resource observations remain under ignored .local directories. No real emails,
credentials, captures, browser profiles or vendor binaries belong in this public
checkpoint. See the [runtime README](../vercel/README.md) for configuration and
remaining release limitations.

## Final package and upload collection gate

The combined Vercel package gate passes91/91 across12 files with stable268-source
and26-support holds, zero denied external attempts and108 permitted loopback calls.
The broader API/frontend gates above were not repeated unchanged.

An actual Vercel CLI65.4 dry run found the first upload rules selected only five
root files: the CLI matcher treats directory negation syntax differently from
the earlier generic allowlist checker. The failure was retained before deployment.
Corrected rules now collect exactly270 reviewed source files with no missing/extra
paths; the same CLI rejects30 synthetic private/binary/unreviewed sibling files
and three private directory entries. The Docker ignore remains separately scoped
to Docker syntax. No Production deployment or daemon activation occurred.

The Git-triggered Preview initially failed on the old frontend-only project build
path. Project root/build/install/output overrides were then cleared for the new
root configuration, and All Deployments Authentication was read back enabled.
A corrected actual platform build remains required.
