# All-Vercel mail runtime candidate

This package adapts the existing persistent mail API to Vercel. It is a reviewed
local candidate; successful local tests do not establish a working hosted inbox
or complete Superhuman parity. The existing local app retains its default native
SQLite implementation.

A stateless Node Function accepts same-origin commands into a dedicated Turso
control database. One persistent Vercel Daemon owns Core, backed by a separate
Turso mail database. It acquires exclusive authority before construction,
migrations or recovery. Command dispatch remains concurrent so a pending Send
or model request does not block Undo or Stop. Functions never construct Core.

The daemon keeps synchronous Core SQL on one owned worker thread. Control
transactions, heartbeat, authority checks and Blob IO stay on the parent event
loop, so a large synchronous import does not block their continuations.
The child checks a parent-revocable shared fence before guarded SQL. Every
provider/model call first obtains the parent's existing authority-checked native
registration and stays tracked through completion. Losing authority or the
thread revokes that frontier and preserves uncertain receipts; it never retries
an issued operation. Graceful ownership handoff requires Core drain/close plus
an acknowledged, observed worker-thread exit. A timeout or forced termination
does not mark the actor quiesced. Production passes only explicit mail-Core
environment capabilities into the child; Control, Blob and platform credentials
remain with their parent adapters.

Large request/response bytes use private Blob staging, immutable scoped grants,
length/digest checks and a one GiB staging quota. Browser API call sites opt into
this transport explicitly. A late response is recovered through GET-only receipt
reads; the browser never repeats a mutation automatically. Temporary objects
are reclaimed only after their accepted commands finish. Unknown commands and
provider outcomes remain locked.

Production configuration requires distinct mail and control primary hostnames,
`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `CONTROL_TURSO_DATABASE_URL`,
`CONTROL_TURSO_AUTH_TOKEN`, `MAIL_RUNTIME_NAMESPACE`, `MAIL_PRIVATE_BLOB_STORE_ID`,
`WEB_ORIGIN`, the matching hosted `GOOGLE_REDIRECT_URI`, a 64-hex-character
`TOKEN_ENCRYPTION_KEY`, and the existing provider/runtime configuration. Put
credentials only in sensitive server environment variables. The browser receives
only the explicit nonsecret private-store origin. Preview refuses mail storage
initialization. All Deployments Vercel Authentication remains required.

Remote mail startup explicitly verifies provider-managed WAL before consuming
Store's exact leading WAL setter; the remaining SQL is unchanged. Generic/local
defaults retain their setter behavior. Canonical regional Turso hostnames are
accepted by both storage adapters and the Function loader. Set
`MAIL_REPLY_TIME_ZONE` for hosted quoted replies: Vercel reserves `TZ`; the local
legacy TZ/system fallback remains available when the app setting is absent.
The worker image provides a system CA bundle for the native connector. A guarded
read-only native WAL check closes before ownership/control startup; it neither
constructs Core nor changes authoritative takeover rules.

The root Vercel configuration targets this application and builds the explicit
web workspace and leaf SDK dependencies separately. The daemon Dockerfile pins
Node24.22.1 and has an allowlisted build context. Its proposed single iad1 worker
uses one GiB and120 seconds of termination grace. Daemon activation and recurring
compute cost require separate approval; no worker was activated during the local
validation below.

Validation: the full API suite passed1044/1044 and frontend781/781 with stable
source/support hashes. The final combined runtime package gate passes91/91. Focused controls cover synchronous SQL compatibility,
actual Core loopback, ten MiB transfer, ten-second Send Undo, AI Stop, cloud-save
flush, graceful ownership handoff, poisoned Function-client replacement and
read-only late-result recovery. See the [checkpoint](../research/vercel-runtime-candidate-20261029.md)
for evidence limits.

The [cloud storage checkpoint](../research/vercel-cloud-storage-20261030.md)
records actual remote SQL/control durability and guarded cleanup, plus a Linux
image build, corrected protected Preview routing and actual ten/fifty MiB private
Blob upload/read/download/hash verification with cleanup. Missing-length reads
bind fresh metadata to the durable byte count and SHA; HTTP weak validators do
not become content authority. The successor focused hosting gate passes131/131
with strict types and independent review. Open release gates include actual
worker OIDC/Core storage, cloud ownership/handoff, fresh Google OAuth, runtime
inspection and rollout. Native context-menu or
middle-click large-file downloads still need a server navigation path. A hard
worker death conservatively blocks takeover until independent termination proof;
lease expiry alone never grants ownership. Immediate Sends not yet issued during
shutdown retain an explicit `not_dispatched` receipt rather than silently sending
after Undo admission stops. Those are operational/parity limits, not verified
original behavior. The separate Trash/Command interaction candidate is not part
of this release boundary.

The later CA/preflight gate passes137/137 focused tests and strict types. A
non-root Linux image check verifies the actual native TLS trust initialization
and guarded read-only preflight. The first live boot exposed the absent OS roots;
its schema-empty owner was recovered only after the reviewed whole-service stop
and exact no-issued-work checks. The service remains scaled to zero pending the
corrected live startup. See the cloud checkpoint for retained failures/limits.
