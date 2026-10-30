# Vercel cloud storage execution checkpoint

This records hosted infrastructure behavior, not original Superhuman behavior.
The separately reviewed all-Vercel runtime is based on commit
`5e6f030c7a7624efb2323a87bd64e89cda3b06de`. All 22 product feature families
remain open and unverified. The first worker activation failed during native
TLS initialization and was stopped; the corrected worker still needs deployed
Core verification. The canonical origin is not a usable hosted inbox yet.

## Observed platform behavior

| Evidence | Observation | Limits |
| --- | --- | --- |
| VC-20261030-01 | The combined Git Preview builds the static client, Node Function and Linux worker image. Scoping `type: module` to the root API directory fixes the observed CommonJS-to-ESM runtime failure. The authenticated Preview renders the deliberate mail-unavailable response; anonymous access redirects to authentication. | Preview has no Production mail configuration and does not execute the worker. An image build is not worker readiness. |
| VC-20261030-02 | A protected, unpromoted Production diagnostic connects to the dedicated remote mail primary in Linux x64 Node24.22.2. The server reports WAL and enabled foreign keys, but rejects setting `journal_mode=WAL`. | The first source-form diagnostic also failed on unresolved emitted imports; the subsequent JavaScript emission fixes that packaging issue. These failures are retained. |
| VC-20261030-03 | The explicit managed-WAL diagnostic passes transactions, savepoints, rollback, exact unsafe integer/BLOB bytes, FTS, trigger/FK behavior and a fresh connection. Owned cleanup passes; a later separate read confirms the user schema is empty and still reports WAL/FK. | This is a synthetic SQL compatibility proof, not real mailbox migration, provider sync or a backup/restore proof. Original Store startup still requires an explicit remote managed-WAL adaptation. |
| VC-20261030-04 | The dedicated control primary passes independent-client actor, same-key acceptance and claim races; expired ownership is not stolen; completed/uncertain receipts persist; explicit quiesced handoff advances epoch. A separate HTTP request verifies durability. Guarded cleanup then reports a fresh empty schema. | No Core, mail provider, model, Blob or persistent worker is involved. Synthetic ownership checks do not prove actual platform termination or deployment handoff. |
| VC-20261030-05 | The private-file diagnostic receives a successful authenticated SDK GET for the owned ten MiB fixture, but GET has no Content-Length and SDK metadata reports size0. The existing size guard refuses the read and preserves the pending fixture. | No content verification or deletion is claimed. No fifty MiB fixture was uploaded. A separately reviewed correction and repeated cloud transfer/cleanup proof remain required. |
| VC-20261030-06 | The first HEAD fallback refuses the live GET's non-strong validator. A later bounded observation confirms a weak GET ETag and strong HEAD representation. The digest-bound successor verifies all original ten MiB bytes and SHA, then acknowledges guarded deletion. | A weak validator is never treated as strong. The immutable/no-overwrite fixture premise remains; cleanup is not a new atomic conditional-delete protocol. Earlier refusals remain separate evidence. |
| VC-20261030-07 | The protected digest-bound diagnostic passes browser upload, authenticated SDK read, browser signed download and SHA verification for both ten and fifty MiB. Its guarded cleanup completes with an empty pending-fixture journal. | This proves Function OIDC, private-store transfer/CORS and exact synthetic content for that diagnostic. Actual Daemon OIDC, Core attachment storage and real mailbox operation remain separate checks. |

The original Blob diagnostic obscured its primary failure with a later cleanup
failure. Its observability successor keeps those failures separate. An independent
peer reproduced and corrected an observation-only incompatibility with the SDK's
actual Undici Headers class before that successor was deployed. Production
storage/deletion guards were unchanged during the observation.

## Evidence identity and configuration

All diagnostics use protected Production deployments with `--skip-domain`, no
daemon declarations and no promotion. The SQL managed-WAL source API SHA256 is
`4dc14cf6cc2b50c37434da018d3c6c55d916dee2f16c5ef240516c161b88d22d`.
The control emitted API SHA256 is
`111b18ed83b69bcf0e1ac33282f1767d837843de778682c4f4a1fecb033c3720`.
The corrected Blob observation helper SHA256 is
`fe05648fe9e7657f1156bff34e45df62959a037274592092f6d4a85d92011678`.
The final digest-bound production SDK SHA256 is
`2d9d92ea136308b049bfdcfae4a3448db950ce9d706d4959cd402d49a45ffddc`;
body transport is
`5457593f2b84c6d98010aad10ba6b2aa080d14ae89ecdb13f0c4b4051a8fdc67`.
Local source holds, compiled inventories, controls, failed runs, browser captures
and sanitized results are retained under ignored `.local/` directories.

