# Vercel collector — prepared for deployment

This is an asynchronous own-source collector with an HTTP libSQL adapter and a
native Express default export. It retains the existing `rea-tracking-v1` wire by
importing sibling `../collector/src/protocol.ts` byte-for-byte. The legacy
collector remains an unchanged comparison ancestor. This candidate has no mail,
Google, Calendar or model dependency and has made no remote database/resource,
real key, environment or deployment change.

The proposed first target is an eligible personal Vercel Hobby project plus
Turso Free/libSQL, with no paid upgrade. Actual account/team permission, exact
assigned origin, Marketplace engine, Free hard-stop/overages settings and region
are still deployment-time facts to verify. Public prices and the comparison with
Neon are in [the deployment proposal](deploy/PROPOSAL.md). No claim of hosted/effective
tracking or named/human-reader evidence follows from local tests.

## Source and dependencies

Pinned public npm metadata: `@libsql/client`0.18.0, `express`5.3.0 and
`@types/express`5.0.6, all MIT. The nested `package-lock.json` and private npm cache
are separate from the monorepo. Installation used `--ignore-scripts
--omit=optional --workspaces=false`; no native `.node` binary is installed. The
runtime imports only `@libsql/client/web`, never its filesystem SQLite entry.
Registry version/license/integrity metadata is retained outside this package.

The default export constructs only an Express routing object at import. It reads
no collector configuration/file/key/database and makes no network request until an invocation. Complete
runtime configuration is validated before SDK construction. One cached client
serves invocations; individual requests never close it. Every transaction owns
and closes its own SDK transaction, with no JS mutex as production authority.

## Runtime configuration and routing

Required server-only values, all explicit and bounded:

- `TRACKING_PUBLIC_ORIGIN`: exact stable HTTPS origin, no path/credentials/port.
- `TURSO_DATABASE_URL`: exact HTTPS or libSQL database authority ending
  `.turso.io`, without credentials/path/query/port.
- `TURSO_AUTH_TOKEN`: database credential, never browser-visible.
- `TRACKING_SIGNERS_JSON`:1–32 `{keyId,tenant,key}` entries; unique key ID,
 64hex tenant and32–64-byte lowercase hex signing key.
- `TRACKING_CURSOR_KEY`: separate32–64-byte lowercase hex key, stable across
  instances/releases.

No `.env` is loaded, no key is generated and no secret is materialized to a
function filesystem. The main application's private local signer-file loader is
unchanged. Production and preview must not share their resource/credentials.
No `NEXT_PUBLIC_*`, raw token URL or configuration is returned to the browser.

Vercel's native Express entry is `src/index.ts`; no custom rewrites or mounted
routers occur. First root middleware captures native `req.url`, requires exact
agreement with `req.originalUrl`, checks exact Host and reads the stream as raw
bytes up to4096. It rejects populated `req.body`, duplicate headers and unsupported
transport upgrades. It does not use parsed queries, decoded params, proxy/original
URL headers, redirects or reconstructed `/v1` prefixes as signature authority.
The canonical validator and HMAC receive the captured target unchanged.

`vercel.json` proposes Express, one `iad1` region,10s invocation limit and only
the canonical protocol as an explicit outside-root runtime include. The selected
Turso primary must be colocated or the region changed explicitly. Vercel project
Root Directory must be `apps/superhuman/collector-vercel`; the setting allowing
source imports outside that directory must permit the sibling own protocol.
Type-only Input/Output imports do not load the legacy SQLite module. A Node
filesystem-permission import probe succeeds with only the protocol and ancestor
package JSON readable outside this package. Actual Vercel build tracing and edge
normalization remain unverified; signed external target positive/negative tests
are required after an authorized deployment.

## Durable transactions and failure behavior

`database.ts` is the async storage interface. `store-libsql.ts` opens
`transaction('write')` for every authority unit, including private reads. All
helpers receive that same transaction, with no bare-client query inside it.
The adapter validates exact own table/index identities, expected marker and
`PRAGMA foreign_keys=1` **on that transaction/session**. It never tries to turn
foreign keys on inside BEGIN or assumes a PRAGMA on another HTTP connection
carries over. Rows, SQL values and safe integers are bounded and validated.

Authentication's durable nonce/clock unit remains separate from the following
route unit, as in the ancestor. Binding/state/tenant revision/exact receipt are
one atomic save. Pixel rate tests, sequence and event/throttle writes share one
transaction. Private GETs use primary transactions for consistent binding and
historical proof validation; no stale replica authorizes recovery or CAS.
The stable cursor format and cumulative throttle semantics are unchanged.

