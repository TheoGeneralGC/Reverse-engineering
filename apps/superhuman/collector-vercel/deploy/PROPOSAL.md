# Vercel deployment proposal

Checked **2026-10-29 UTC**. User chose Vercel; the Render proposal was not
approved. Recommend a separate Node24 Vercel collector project backed by **Turso
Cloud libSQL over HTTPS**, retaining the current tracking wire protocol. Neon
Postgres is the concrete alternative if the selected Marketplace product cannot
provide the documented libSQL interactive transactions. The selected architecture is the asynchronous core with a remote libSQL primary
transaction adapter, subject to the actual Marketplace engine/free-plan check. The
first deployment target is **eligible personal Hobby + Turso Free, $0 base,
no automatic upgrades**. The private implementation passed23 owner tests and seven independent controls,
plus the independent100-page check. No account/resource, real key, environment
change or deployment occurred. Actual remote behavior remains unverified.

## Target and platform

Proposed project `rea-superhuman-tracking`, proposed stable production origin
`https://rea-superhuman-tracking.vercel.app`. Availability, selected team, project
ID and exact assigned hostname are unknown. Use a single function region near
the database's primary; choose the actual matched regions from the selected
catalog. Preview uses an isolated database and synthetic credentials. Production
pixel ingress must be public, while `/v1/*` retains application HMAC protection.
No Vercel authentication bypass secret is embedded in an email.

