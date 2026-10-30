/** Hosted control-plane SQL. Implementations must use the durable primary and
 * serialize transaction callbacks; an embedded replica is not an authority. */
export type SqlValue = null | string | number | bigint | Uint8Array;
export type SqlRow = Record<string, SqlValue>;
export type SqlResult = { rows: SqlRow[]; rowsAffected: number };
export interface ControlTransaction {
  execute(sql: string, args?: readonly SqlValue[]): Promise<SqlResult>;
}
export interface ControlSql extends ControlTransaction {
  transaction<T>(work: (transaction: ControlTransaction) => Promise<T>): Promise<T>;
}
export type ActorLease = Readonly<{ namespace: string; actorId: string; epoch: number }>;
export type ActorState = 'active' | 'draining' | 'quiesced' | 'uncertain';
export type ActorRow = ActorLease & { deploymentId: string; state: ActorState; leaseUntil: number; heartbeatAt: number };
export class ActorAuthorityError extends Error {
  readonly code: string;
  constructor(code = 'actor_authority_lost') { super('The mail worker is unavailable.'); this.code = code; }
}
export function controlName(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new TypeError('Invalid worker identity');
  return value;
}
function epoch(value: unknown): number {
  const number = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(number) || Number(number) < 1) throw new ActorAuthorityError();
  return Number(number);
}
function actorRow(row: SqlRow | undefined): ActorRow | null {
  if (!row) return null;
  if (!['active', 'draining', 'quiesced', 'uncertain'].includes(String(row.state))) throw new ActorAuthorityError();
  return { namespace: controlName(row.namespace), actorId: controlName(row.actor_nonce), epoch: epoch(row.epoch),
    deploymentId: controlName(row.deployment_id), state: row.state as ActorState,
    leaseUntil: epoch(row.lease_until_ms), heartbeatAt: epoch(row.heartbeat_ms) };
}
/** The synchronous Core adapter may call this after querying this row on its
 * primary connection. Calling it on a cached row is only a local gate. */
export function assertFenceRow(lease: ActorLease, row: SqlRow | undefined, options: { allowDraining?: boolean } = {}): ActorRow {
  const current = actorRow(row);
  if (!current || current.namespace !== lease.namespace || current.actorId !== lease.actorId || current.epoch !== lease.epoch ||
      (current.state !== 'active' && !(options.allowDraining && current.state === 'draining'))) throw new ActorAuthorityError();
  return current;
}
export const ACTOR_FENCE_SQL = 'SELECT * FROM runtime_actor WHERE namespace=?';

