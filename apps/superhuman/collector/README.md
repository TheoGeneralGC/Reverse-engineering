# Tracking image collector

This independent optional service provides anonymous image-fetch evidence to the
local mail application. It has not been publicly deployed or verified against
Superhuman's remote event transport. Read [the research record](../research/read-tracking.md)
and [the main integration contract](../api/TRACKING-DELIVERY.md). Earlier failed
local candidates remain retained in private evidence; the source below passed
bounded owner and independent checks. No full original parity is claimed.

The dependency-free Node24 service uses SQLite and only opaque random references.
It has no Google/Claude credentials, email bodies, subjects, addresses, remote
fetch, cookies, CORS or browser authentication. Bind one installation's keys only
to that installation and tenant. Mailbox account authorization belongs to the
main app, which must never expose collector keys to its browser client.

## Lifecycle and integration boundary

1. The main mail service generates a32-byte random base64url token, stores it
   privately in a frozen delivery generation, and registers its SHA256 digest.
2. Create state is `prepared`. It records no image events. Only after a durable
   mail-dispatch claim may the main service change it to `armed`, before Send.
3. Image fetches while armed are provisional. Event reads exclude the registration
   until the main service supplies `confirmed` and an opaque hash of its exact
   acknowledged provider identity. A fetch never confirms delivery.
4. `disabled` is terminal and cannot arm again. Previously confirmed events remain
   readable; disabling an unconfirmed/unknown generation does not invent Sent.

Transitions and initial registration use CAS revisions and exact keyed receipts.
Repeated identical bytes under the same operation ID return the original receipt;
different bytes conflict. GET `/v1/requests/:operationId` recovers historical
acceptance without another mutation. A404 after uncertain transport is unresolved.
GET `/v1/registrations/:registrationId` returns current state. Main integration
must compare the exact frozen intent and not adopt another generation.

## Signed server API

Use `signedHeaders` from `src/protocol.ts`. HMAC-SHA256 covers protocol, key ID,
method, canonical path/query, millisecond timestamp,24-byte random nonce and exact
body digest. A5-minute clock window and durable nonce records prevent replay,
including after restart. Retry with a new nonce only for an explicitly reviewed
idempotent intent; main delivery policy may require GET-only reconciliation.
Private API requests have exact JSON content type and no Cookie or Origin.
Nonces expire after10minutes; accepted receipts and events are not auto-pruned.
A durable clock high watermark rejects authenticated work after wall-clock
rollback until the clock catches up. Expired nonce cleanup therefore cannot make
an old accepted signature replayable after time moves backwards. Public image
appearance stays independent of that failure, and no event is recorded then.

- POST `/v1/registrations`: exact keys `operationId`, `registrationId` (32hex),
  `accountRef`, `deliveryRef`, `tokenDigest` (64hex), `state:"prepared"`,
  `expectedRevision:0`.
- POST `/v1/registrations/:registrationId`: exact keys `operationId`,
  `expectedRevision`, `state`, `acknowledgementRef`. The latter is64hex for
  confirmation and null otherwise. Prepared→armed/disabled,
  armed→confirmed/disabled, confirmed→disabled are the only transitions.
- GET `/v1/events?accountRef=...&cursor=...&limit=...`: sorted canonical query,
  unique recognized keys, limit1–100. Events are account/tenant scoped; signed
  snapshot cursors exclude later arrivals, reject another account and reject
  changed registration context. Raw data says `image-fetch`, viewer null,
  coarse device/proxy hints, and `humanReadVerified:false`.

Per-token and aggregate event rates are bounded (default16/token/minute and
10,000total/minute). Authenticated coverage reports dropped events. This is a
local policy, not an observed Superhuman dedupe/retention rule. Projection and
human-readable grouping belong to the separate mail UI. No raw IP, user agent,
email claim, token or arbitrary header is stored. Public token query hints are
ignored, not trusted as recipient identity. Proxy classification is heuristic.

## Public image ingress

GET/HEAD `/p/:token.gif` returns a fixed1×1 image with no-store headers for known,
unknown, malformed, inactive and throttled tokens. HEAD, invalid spelling,
queries and nonempty bodies never add events. Other methods fail. There is no
token-existence or mail metadata response. This promise concerns response shape;
it does not claim constant database timing or protection against a proxy cache.
Preloading and privacy proxies can fetch images without a human reading mail.
Collector write failures preserve the same public response and do not prove
absence of a read. No image-fetch event triggers a push notification.

## Run and deployment preparation

Run tests with pinned Node24:
`node --experimental-strip-types --test test/*.test.ts`.
The exported factory never reads environment or binds a port at import. Explicit
`:memory:` or absolute own database path is required.

The CLI requires all of:

- `TRACKING_DATABASE_PATH`: a normalized absolute path on durable local storage,
  with no NUL. The existing parent must be canonical (`realpath(parent)` equals
  the configured parent), and an existing database leaf must be a regular file,
  not a symlink. Resolve platform aliases such as `/var` versus `/private/var`
  explicitly when configuring the service.
