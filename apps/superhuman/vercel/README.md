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

Open release gates include actual remote SQL durability, Linux image build,
private Blob OIDC/CORS, protected hosted routing, cloud worker ownership/handoff,
fresh Google OAuth, runtime inspection and rollout. Native context-menu or
middle-click large-file downloads still need a server navigation path. A hard
worker death conservatively blocks takeover until independent termination proof;
lease expiry alone never grants ownership. Immediate Sends not yet issued during
shutdown retain an explicit `not_dispatched` receipt rather than silently sending
after Undo admission stops. Those are operational/parity limits, not verified
original behavior. The separate Trash/Command interaction candidate is not part
of this release boundary.
