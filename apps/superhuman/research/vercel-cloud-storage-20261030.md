# Vercel cloud storage execution checkpoint

This records hosted infrastructure behavior, not original Superhuman behavior.
The separately reviewed all-Vercel runtime is based on commit
`5e6f030c7a7624efb2323a87bd64e89cda3b06de`. All 22 product feature families
remain open and unverified. No hosted mail worker has been activated at this
checkpoint, and the canonical origin is not a usable hosted inbox yet.

## Observed platform behavior

| Evidence | Observation | Limits |
| --- | --- | --- |
| VC-20261030-01 | The combined Git Preview builds the static client, Node Function and Linux worker image. Scoping `type: module` to the root API directory fixes the observed CommonJS-to-ESM runtime failure. The authenticated Preview renders the deliberate mail-unavailable response; anonymous access redirects to authentication. | Preview has no Production mail configuration and does not execute the worker. An image build is not worker readiness. |
| VC-20261030-02 | A protected, unpromoted Production diagnostic connects to the dedicated remote mail primary in Linux x64 Node24.22.2. The server reports WAL and enabled foreign keys, but rejects setting `journal_mode=WAL`. | The first source-form diagnostic also failed on unresolved emitted imports; the subsequent JavaScript emission fixes that packaging issue. These failures are retained. |
| VC-20261030-03 | The explicit managed-WAL diagnostic passes transactions, savepoints, rollback, exact unsafe integer/BLOB bytes, FTS, trigger/FK behavior and a fresh connection. Owned cleanup passes; a later separate read confirms the user schema is empty and still reports WAL/FK. | This is a synthetic SQL compatibility proof, not real mailbox migration, provider sync or a backup/restore proof. Original Store startup still requires an explicit remote managed-WAL adaptation. |
| VC-20261030-04 | The dedicated control primary passes independent-client actor, same-key acceptance and claim races; expired ownership is not stolen; completed/uncertain receipts persist; explicit quiesced handoff advances epoch. A separate HTTP request verifies durability. Guarded cleanup then reports a fresh empty schema. | No Core, mail provider, model, Blob or persistent worker is involved. Synthetic ownership checks do not prove actual platform termination or deployment handoff. |
| VC-20261030-05 | The private-file diagnostic receives a successful authenticated SDK GET for the owned ten MiB fixture, but GET has no Content-Length and SDK metadata reports size0. The existing size guard refuses the read and preserves the pending fixture. | No content verification or deletion is claimed. No fifty MiB fixture was uploaded. A separately reviewed correction and repeated cloud transfer/cleanup proof remain required. |

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

## Remaining release gates

The explicit managed-WAL startup adaptation passes25 SQL/Store controls and one
worker configuration control, plus strict types and two independent actual
Core/actor controls. The same-connection WAL read and exact-prefix handling leave
the original Store SQL/default adapter unchanged. Those are local controls;
actual deployed Core startup remains a release gate.

Complete the private-file metadata correction and independent review, repeat
cloud file verification/cleanup, and publish the reviewed changes. Then activate
and verify the actual worker, stable
ownership/heartbeats and a clean deployment handoff. Register the canonical Google
callback and obtain fresh hosted sign-in before real mail testing.

Native middle/context-click large downloads, unissued immediate Send behavior
during shutdown, dirty-worker recovery and the separate interaction candidate
remain explicit limits. Full UI, animation and feature parity remain unfinished.