- `TRACKING_SIGNERS_FILE`: absolute0600 regular JSON file containing an array of
  `{keyId,tenant,key}`. Tenant is64hex, key is32–64random bytes encoded as hex.
- `TRACKING_CURSOR_KEY_FILE`: absolute0600 regular text file with a separate
 32–64byte lowercase ASCII hex key, with at most one optional LF/CRLF terminator.
  High-bit bytes and other whitespace are refused before opening the database.
  Keep it stable across restarts for existing cursors.
- `TRACKING_PUBLIC_ORIGIN`: the stable HTTPS origin owned by this project.
- Optional `TRACKING_PORT` (default3013; integer1024–65535).
- Optional `TRACKING_LISTEN_HOST` defaults to127.0.0.1. The only other accepted
  value,0.0.0.0, requires an explicit canonical HTTPS public origin for a managed
  TLS proxy. The proxy must preserve that origin's Host. One exact local origin
  `http://127.0.0.1:PORT` is accepted only with loopback binding for local tests.

Launch `node --experimental-strip-types src/server.ts` with explicit environment.
Restrict the data directory and backups to the service owner; database file is
0600. The proxy must impose connection/request/rate limits, preserve exact paths
and query order, avoid access-log token paths, and not cache image responses.
No domain, hosting resource, real service key or real token has been created here.
A stable public HTTPS deployment, main-app integration, independent review,
live fixture and original UI comparison remain required for working tracking.

## Environment-only managed platforms

`node --experimental-strip-types src/bootstrap.ts` accepts the same explicit
listener/database configuration, replacing the two secret file inputs with:

- `TRACKING_BOOTSTRAP_SIGNERS_JSON`: the exact signer array described above.
- `TRACKING_BOOTSTRAP_CURSOR_KEY`: the separate32–64byte hex cursor key.
- Optional `TRACKING_CONFIG_REVISION`: a1–48character directory label containing
  only letters, digits, underscores and hyphens; defaults to `initial`.

The bootstrap validates endpoint configuration and secret formats before writing
files. The durable database's canonical parent directory must already exist. It creates
`.collector-private/REVISION` beneath that directory with0700 permissions and
0600 signer/cursor files. Existing symlinks, permissive files, or different key
bytes are refused. Both existing targets are checked before either missing file
is created. Exact repeat startup leaves key-file bytes and mtimes unchanged.
It never generates keys or replaces existing keys. The returned runtime env copy
omits the bootstrap values; this does not erase the host process environment or
the hosting provider's secret storage. Do not configure file inputs and bootstrap
inputs together. Preserve old signing and cursor keys during deliberate rotation;
changing a revision label does not migrate registrations or cursor identity.

## Health, backups, and deployment proof

GET/HEAD `/healthz` returns204 only while the collector is open and its schema
marker remains readable, otherwise503. It preserves the exact Host/body bounds,
uses no-store, returns no credential or account metadata, and adds no nonce,
registration or image-event records. This is a readability/liveness probe. It
does not establish authenticated writes, public TLS, durable restart behavior,
mail dispatch, or human reads. Platform probe Host must match the configured
public origin; do not weaken Host validation to accommodate an unchecked probe.

Use one process and one persistent disk for this SQLite candidate. The entire
data directory, including SQLite sidecars and private keys, requires a consistent
backup. Stop the service for an offline backup, or use SQLite's backup API rather
than copying a live main file alone. Backups contain private opaque metadata and
keys and must stay access restricted. A restore must be tested in an isolated
environment before relying on it. One stopped synthetic collector-factory
directory copy/restore test preserves accepted receipts, an existing event cursor
and replay protection with stable private keys. It does not verify a managed
platform snapshot, offsite recovery, encryption or copying a live database.

Before the first real tracked message, verify public TLS and exact Host, a signed
synthetic registration lifecycle, unreadable/wrong-key failure, no public metadata
oracle, and persistence across an owned restart. Disable route/access logs that
would retain `/p/TOKEN.gif` paths. This program logs no request URL or key; a
provider's edge logs require separate inspection. Do not use an expiring tunnel
as the permanent origin embedded in real email.

The CLI requires durable absolute storage; only the explicit factory accepts
`:memory:` for tests. The v2 database marker refuses other schemas, including
views/triggers, before journal/schema changes. V1 prototype databases are not
silently adopted. A separate binding record freezes registration identity and
the once-confirmed acknowledgement; current/history/event reads fail on
contradictory stored identities. Persisted tenant revisions are validated before
they can anchor receipt pages. These are local reliability policies, not a
vendor protocol or a claim of resistance to an attacker who can rewrite all
database records and integrity bindings together.
Event reads check both sides of account bindings before filtering eligible
events; a damaged confirmation field cannot silently remove retained history.
