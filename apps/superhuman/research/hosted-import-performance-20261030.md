# Bounded hosted import database optimization

This change reduces repeated database work in contact/Split projections and three hot SELECT preparations. It does not establish full Superhuman parity, a hosted latency target or complete mailbox import.

## Implementation

Contact and Split people inserts use ordered JSON batches of at most64 rows/65536 UTF-8 bytes inside the existing atomic source/projection unit. Values whose JSON round trip would differ and oversized rows use the original singleton insertion path. Root/nested rollback and FTS consistency remain required.

The native SQL wrapper reuses preparation metadata for exactly three static SELECT templates only within the current consumed transaction segment, with at most three shared entries. It executes every read with fresh parameters and the existing authority guard. Ordinary statements, exec, errors, transaction/generation changes and close invalidate entries; neither results nor account/grant/owner authority are cached. The validated option is captured once. Default factories remain off; only the existing hosted child factory selects the literal option. Parent/preflight/Control behavior is unchanged.

## Evidence and validation

The frozen composition contains729 source paths, manifest `28fca0bf3a4af922f10878f01521457ee2aeca67b7c2eb818248677ddac142e2`; its ten-path patch is `d5514e6790e65f8ac9e3ca97a4346d831bf1744ec7d65a49aee90ea8dbc98dec`. The final affected gate passes228 controls across33 files plus strict types, with33 denial markers/zero external attempts. New composite controls and two independent native-memory purposes cover genuine later-batch constraint failures, full source/projection/FTS rollback, configuration refusal, fresh metadata/account incarnation and revoked-authority refusal.

Two actual local native HTTP import comparisons reduce sync requests1400→1301 and1434→1301. These are99/133 fewer requests, respectively:10/44 fewer INSERT runs plus89 fewer describes. Compared deterministic source/projection/schema snapshots and non-target logical calls/authority guards match. This measures local request counts, not Production speed. All7275 observed comparison requests were accounted;48 instrumented native connections closed and all16 owned import resources were removed.

A separate actual DurableCoreActor/child exercise records67 successful Control heartbeats, zero heartbeat errors, one held write completing once, a later queued read completed by the successor, and close acknowledgement plus observed normal child exit before quiescence. Exact fictional draft/token hashes survive epoch change. It uses owned servers and a trusted synthetic HTTP factory, not real Google credentials or Production TLS execution.

Pinned-driver schema metadata differences are retained rather than hidden: old unconsumed facades can retain their preparation snapshot, and own/external DDL cases have explicit refusal/readback outcomes. This is not arbitrary schema-concurrency equivalence or native handle GC proof. Independent review and private source/artifact holds are retained. A healthy Production deployment/handoff remains a separate release check.
