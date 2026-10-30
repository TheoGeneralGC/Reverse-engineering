# Vercel mail worker activation proposal

Use the existing `generalgc` Pro workspace and project `rea-superhuman`. The
prepared root Vercel configuration combines the static browser app, one Node24
HTTP gateway and one persistent `mail-worker` Daemon. All Deployments Vercel
Authentication remains enabled. No public ingress is added to the daemon.

Activate one iad1 worker with one GiB memory and120 seconds of graceful shutdown.
The current regional rates imply approximately $7.63 memory for30 days ($7.89
for31), plus $0.128 per active CPU-hour, Functions, SQL, private Blob, network and
tax. Existing Pro credits may offset usage; remaining credits and other projects'
usage are unknown. This is usage-based compute, not a fixed-price total or an
upgrade to another subscription.

Mail uses the approved dedicated Turso primary and private Blob store. Control
commands require a separate free-Starter primary and its specific Production
access approval. No existing local mailbox database or token is copied. The
hosted Google callback must be registered, then the user signs in to create new
encrypted hosted tokens. Existing approved test-recipient restrictions remain.

The exact release still needs actual remote SQL, image/runtime, OIDC/CORS and
protected hosted routing checks before promotion. A staged Production build
must not be promoted to the site's aliases during diagnostics. A normal
production promotion starts the configured daemon; Preview does not run daemons
during the platform's current beta. The prepared Dockerfile, configuration and
runtime source are reviewable in this directory and at repository root.

The local gates pass1044 API/781 frontend, with focused worker/recovery controls.
Unexpected provider outcomes remain locked. Hard worker death conservatively
requires exact-instance termination proof before takeover. Preserving an unissued
immediate Send through deployment and native middle/context-click large downloads
remain explicit gaps. These limitations do not establish full Superhuman parity.

The user approved and activated this continuously running resource. Its first
two startup failures were stopped and investigated; the worker remains scaled
to zero pending the reviewed [remote savepoint correction](../research/vercel-remote-savepoints-20261030.md).
The original proposal above records the approved scope and recurring usage.

Primary pricing/configuration references:
- https://vercel.com/docs/daemons
- https://vercel.com/docs/daemons/limits
- https://vercel.com/docs/daemons/config-reference
- https://vercel.com/docs/functions/usage-and-pricing#regional-pricing