HTTP SDK requests are pinned to the configured database origin's `/v2/pipeline`,
without redirects, credentials in URLs or provider-supplied alternate origin.
Request/response bytes are bounded; each fetch has a4s AbortSignal. A local4.5s
unit deadline prevents starting a late COMMIT, within the documented libSQL5s
transaction window. No external/model await occurs inside the transaction.
SDK/network/COMMIT failure yields fixed unavailable output; an ACK loss never
becomes a fabricated receipt or automatic POST retry. Exact-key GET can recover
an accepted transaction later. Aborting a request or closing a service fences
unissued COMMIT; an already-issued remote commit can still finish and remains
uncertain to a disconnected caller. There is no detached write/cleanup job.

Public images keep the fixed no-store GIF through unknown/inactive/malformed,
throttled or store-failed cases. HEAD never records. Pixel failure is not proof
of absence of a read. Viewer remains null and evidence remains image-fetch.
`/healthz` checks marker readability only and writes nothing; it does not prove
TLS, isolation, persistence or a human read.

## Explicit schema operator

Runtime and cold start never migrate. `src/operator.ts:installSchema(client)` is
an explicitly called operator function, with no import-time file/config/DB work.
It reads own reviewed `migrations/001.sql` only when called, refuses a nonempty
database, checks foreign-key state on its transaction, batches the schema and
verifies it before COMMIT. There is no HTTP migration endpoint or auto-provision
by user-supplied name. The operator controls actual resource selection and invocation.

## Evidence and limits

The private reviewed V3 passed23 tests and all-source/test strict types. The
publication successor runs the same23 top-level tests, with only the private
predecessor counterfactual import/branch removed from the page-budget test. Its
positive100-page and all100 corruption/binding assertions remain unchanged. All tests use explicit
`:memory:` native SQLite and synthetic keys. Two actual pinned SDK clients send
HTTP protocol messages to an injected in-memory Hrana fixture, whose SQL runs on
native SQLite. It is no network server. Tests cover keyed/CAS/nonce concurrency,
rollback and FK/unique constraints, lost COMMIT ACK→fresh client GET, operator
refusal/adoption boundaries, credential-origin refusal, and in-process native
IncomingMessage/ServerResponse+Express over a memory Duplex. No listener is used.

Nineteen actual ancestor-vs-async serialized vectors cover lifecycle, historical
acceptance, current state, errors, uniform image bytes and signed cursor pages.
Independently random event UUIDs are checked for grammar and normalized only for
comparison; all other decoded event fields, headers and cursor bytes are compared.
This does not relabel the ancestor's45/53 tests as Vercel tests or establish actual
Turso/Vercel behavior. Initial test-harness setup mistakes (missing AST compiler
module, helper brace,19-vs18 vector count, fake HTTP response and nonce-vs-save
ACK-loss injection) were corrected; none is asserted as a product parity finding.

V2 successor batches selected registration fields into the event query after
same-transaction account-wide bidirectional binding checks. There is no per-event
SQL lookup. New controls use the actual SDK/Hrana transport with a virtual40ms
round-trip cost and a5s server transaction cutoff, without sleeping/network. A separately retained private predecessor control exceeded that cutoff; the
100-event public candidate fits within
16 round trips/640ms per unit. All100 registration shapes are independently
corrupted in turn; missing/mismatched/null-confirmation middle bindings retain
corrupt refusal rather than hiding evidence. No page-limit or cursor wire change.
This is a deterministic request-budget proof, not actual managed-database latency.

Independent source review passed. Actual selected engine/remote isolation/latency,
signed public raw-target routing, cold-start, backup/isolated restore and stable-origin
checks remain outstanding. No real tracked message has been sent or verified with
this collector. Retained predecessor and all23 ancestor files remain unchanged.

V3 clock audit is in [the clock audit](CLOCK-AUDIT.md). Durable timestamps are captured after
primary transaction acquisition, and signed age is checked again there and before
COMMIT. Save/read units also enforce the durable high watermark. Queued monotonic
pixels both persist; actual clock rollback and expired queued signatures still
refuse. The19 fixed-clock ancestor vectors remain exact. The retained V2 budget
test's diagnostic label is historical; on this V3 source its event unit uses
12 virtual40ms round trips/480ms because the fresh private-unit watermark adds
two queries, still below the unchanged16/640ms budget assertion.

Operator and deployment steps are in [the runbook](deploy/OPERATOR.md). The
repository sibling canonical protocol is the sole outside-project runtime import;
there is no private-directory or absolute user-filesystem path in this package.