export class ActorAuthority {
  readonly sql: ControlSql; readonly namespace: string; readonly leaseMs: number;
  private readonly clock?: () => number;
  constructor(sql: ControlSql, options: { namespace: string; leaseMs?: number; now?: () => number }) {
    this.sql = sql; this.namespace = controlName(options.namespace); this.leaseMs = options.leaseMs ?? 30_000; this.clock = options.now;
    if (!Number.isSafeInteger(this.leaseMs) || this.leaseMs < 1000 || this.leaseMs > 300_000) throw new TypeError('Invalid worker lease duration');
  }
  async initialize(): Promise<void> {
    await this.sql.execute(`CREATE TABLE IF NOT EXISTS runtime_actor(
      namespace TEXT PRIMARY KEY, epoch INTEGER NOT NULL CHECK(epoch>0), actor_nonce TEXT NOT NULL,
      deployment_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('active','draining','quiesced','uncertain')),
      lease_until_ms INTEGER NOT NULL, heartbeat_ms INTEGER NOT NULL)`);
  }
  private async now(transaction: ControlTransaction): Promise<number> {
    const value = this.clock ? this.clock() : (await transaction.execute("SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS now_ms")).rows[0]?.now_ms;
    return epoch(value);
  }
  async current(): Promise<ActorRow | null> { return actorRow((await this.sql.execute(ACTOR_FENCE_SQL, [this.namespace])).rows[0]); }
  async acquire(actorId: string, deploymentId: string): Promise<{ acquired: true; lease: ActorLease } | { acquired: false; current: ActorRow }> {
    actorId = controlName(actorId); deploymentId = controlName(deploymentId);
    return this.sql.transaction(async transaction => {
      const old = actorRow((await transaction.execute(ACTOR_FENCE_SQL, [this.namespace])).rows[0]);
      // Expiry does not prove the old Gmail caller stopped. Only an explicit
      // drained/closed handoff permits advancement. There is no unsafe steal API.
      if (old && old.state !== 'quiesced') return { acquired: false as const, current: old };
      const stamp = await this.now(transaction), nextEpoch = (old?.epoch ?? 0) + 1;
      if (!Number.isSafeInteger(nextEpoch)) throw new ActorAuthorityError();
      if (old) await transaction.execute(`UPDATE runtime_actor SET epoch=?,actor_nonce=?,deployment_id=?,state='active',lease_until_ms=?,heartbeat_ms=? WHERE namespace=? AND state='quiesced' AND epoch=?`,
        [nextEpoch, actorId, deploymentId, stamp + this.leaseMs, stamp, this.namespace, old.epoch]);
      else await transaction.execute(`INSERT INTO runtime_actor VALUES(?,?,?,?,'active',?,?)`, [this.namespace, nextEpoch, actorId, deploymentId, stamp + this.leaseMs, stamp]);
      return { acquired: true as const, lease: Object.freeze({ namespace: this.namespace, actorId, epoch: nextEpoch }) };
    });
  }
  async assertCurrent(lease: ActorLease, options: { allowDraining?: boolean } = {}): Promise<ActorRow> {
    return assertFenceRow(lease, (await this.sql.execute(ACTOR_FENCE_SQL, [this.namespace])).rows[0], options);
  }
  async heartbeat(lease: ActorLease): Promise<void> {
    await this.sql.transaction(async transaction => {
      assertFenceRow(lease, (await transaction.execute(ACTOR_FENCE_SQL, [this.namespace])).rows[0], { allowDraining: true });
      const stamp = await this.now(transaction);
      await transaction.execute('UPDATE runtime_actor SET lease_until_ms=?,heartbeat_ms=? WHERE namespace=? AND epoch=? AND actor_nonce=?',
        [stamp + this.leaseMs, stamp, this.namespace, lease.epoch, lease.actorId]);
    });
  }
  async beginDrain(lease: ActorLease): Promise<void> { await this.transition(lease, 'active', 'draining'); }
  /** Caller must have drained callbacks/native work and closed Core first. */
  async quiesce(lease: ActorLease): Promise<void> { await this.transition(lease, 'draining', 'quiesced'); }
  async markUncertain(lease: ActorLease): Promise<void> {
    await this.sql.transaction(async transaction => {
      const row = actorRow((await transaction.execute(ACTOR_FENCE_SQL, [this.namespace])).rows[0]);
      if (!row || row.actorId !== lease.actorId || row.epoch !== lease.epoch || row.state === 'quiesced') throw new ActorAuthorityError();
      await transaction.execute("UPDATE runtime_actor SET state='uncertain' WHERE namespace=? AND epoch=? AND actor_nonce=?", [this.namespace, lease.epoch, lease.actorId]);
    });
  }
  private async transition(lease: ActorLease, from: ActorState, to: ActorState): Promise<void> {
    await this.sql.transaction(async transaction => {
      const row = actorRow((await transaction.execute(ACTOR_FENCE_SQL, [this.namespace])).rows[0]);
      if (!row || row.namespace !== lease.namespace || row.actorId !== lease.actorId || row.epoch !== lease.epoch || row.state !== from) throw new ActorAuthorityError();
      await transaction.execute('UPDATE runtime_actor SET state=? WHERE namespace=? AND epoch=? AND actor_nonce=? AND state=?', [to, this.namespace, lease.epoch, lease.actorId, from]);
    });
  }
}
