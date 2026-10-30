import { createHash } from 'node:crypto';
import type { SqlOperation } from './sql.ts';

export type CoreStartupStage = 'tracking-config' | 'auto-draft-config' | 'app-construction' | 'loopback-listen';
export type WorkerFailurePhase = 'acquire' | 'create-core' | 'heartbeat' | 'pump' | 'drain';
const stages = new Set(['tracking-config', 'auto-draft-config', 'app-construction', 'loopback-listen']);
const phases = new Set(['acquire', 'create-core', 'heartbeat', 'pump', 'drain']);
const operations = new Set(['exec', 'prepare', 'get', 'all', 'run']);
const sqliteCodes = new Set(['SQLITE_ERROR', 'SQLITE_INTERNAL', 'SQLITE_PERM', 'SQLITE_ABORT', 'SQLITE_BUSY', 'SQLITE_LOCKED', 'SQLITE_NOMEM',
  'SQLITE_READONLY', 'SQLITE_INTERRUPT', 'SQLITE_IOERR', 'SQLITE_CORRUPT', 'SQLITE_NOTFOUND', 'SQLITE_FULL', 'SQLITE_CANTOPEN', 'SQLITE_PROTOCOL',
  'SQLITE_EMPTY', 'SQLITE_SCHEMA', 'SQLITE_TOOBIG', 'SQLITE_CONSTRAINT', 'SQLITE_MISMATCH', 'SQLITE_MISUSE', 'SQLITE_AUTH', 'SQLITE_FORMAT', 'SQLITE_RANGE', 'SQLITE_NOTADB', 'SQLITE_UNKNOWN']);
const actorCodes = new Set(['actor_authority_lost', 'actor_already_owned', 'actor_not_quiescent']);
const controlCodes = new Set(['control_commit_uncertain', 'control_rollback_uncertain', 'control_result_invalid', 'control_closed',
  'control_transaction_closed', 'control_transaction_failed', 'control_nested_transaction_unsupported', 'control_close_during_transaction']);
const libsqlCodes = new Set(['STREAM_EXPIRED', 'TRANSACTION_CLOSED', 'HRANA_PROTO_ERROR', 'HRANA_CLOSED_ERROR', 'SERVER_ERROR', 'PROTOCOL_VERSION_ERROR']);
const threadCodes = new Set(['core_thread_failure', 'core_thread_protocol_invalid', 'core_thread_exited', 'core_thread_authority_lost', 'core_thread_start_failed']);
type SqlDescriptor = Readonly<{ ordinal: number; kind: SqlOperation['kind']; sha256: string }>;

/** Shared fixed-code projection for worker logs and IPC. Never inspect private
 * messages, stacks, causes or arbitrary enumerable fields. */
export function safeWorkerErrorCode(error: unknown): string | undefined {
  try {
    const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
    return typeof code === 'string' && (sqliteCodes.has(code) || actorCodes.has(code) || controlCodes.has(code) || libsqlCodes.has(code) || threadCodes.has(code)) ? code : undefined;
  } catch { return undefined; }
}

/** Only constructor SQL is fingerprinted; no parameters or SQL text escape. */
export class CoreStartupDiagnostic {
  private active = false;
  private stage?: CoreStartupStage;
  private ordinal = 0;
  private lastSql?: SqlDescriptor;
  begin(): void { this.clear(); this.active = true; }
  observeStage(stage: CoreStartupStage): void { if (this.active && stages.has(stage)) this.stage = stage; }
  observeSql(operation: SqlOperation): void {
    if (!this.active || !operations.has(operation.kind) || typeof operation.sql !== 'string') return;
    this.lastSql = Object.freeze({ ordinal: ++this.ordinal, kind: operation.kind, sha256: createHash('sha256').update(operation.sql).digest('hex') });
  }
  /** The child hashes constructor SQL before IPC. Preserve that hash unchanged;
   * no SQL text or caller-controlled ordinal is accepted at this boundary. */
  observeSqlFingerprint(fingerprint: unknown): void {
    if (!this.active || !fingerprint || typeof fingerprint !== 'object' || Array.isArray(fingerprint)) return;
    try {
      const { kind, sha256 } = fingerprint as { kind?: unknown; sha256?: unknown };
      if (typeof kind !== 'string' || !operations.has(kind) || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) return;
      this.lastSql = Object.freeze({ ordinal: ++this.ordinal, kind: kind as SqlOperation['kind'], sha256 });
    } catch { /* Malformed observation cannot alter construction or logging. */ }
  }
  clear(): void { this.active = false; this.stage = undefined; this.ordinal = 0; this.lastSql = undefined; }
  snapshot(): Readonly<{ stage?: CoreStartupStage; lastSql?: SqlDescriptor }> {
    return this.active ? Object.freeze({ stage: this.stage, lastSql: this.lastSql }) : Object.freeze({});
  }
}

type FailureIdentity = { namespace: unknown; actorId: unknown; deploymentId: unknown; epoch?: unknown };
/** Fixed projection only. Never inspect error.message, stack, cause or config. */
export function reportWorkerFailure(phase: WorkerFailurePhase, error: unknown, identity: FailureIdentity,
  startup?: CoreStartupDiagnostic, logger: (line: string) => void = line => console.error(line)): void {
  try {
    const record: Record<string, unknown> = { event: 'mail_worker_failure', phase: phases.has(phase) ? phase : 'unknown', errorKind: 'unknown' };
    if (typeof identity.namespace === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(identity.namespace)) record.namespace = identity.namespace;
    if (typeof identity.actorId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(identity.actorId)) record.actorId = identity.actorId;
    if (typeof identity.deploymentId === 'string' && /^dpl_[A-Za-z0-9]{1,128}$/.test(identity.deploymentId)) record.deploymentId = identity.deploymentId;
    if (Number.isSafeInteger(identity.epoch) && Number(identity.epoch) >= 1) record.epoch = identity.epoch;
    try { if (error instanceof TypeError) record.errorKind = 'type'; else if (error instanceof RangeError) record.errorKind = 'range'; else if (error instanceof Error) record.errorKind = 'error'; } catch {}
    const code = safeWorkerErrorCode(error);
    if (code !== undefined) {
      record.code = code;
      record.errorKind = sqliteCodes.has(code) ? 'sqlite' : actorCodes.has(code) ? 'actor' : controlCodes.has(code) ? 'control' : libsqlCodes.has(code) ? 'libsql' : 'thread';
    }
    const snapshot = startup?.snapshot();
    if (snapshot?.stage && stages.has(snapshot.stage)) record.coreStage = snapshot.stage;
    const sql = snapshot?.lastSql;
    if (sql && Number.isSafeInteger(sql.ordinal) && sql.ordinal > 0 && operations.has(sql.kind) && /^[a-f0-9]{64}$/.test(sql.sha256)) record.lastSql = { ordinal: sql.ordinal, kind: sql.kind, sha256: sql.sha256 };
    logger(JSON.stringify(record));
  } catch { /* Diagnostics must never alter ownership, shutdown or error flow. */ }
}