The new control database is restricted to Production and distinct from mail
storage. The user approved both synthetic diagnostic deployments, their guarded
fixture cleanup, the server configuration transfer, and the prepared one GiB
worker's recurring usage. No credentials, real email, OAuth access/refresh tokens,
browser state or vendor binaries are part of this public record.

The first uploader acknowledged fifteen server configuration entries, then
stopped at the reserved TZ setting before attempting WEB_ORIGIN. Its original
unknown-outcome journal is retained. A separate no-overwrite reconciliation adds
only the absent WEB_ORIGIN and MAIL_REPLY_TIME_ZONE, using the original timezone
value. All seventeen settings are now acknowledged and fresh metadata confirms
sensitive Production-only scopes; the encryption key is preserved. No value
readback/equality verification is claimed. The scoped loader alias passes four
new controls and five existing configuration controls.

The user approved the canonical hosted Google callback as an additional OAuth
redirect. Google Cloud reports the client saved; the local callback remains.
Hosted authorization, token exchange and real provider use are still unverified.

## First worker boot and bounded empty-bootstrap recovery

The first promoted Production build at49895c5 starts exactly one one-GiB iad1
worker from its reviewed image. Its native Rust/libSQL connector panics while
loading the missing system certificate bundle. Node's bundled trust roots do
not supply the native driver's OS trust store. The owner was acquired before
that first mail connection, so it remains active with only its initial heartbeat;
expiry is not used to authorize takeover.

The service was explicitly scaled to zero. The original120-second stop grace
elapsed, and fresh complete scoped platform reads confirmed a persistent
all-region zero override and zero desired/ready/total instances. Vercel documents
all-region stopping and forced termination after grace for scale-down. This is
aggregate provider stop evidence, not an invented historical PID/instance death
record. A fresh mail-primary query confirmed zero user schema objects. The only
two queued commands were exact, never-claimed, empty-body bootstrap GETs; there
were zero issued/responded commands and zero staged body objects.

A separately reviewed one-incident atomic predicate changed only that exact
epoch-one owner's state to quiesced. It preserved every other owner field and
both queued reads, with fresh independent readback. No deletes, epoch rewriting,
requeueing, token copying or general dirty-takeover path was added. The console's
first leading-comment action was a no-op, resolved by a separate owner read and
a harmless read-only cursor control before a deliberate comment-free action
with renewed external proofs. The recovery SQL remains private and is not a
product endpoint. This schema-empty exception does not authorize recovery after
unknown provider effects or an initialized mailbox.

The corrected image installs Debian's trusted ca-certificates package in the
final stage and points Node's extra-CA setting to the same verified OS bundle;
TLS verification remains enabled. The worker now performs an exact guarded
read-only native WAL preflight and closes it before constructing control storage,
authority or Core. Actual Core still acquires authority before migrations and
uses its separate normal context guard.

The final focused gate passes137/137 across19 files with strict types,416 source
and26 support holds unchanged,19 zero-external-denial markers and109 loopback
calls. The full Linux/amd64 image was rebuilt and checked as UID1000 with a
read-only root, network disabled and synthetic temporary SQLite only. All148 OS
certificates parsed; the real native HTTPS connector returned a normal connection
error instead of panicking; the managed-WAL preflight read and closed normally.
Docker source and preflight peer reviews pass. Actual cloud Core startup and
Daemon storage/OIDC remain separate release gates.

## Remaining release gates

The explicit managed-WAL startup adaptation passes25 SQL/Store controls and one
worker configuration control, plus strict types and two independent actual
Core/actor controls. The same-connection WAL read and exact-prefix handling leave
the original Store SQL/default adapter unchanged. Those are local controls;
actual deployed Core startup remains a release gate.

The private-file correction takes a length/SHA binding from the validated durable
manifest before storage work. Bound streams check exact size and incremental SHA
at successful EOF; the upper caller still drains and double-checks before Core
dispatch. Missing-length reads use fresh authenticated exact-object HEAD metadata
with the same bounded length. The hash, rather than a weak HTTP validator,
establishes content identity. Unbound reads retain their strong-version guard.

The combined focused hosting gate passes131/131 across18 files with strict types,
415 source and26 support files exact before/after,18 zero-external-denial markers
and109 permitted loopback calls. The earlier126 gate remains historical. Four
independent successor controls verify full hash before Core effects/cleanup,
incorrect-content/metadata refusal and private trace projection. The first
sandbox loopback refusal is retained alongside the permitted passing run; no
unchanged broad API/frontend suite was repeated.

Publish the reviewed changes, then activate and verify the actual worker, stable
ownership/heartbeats and a clean deployment handoff. Use the registered canonical
Google callback for fresh hosted sign-in before real mail testing.

Native middle/context-click large downloads, unissued immediate Send behavior
during shutdown, dirty-worker recovery and the separate interaction candidate
remain explicit limits. Full UI, animation and feature parity remain unfinished.