Vercel supports Node24 **major** selection; it rolls patch versions, so the
previous Docker exact24.22.1 image pin does not carry over. Its function filesystem
is read-only except scratch `/tmp`; no SQLite file, embedded replica or secret
file is authoritative in a function. [Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions),
[runtime filesystem](https://vercel.com/docs/functions/runtimes)

## Current published costs, not a selected-account quote

| Item | Public price / included usage | Practical consequence |
| --- | --- | --- |
| Vercel Hobby | $0, personal/noncommercial only; 1M function invocations,4CPU-hours and360GB-hours provisioned memory/month | Possible for an eligible personal project; reaching limits can stop service. |
| Vercel Pro | $20/month platform fee including one deploying seat and$20 usage credit | Existing team plan and incremental cost must be checked; usage/tax extra. |
| Turso Free | $0;5GB,500M rows read/month,10M written/month | Proposed first validation tier, subject to selected Marketplace quote/engine. |
| Turso Developer, monthly billing | $5.99/month;9GB,2.5B rows read,25M written; additional storage/rows billed | Optional later upgrade, not selected or purchased. Default pricing page shows annual-equivalent$4.99; monthly URL is explicit. |
| Neon Free | $0;1GB and100CU-hours/month per project; scale-to-zero | Native Marketplace alternative; quota exhaustion/cold starts affect availability. |
| Neon Launch | $0.106/CU-hour +$0.35/GB-month; history storage extra | Usage-based, not the page's illustrative$15/month fixed fee. |

Eligible Hobby+Turso Free has a$0 published base; Pro+Turso Free has a$20 base;
Pro+monthly Turso Developer has a$25.99 base, before additional usage/tax. No paid
upgrade is assumed. Provider list prices may differ from an account's Marketplace
SKU/quote. Read/write billing includes nonce cleanup, receipt validation and rate
queries, not just one row per pixel.
[Vercel Hobby](https://vercel.com/docs/plans/hobby),
[Vercel Pro](https://vercel.com/docs/plans/pro-plan),
[Turso monthly pricing](https://turso.tech/pricing?frequency=monthly),
[Neon pricing](https://neon.com/pricing),
[Neon no-minimum explanation](https://neon.com/blog/new-usage-based-pricing)

## Storage comparison and implementation boundary

**Turso/libSQL:** `@libsql/client/web` has asynchronous interactive
`transaction('write')`, mapped to `BEGIN IMMEDIATE`; writes serialize at the
primary. The documented5-second transaction timeout means short, bounded SQL
work and no external awaits inside a transaction. The HTTP driver avoids native
filesystem dependencies. Current Turso docs distinguish new Turso-engine
`@tursodatabase/serverless` from libSQL; do not substitute engines/drivers or use
the beta in-function SQLite package without a separately tested decision.
[TS transactions](https://docs.turso.tech/sdk/ts/reference),
[Vercel integration/engine selection](https://docs.turso.tech/integrations/vercel),
[Marketplace listing](https://vercel.com/marketplace/tursocloud)

**Neon:** native Marketplace provisioning/billing is available. For this
read-then-conditionally-write flow use `Pool`/`Client` interactive transactions;
the HTTP `neon().transaction()` is noninteractive. A port needs Postgres schema,
placeholder/null/integer validation, locking and migration changes. A consistent
database transaction/advisory lock would replace SQLite's writer serialization
for the global rate ceiling and per-account sequence; process memory cannot do
that. Close/release clients on all outcomes. Neither provider permits relying on
a JavaScript mutex across function instances.
[Neon Marketplace](https://vercel.com/marketplace/neon),
[driver transaction distinction](https://neon.com/docs/serverless/serverless-driver)

## Same protocol, durable across instances

Keep `src/protocol.ts` byte-exact: `rea-tracking-v1`, HMAC method+canonical
target+exact body, nonce/time,4096-byte body,2048-character target, and the existing
registration/receipt/event/cursor response shapes. The main client, frozen
delivery wire and read-import DTOs need no protocol change. The current synchronous
collector becomes an asynchronous service behind a transaction repository.
Its old Node/SQLite implementation stays available and frozen as an ancestor.

Preserve these database boundaries:

1. Authentication atomically validates the durable wall-clock watermark, expires
   old nonces and inserts the unique key/nonce before any signed route work.
   Invalid or ambiguous authentication cannot proceed into a mutation.
2. Registration save atomically checks exact old operation receipts, immutable
   binding, revision/state CAS and unique token/delivery, then writes binding,
   state, tenant revision and exact response receipt together. A lost COMMIT ACK
   stays uncertain; recover the exact operation with GET. No blind POST retry.
3. Pixel transaction atomically validates the registration/binding, global and
   per-token minute limits, throttle accounting and unique account sequence.
   No local counter or `max+1` outside the writer transaction. GET always awaits
   its bounded transaction before responding; no post-response background insert.
   Unknown/invalid/inactive/throttled/store-failed tokens still get the same GIF.
4. Event reads use a consistent database snapshot with the existing tenant
   revision, fixed sequence-through, confirmed binding, signed cursor and
   cumulative-throttle semantics. No read replica or stale cache can authorize
   CAS, receipt recovery or sequence allocation. The stable cursor key spans all
   instances/releases. Preserve clock-rollback fail-closed behavior; distributed
   wall-clock skew is an availability consideration, not permission to loosen it.

All durable tables live in the one remote database: metadata/clock watermark,
registrations, independent bindings, immutable requests, nonces, tenant revisions,
events and throttle totals. Schema initialization is an explicit release step,
not an image fetch or cold-start side effect. Health performs a bounded read of
the expected schema marker and no nonce/event write.

## Proposed source and configuration

Prepared target `apps/superhuman/collector-vercel/`: `src/index.ts`,
`src/config.ts`, `src/collector.ts`, `src/store-libsql.ts`, `migrations/001.sql`,
`vercel.json`, pinned package+lock, and socket-free protocol/concurrency tests.
Reuse the existing collector protocol by an own-source import. Prefer the
documented native **Express default export** at `src/index.ts`, with one
root-level middleware and no custom rewrites, router mounts, JSON parser,
trailing-slash redirects, frontend or static assets. Vercel documents that this
becomes one function. Capture native `req.url`/Express `req.originalUrl` before
any application routing, require agreement, and use those bytes rather than
`req.path`, `req.query`, decoded params or an original-URL header. Express retains
the original request URL, but this documentation does not prove Vercel's edge
preserves every noncanonical spelling; the signed positive/negative target
matrix remains required. [Vercel Express](https://vercel.com/docs/frameworks/backend/express),
[Express request semantics](https://expressjs.com/en/5x/api/request/#req.originalUrl)

No main API, Google/AI dependency or existing Render bootstrap is needed. The
adapter must preserve actual public path/query order and raw body,
reject duplicates/oversize/unrecognized targets/Origin/Cookie as now, validate
the exact production Host, and return no-store GIF/JSON. Platform rewrite
behavior must be verified rather than trusting a user-supplied original-URL
header. Function termination yields an uncertain mutation, never fake acceptance.

Production-only runtime inputs: exact `TRACKING_PUBLIC_ORIGIN`, database URL and
database-scoped runtime credential, dedicated signer JSON and separate cursor
key. Parse bounded secret strings directly into server memory; no files or
`NEXT_PUBLIC_*`, build arguments, browser secret or chat key. Stable signer and
cursor identity must survive deploys. The main app's already-reviewed local
`TRACKING_MAIN_SIGNER_FILE` path remains a local0600 file; the cloud function
never receives that path or the mail database. Nothing is configured now.

The operator needs the chosen Vercel team's project/deployment+environment permissions,
the selected Marketplace install/resource connection and database creation/schema
authority. A connected Turso account may require its own sign-in/authorization;
Neon native installation may provision its managed account/resource. Confirm the
one project's displayed scope and quote in that flow. No unrelated project,
workspace upgrade, payment, DNS or main credential is implied.
[Marketplace installation](https://vercel.com/docs/integrations/install-an-integration)

## Validation and operation before use

Implemented local controls cover: original serialized protocol vectors; two independent
clients racing nonce/revision/operation key; transaction rollback; commit ACK
loss+GET; exact account sequence/global limits; stable-key cold-start/cursor;
wrong Host/rewritten target/body; remote timeout before/after COMMIT; health and
secret-error sanitization. Local in-memory adapter tests alone do not prove a
remote provider's isolation or Vercel routing. Later authorized synthetic remote
checks must establish those properties before enabling real tracking.

Backup/restore changes to a consistent remote export/PITR plus separately secured
stable signer/cursor configuration. Do not use the Render filesystem copy helper.
Test an isolated restore for receipt recovery, nonce replay, registration identity
and an existing cursor. Code rollback retains the database and therefore requires
schema/key compatibility; it is not data rollback. No live database exists to
migrate from Render. Actual managed recovery and public TLS remain unverified.

Only opaque collector references/digests/timestamps and anonymous image-fetch
evidence reach storage. The ingress provider necessarily sees pixel requests;
image proxies/preloads do not prove human or named-recipient reads. No request
URLs/keys are deliberately printed. Vercel documents dashboard runtime logs with
plan-based retention; actual team log settings and provider internal retention
are unknown. No absence-of-provider-logs promise or new compliance gate is added.
[Function logs](https://vercel.com/docs/functions/logs)
