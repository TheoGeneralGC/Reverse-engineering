# Historical Render option — Vercel selected

The user selected Vercel on 2026-10-29. This retained Render option was not
approved or deployed; the Vercel adapter and durable database plan are being
prepared separately. The following is the historical reviewed proposal.

Choose **Render**, Oregon, one paid **`0.5c-512mb`** web service and a **1 GB
persistent disk**. Proposed service name: **`rea-superhuman-tracking`**. Requested
origin: **`https://rea-superhuman-tracking.onrender.com`**. Render assigns unique
service hostnames; that exact name, the workspace/account, billing eligibility
and final console quote have **not** been checked. A different assigned hostname
must be reviewed and entered explicitly before the service/main integration is
used. No custom domain, DNS or certificate purchase is proposed. [Web services](https://render.com/docs/web-services)

Current published baseline, checked **2026-10-29 UTC**:

| Item | Proposed monthly cost |
| --- | ---: |
| 0.5 CPU /512 MB web compute | $7.00 |
| 1 GB persistent disk | $0.25 |
| **Compute +disk baseline** | **$7.25** |

Usage, workspace charges if applicable, builds, tax and changes in the actual
console quote are additional; this is not a spending cap. Current Hobby
bandwidth allowance is5 GB/month, then$0.15/GB. No workspace upgrade or separate
paid storage account is proposed. The current plan ID replaces the older Starter
name; official docs say the alias remains valid, but the Blueprint uses the new
ID. [Pricing](https://render.com/pricing), [plan IDs](https://render.com/docs/compute-plans)

Fly.io was compared: current published examples start at$2.19/month for a
256 MB shared machine, with volumes$0.15/GB/month and separate traffic/snapshot
charges. Resources and regional rates differ, so that is not an equivalent quote
for Render's512 MB service. Render is selected for the straightforward managed
HTTPS/single-instance/disk/health setup and the existing reviewed adapter. This
is an operational choice, not a claim Render has the lowest price. [Fly pricing](https://fly.io/pricing/),
[Fly storage pricing](https://fly.io/docs/about/pricing/)

## Exact deliverable

The existing production collector modules and original 45 tests are unchanged.
Five deployment additions are prepared: pinned `Dockerfile`, strict
`.dockerignore`, `render.yaml`, `ops/render-start.mjs` and `ops/storage.mjs`.
The public test command also runs eight packaging/backup controls in
`test/hosting.test.mjs`; all **53 collector tests pass**. The proposal, operator
plan and source references are included alongside the code. No main API/web
runtime code, mail database, real environment or installed dependency changes.
These are source-only preparations; nothing has been submitted to Render.

Docker base: `node:24.22.1-bookworm-slim` pinned to OCI index digest
`sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c`.
Docker Official Image metadata was read; no image was pulled or built. Its listed
Linux/amd64 digest is
`sha256:e1582112fb9f152ed38eefcd712efc93fee1becb519fdfa57574d5e07eaa5e7d`.
The image build checks exact Node version and the existing `node` UID/GID1000.
No npm install, secret build arguments or repository-wide COPY occurs. Build-time mode normalization makes /app code readable/traversable after the UID drop and removes runtime write bits.
[Official image metadata](https://hub.docker.com/v2/repositories/library/node/tags/24.22.1-bookworm-slim),
[Render Docker](https://render.com/docs/docker)

The container starts as root solely to create/chown a new private data directory,
then clears supplementary groups and drops GID/UID to1000 **before** the reviewed
bootstrap opens keys, SQLite or HTTP. Existing aliased/permissive/foreign-owned
data is refused. The actual Linux/container privilege transition and Render disk
permissions are not yet exercised. Eight local socket-free controls pass, including
real native SQLite backup/restore, exact receipt/cursor/replay recovery and
negative configuration/tamper cases. The initial packet inherited its 45 core results; the public integration then
reran all 53 core and packaging tests successfully. The first test's comment-matching false positive is retained.

Blueprint: one instance, manual deployments, disk`/var/data`, database
`/var/data/collector/collector.sqlite`, port10000,0.0.0.0 binding and
`/healthz`. Applying the Blueprint would create a paid resource and an initial
deploy even though subsequent auto-deploys are off. It is **not applied**.
Disk services have deploy downtime and cannot scale horizontally; the disk is
available only at runtime, so there is no pre-deploy database command.
[Blueprint reference](https://render.com/docs/blueprint-spec),
[persistent disks](https://render.com/docs/disks)

## Data and credentials

The host receives only collector code, dedicated signing/cursor credentials,
opaque tenant/account/delivery/token-digest references and anonymous image-fetch
events. It receives no Gmail/Calendar/Claude credentials, email bodies, subjects,
addresses, attachments, cookies or main SQLite file. Public pixel URLs inherently
reach Render and image proxies. The signed read API remains server-only; the
browser gets the main application's bounded opaque-ref DTOs. An image fetch does
not identify a reader or prove a human read.

No real secret has been generated. After the deployment is approved, the operator
would generate one dedicated32-byte signer key, one independent32-byte cursor
key, and one32-byte opaque tenant value **locally**, then enter two secret values
through Render's secure environment settings (`sync:false` prompts). Do not paste
them into chat, Git, Blueprint or a build argument. The startup bootstrap writes
0700 directories and0600 files under
`/var/data/collector/.collector-private/initial/`. The cursor must remain stable.
The main signer envelope belongs only at a private local path such as
`$REPO/.local/tracking-credentials/main-signer-v1.json`
(parent0700/file0600). Its shape is `{version:1,keyId,tenant,key}`; the host receives
an array of `{keyId,tenant,key}` with the same signer identity. Main never needs
the collector cursor key. No current `.env` or preference is changed by this
proposal. [Environment secrets](https://render.com/docs/configure-environment-variables)

The app emits no request URL log. Render documents public HTTP request logs for
Pro workspaces and higher; those logs include requested paths. Documented log
retention is7 days/Hobby,14/Pro,30/Scale or Enterprise, with optional log-stream
destinations. Actual workspace settings, internal edge retention and shell/SSH
availability are unknown. No absence-of-provider-logs promise or additional
redaction requirement is implied. [Logging](https://render.com/docs/logging)

## Before use, after approval

The operator runbook covers build/source identity, actual assigned origin and
Host-preserving TLS, signed synthetic lifecycle checks, an owned restart,
SQLite-native backup plus stable key pair, isolated restore and rollback.
`/healthz`204 proves only open/readable local storage; it does not prove public
TLS, authenticated writes, persistence or tracking. Render health probes use the
onrender hostname when no verified custom domain exists. [Health checks](https://render.com/docs/health-checks)

Render's daily disk snapshots are not the primary custom-database recovery path.
The prepared native SQLite backup is paired with private signer/cursor files;
restore only creates a new empty directory. The runbook retains old data and
does not overwrite a live database. A code rollback preserves disk state and
therefore requires schema/key compatibility review. [Disk recovery](https://render.com/docs/disks),
[rollbacks](https://render.com/docs/rollbacks)

Nothing is hosted, provisioned, purchased or enabled. No account/DNS/resource/
real-secret/mail/model/pixel action occurred. This packet is ready for source,
configuration and cost review; actual deployment and the first real tracked
fixture remain later explicit actions. `effectiveReadStatuses`,
`effectiveRecentOpens` and `hostingVerified` stay false.

Build verification note: the Docker client is installed, but the local daemon socket was unavailable during preparation. No Docker Desktop launch, install, build or pull occurred. Actual image/platform validation remains unperformed.
