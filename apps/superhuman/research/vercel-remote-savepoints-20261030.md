# Remote savepoint startup correction

This is hosted-infrastructure evidence, not a comparison with original
Superhuman. All22 product feature families remain open and unverified.

The CA-corrected Production worker passed its native read-only WAL preflight,
acquired its second owner and then failed during Core construction. It was
scaled to zero. A valid primary audit found50 user schema objects and six
synthetic seed records, with no hosted credentials, OAuth states, Undo rows or
attachments. The preceding late empty-schema observation came from an expired
Studio session and is invalid for this failure.

## Reproduced behavior

RS-20261030-01: The actual pinned native libsql0.5.29 client against official
self-hosted sqld0.24.33 reproduces the same50-object/six-record prefix. A
standalone SAVEPOINT is lost across the next native call; the first failing
Core operation is RELEASE recipient_projection_refresh. Its subsequent
rollback cleanup also fails and obscures the first error. Explicit BEGIN with
nested savepoints passes. The Rust transaction-scope counter does not account
for standalone savepoints, allowing the HTTP stream to close between calls.

The executed Linux/amd64 server manifest is
`134f3a465ade779e417b258d8e4fbfa8ca0a3212a2dbe83457b2fa104b75d54a`.
The containers use an internal network, no published port, synthetic credentials
and temporary databases. Provider/model/storage requests are denied. This is a
concrete local remote-driver reproduction; it does not identify managed Turso's
exact server build.

## Correction and acceptance

The remote-primary factory now wraps separate top-level savepoints in an
explicit deferred transaction, preserves nested/nearest-name rollback behavior,
and commits that injected boundary when its root is released. Prepared statements
refresh across transaction-state boundaries. A fixed metadata read handles the
pinned client's stale autocommit flag after a failed statement without retrying
that statement. An uncertain injected begin/commit closes the connection.

Only complete supported transaction-control scripts are interpreted. The two
existing self-contained Core schema batches are accepted by exact SHA and sent
unchanged. Other mixed control scripts and transaction-control preparation are
rejected before mutation. Ordinary SQL, strings and trigger bodies are forwarded
unchanged. The default local adapter and Core source are unchanged.

RS-20261030-02: Twelve independent actual-remote transaction/prepared-statement
behaviors and six real Core write groups pass. Fresh Core creates224 schema
objects and13 demo conversations, returns bootstrap200 and quiesces. Nested
thread/contact/draft rollback, fresh-client durability, conditional conflict,
attachment/delete and injected lifecycle-failure controls pass, with zero
provider/native operations or model/storage fetches. That remote-tested wrapper SHA is
`5b7cd2712293d8a88653e126689ddfbbe438347a802f9545b270bb77b953c2bb`.
The final source additionally sets its closed flag when poisoning the connection,
preventing a reproduced second-close failure. That one-bit lifecycle correction
is covered by its retained failing control and passing successor; the remote
normal-path run above predates it. Final SQL SHA is
`a32acd8f26286d7faef292761ec5dc8d88950ce31ab71197df06bd62e4a336f1`.

RS-20261030-03: A separate reproduction of the partial initialized state starts
the corrected Core with224 schema objects, retaining exactly the same six source
records and one conversation. It does not reseed. Its initial Important view has
pending header coverage. The existing read action and its Undo both return200,
restore the exact source-record hash and complete the derived header index.
No custom repair endpoint, source-record replacement or manual SQL repair is
introduced.

## Initialized-state recovery boundary

A separate SELECT-only primary guard compares the exact50 schema type/name
identities and every row/column across all16 tables with the source-derived
synthetic failure boundary. Its actual result is global/schema/all-table match1;
it emits only match flags. It does not compare DDL text; value-set multiplicity
depends on the controlled source-proven keys. The worker remains stopped.

An independently reviewed one-incident control operation is prepared to change
only the exact second uncertain owner's state to quiesced. It requires fresh
whole-service zero-instance evidence after the original120-second stop grace,
continued replacement suppression, unchanged primary match and exactly three
never-claimed empty-body queued GETs. Mail records and control requests are
preserved. No expiry-based or generic dirty takeover is added. Root applied that
single state-only operation after renewed complete provider stop observations,
exact primary match and control preflight. Studio did not provide a usable
RETURNING acknowledgement. A separate SELECT confirmed the exact owner quiesced,
every other owner field unchanged, all three requests still never claimed and
zero body objects; another full primary guard remained match1. No write retry
was issued. This is exceptional initialized-bootstrap recovery, not graceful
drain or evidence of historical PID death.

The final focused gate passes156/156 across21 files with strict types. All419
source and26 support holds match before/after, with21 zero-external-denial
markers and109 permitted loopback calls. Manifest SHA is
`0c9f0038ad3582699f139efc5da020c8ebd34d989cd000dd0d8df2822a388b0b`;
test-log SHA is
`566430b6308cae790bdd88ad902eefc90b5efe61372f0d2059d9e57b57243f3a`.
The first strict-check command selected an absent candidate compiler path; its
failed setup log is retained. The corrected explicit installed compiler passes.
Independent source review finds no actionable blocker within the stated seam;
existing explicit-transaction error behavior is unchanged.

Raw SQL traces, captures, local fixtures and failed intermediate tests remain
private under ignored .local directories. No credentials or real mail are
included. Deployed Core startup, Daemon private-file access, clean replacement,
hosted OAuth and real-mail operation remain release gates.
