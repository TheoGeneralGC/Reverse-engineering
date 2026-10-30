import { createHash } from 'node:crypto';
import { ACTOR_FENCE_SQL, assertFenceRow, controlName, type ActorLease, type ControlSql, type ControlTransaction, type SqlRow } from './authority.ts';

export type WireBody = { kind: 'inline'; base64: string } | { kind: 'blob'; ref: string; sha256: string; bytes: number };
export type CommandRequest = { method: string; path: string; headers: Record<string, string>; body: WireBody };
export type CommandBodyScope = { namespace: string; commandId: string; method: string; path: string };
export type AuthorizeCommandBody = (transaction: ControlTransaction, request: CommandRequest, scope: CommandBodyScope) => Promise<void>;
export type CommandResponse = { status: number; headers: Record<string, string | string[]>; body: WireBody };
export type CommandState = 'queued' | 'claimed' | 'completed' | 'uncertain';
export type CommandResult = { id: string; sequence: number; state: CommandState; response?: CommandResponse };
export type ClaimedCommand = CommandResult & { namespace: string; state: 'claimed'; request: CommandRequest };
export class CommandLogError extends Error {
  readonly code: string; readonly status: number;
  constructor(code = 'invalid_worker_command', status = 400) { super('The mail request could not be processed.'); this.code = code; this.status = status; }
}
function invalid(): never { throw new CommandLogError(); }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const exact = (value: Record<string, unknown>, allowed: string[]) => { if (Object.keys(value).some(key => !allowed.includes(key))) invalid(); };
const id = (value: unknown): string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : invalid();
const integer = (value: unknown, min: number, max: number): number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : invalid();
const responseHeaders = new Set(['content-type', 'content-disposition', 'cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control',
  'x-vercel-enable-rewrite-caching', 'x-content-type-options', 'location', 'set-cookie', 'etag', 'last-modified', 'pragma', 'expires']);

export class DurableCommandLog {
  readonly sql: ControlSql; readonly namespace: string; readonly webOrigin: string;
  readonly maxInlineBytes: number; readonly maxBlobBytes: number; private readonly now: () => number;
  private readonly authorizeBody?: AuthorizeCommandBody;
  constructor(sql: ControlSql, options: { namespace: string; webOrigin: string; maxInlineBytes?: number; maxBlobBytes?: number; now?: () => number; authorizeBody?: AuthorizeCommandBody }) {
    this.sql = sql; this.namespace = controlName(options.namespace); this.webOrigin = options.webOrigin;
    let url: URL; try { url = new URL(this.webOrigin); } catch { throw new TypeError('Invalid mail origin'); }
    if (url.protocol !== 'https:' || url.origin !== this.webOrigin || url.username || url.password) throw new TypeError('Invalid mail origin');
    this.maxInlineBytes = integer(options.maxInlineBytes ?? 1_000_000, 1, 3_000_000);
    this.maxBlobBytes = integer(options.maxBlobBytes ?? 64 * 1024 * 1024, 1, 128 * 1024 * 1024);
    this.now = options.now ?? Date.now;
    if (options.authorizeBody !== undefined && typeof options.authorizeBody !== 'function') throw new TypeError('Invalid request body authority');
    this.authorizeBody = options.authorizeBody;
  }
  async initialize(): Promise<void> {
    await this.sql.execute(`CREATE TABLE IF NOT EXISTS runtime_commands(
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, namespace TEXT NOT NULL,
      fingerprint TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('queued','claimed','completed','uncertain')),
      request_json TEXT NOT NULL, claimed_epoch INTEGER, claimed_actor TEXT, response_json TEXT, response_hash TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(namespace,id))`);
    if (!(await this.sql.execute('PRAGMA table_info(runtime_commands)')).rows.some(row => row.name === 'response_hash')) await this.sql.execute('ALTER TABLE runtime_commands ADD COLUMN response_hash TEXT');
    await this.sql.execute('CREATE INDEX IF NOT EXISTS runtime_commands_waiting ON runtime_commands(namespace,state,seq)');
  }
  private body(value: unknown): WireBody {
    const body = object(value);
    if (body.kind === 'inline') {
      exact(body, ['kind', 'base64']);
      if (typeof body.base64 !== 'string' || body.base64.length > Math.ceil(this.maxInlineBytes / 3) * 4 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.base64)) invalid();
      const bytes = Buffer.from(body.base64, 'base64');
      if (bytes.length > this.maxInlineBytes || bytes.toString('base64') !== body.base64) invalid();
      return { kind: 'inline', base64: body.base64 };
    }
    if (body.kind === 'blob') {
      exact(body, ['kind', 'ref', 'sha256', 'bytes']);
      if (typeof body.ref !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(body.ref) ||
          typeof body.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.sha256)) invalid();
      return { kind: 'blob', ref: body.ref, sha256: body.sha256, bytes: integer(body.bytes, 1, this.maxBlobBytes) };
    }
    return invalid();
  }
  normalizeRequest(value: unknown): CommandRequest {
    const input = object(value); exact(input, ['method', 'path', 'headers', 'body']);
    if (typeof input.method !== 'string' || !['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(input.method)) invalid();
    if (typeof input.path !== 'string' || input.path.length > 8192 || !/^\/api(?:[/?]|$)/.test(input.path) || /[\x00-\x20\x7f\\#]/.test(input.path)) invalid();
    const parsed = new URL(input.path, 'https://core.invalid');
    if (parsed.origin !== 'https://core.invalid' || parsed.pathname + parsed.search !== input.path) invalid();
    const values = object(input.headers), headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(values).sort(([a], [b]) => a.localeCompare(b))) {
      if (key !== key.toLowerCase() || typeof value !== 'string' || value.length > 8192 || /[\x00-\x1f\x7f]/.test(value)) invalid();
      // Deliberately omit all caller credentials and all forwarded host hints.
      if (key === 'cookie') {
        const states = value.split(';').map(part => part.trim()).filter(part => part.startsWith('rea_oauth_state='));
        if (states.length > 1) invalid();
        if (states.length) {
          if (!/^rea_oauth_state=[A-Za-z0-9_-]{10,256}$/.test(states[0])) invalid();
          headers.cookie = states[0];
        }
      } else if (key === 'origin' || key === 'content-type') headers[key] = value;
    }
    if ((headers.origin !== undefined && headers.origin !== this.webOrigin) ||
        (!['GET', 'HEAD', 'OPTIONS'].includes(input.method) && headers.origin !== this.webOrigin)) throw new CommandLogError('worker_origin_not_allowed', 403);
    return { method: input.method, path: input.path, headers, body: this.body(input.body) };
  }
  normalizeResponse(value: unknown): CommandResponse {
    const input = object(value); exact(input, ['status', 'headers', 'body']);
    const status = integer(input.status, 200, 599), values = object(input.headers), headers: Record<string, string | string[]> = {};
    for (const [raw, value] of Object.entries(values)) {
      const key = raw.toLowerCase(); if (!responseHeaders.has(key)) continue;
      const list = Array.isArray(value) ? value : [value];
      if (!list.length || list.length > 16 || list.some(item => typeof item !== 'string' || item.length > 8192 || /[\x00-\x1f\x7f]/.test(item))) invalid();
      if (Array.isArray(value) && key !== 'set-cookie') invalid();
      headers[key] = key === 'set-cookie' ? list.map(item => /(?:^|;)\s*Secure(?:;|$)/i.test(String(item)) ? String(item) : `${item}; Secure`) : String(list[0]);
    }
    headers['cache-control'] = 'private, no-store, max-age=0'; headers['cdn-cache-control'] = 'no-store';
    headers['vercel-cdn-cache-control'] = 'no-store'; headers['x-vercel-enable-rewrite-caching'] = '0'; headers['x-content-type-options'] = 'nosniff';
    return { status, headers, body: this.body(input.body) };
  }
  async enqueue(input: { id: string; namespace: string; request: CommandRequest }): Promise<{ created: boolean; command: CommandResult }> {
    if (controlName(input.namespace) !== this.namespace) invalid(); const key = id(input.id), request = this.normalizeRequest(input.request), fingerprint = hash(request);
    return this.sql.transaction(async transaction => {
      const old = (await transaction.execute('SELECT * FROM runtime_commands WHERE namespace=? AND id=?', [this.namespace, key])).rows[0];
      if (old) { if (old.fingerprint !== fingerprint) throw new CommandLogError('worker_command_key_conflict', 409); return { created: false, command: this.result(old) }; }
      if (request.body.kind === 'blob') {
        if (!this.authorizeBody) throw new CommandLogError('worker_body_authority_required', 403);
        await this.authorizeBody(transaction, request, { namespace: this.namespace, commandId: key, method: request.method, path: request.path });
      }
      const stamp = integer(this.now(), 1, Number.MAX_SAFE_INTEGER);
      await transaction.execute("INSERT INTO runtime_commands(id,namespace,fingerprint,state,request_json,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?)", [key, this.namespace, fingerprint, JSON.stringify(request), stamp, stamp]);
      const row = (await transaction.execute('SELECT * FROM runtime_commands WHERE namespace=? AND id=?', [this.namespace, key])).rows[0];
      if (!row) throw new CommandLogError('worker_command_unavailable', 503); return { created: true, command: this.result(row) };
    });
  }
  async readResult(namespace: string, key: string): Promise<CommandResult | null> {
    if (controlName(namespace) !== this.namespace) invalid();
    const row = (await this.sql.execute('SELECT * FROM runtime_commands WHERE namespace=? AND id=?', [this.namespace, id(key)])).rows[0];
    return row ? this.result(row) : null;
  }
  private result(row: SqlRow): CommandResult {
    const state = String(row.state); if (!['queued', 'claimed', 'completed', 'uncertain'].includes(state)) throw new CommandLogError('worker_command_unavailable', 503);
    const response = row.response_json !== null ? this.normalizeResponse(JSON.parse(String(row.response_json))) : undefined;
    if (response && row.response_hash !== hash(response)) throw new CommandLogError('worker_command_corrupt', 503);
    return { id: id(row.id), sequence: integer(Number(row.seq), 1, Number.MAX_SAFE_INTEGER), state: state as CommandState, ...(response ? { response } : {}) };
  }
  async claimNext(lease: ActorLease): Promise<ClaimedCommand | null> {
    if (lease.namespace !== this.namespace) invalid();
    return this.sql.transaction(async transaction => {
      assertFenceRow(lease, (await transaction.execute(ACTOR_FENCE_SQL, [this.namespace])).rows[0]);
      const row = (await transaction.execute("SELECT * FROM runtime_commands WHERE namespace=? AND state='queued' ORDER BY seq LIMIT 1", [this.namespace])).rows[0];
      if (!row) return null;
      const request = this.normalizeRequest(JSON.parse(String(row.request_json)));
      if (hash(request) !== row.fingerprint) throw new CommandLogError('worker_command_corrupt', 503);
      const changed = await transaction.execute("UPDATE runtime_commands SET state='claimed',claimed_epoch=?,claimed_actor=?,updated_at=? WHERE namespace=? AND id=? AND state='queued'", [lease.epoch, lease.actorId, this.now(), this.namespace, String(row.id)]);
      if (changed.rowsAffected !== 1) throw new CommandLogError('worker_command_claim_conflict', 409);
      return { ...this.result({ ...row, state: 'claimed' }), namespace: this.namespace, state: 'claimed', request };
    });
  }
  async complete(lease: ActorLease, key: string, value: CommandResponse): Promise<void> { await this.finish(lease, key, 'completed', this.normalizeResponse(value)); }
  async markUncertain(lease: ActorLease, key: string): Promise<void> {
    await this.finish(lease, key, 'uncertain', this.normalizeResponse({ status: 503, headers: { 'content-type': 'application/json; charset=utf-8' },
      body: { kind: 'inline', base64: Buffer.from(JSON.stringify({ error: { code: 'worker_command_uncertain', message: 'The request could not be confirmed. Check its existing status before trying again.' } })).toString('base64') } }));
  }
  private async finish(lease: ActorLease, key: string, state: 'completed' | 'uncertain', response: CommandResponse): Promise<void> {
    if (lease.namespace !== this.namespace) invalid();
    await this.sql.transaction(async transaction => {
      assertFenceRow(lease, (await transaction.execute(ACTOR_FENCE_SQL, [this.namespace])).rows[0], { allowDraining: true });
      const changed = await transaction.execute(`UPDATE runtime_commands SET state=?,response_json=?,response_hash=?,updated_at=? WHERE namespace=? AND id=? AND state='claimed' AND claimed_epoch=? AND claimed_actor=?`,
        [state, JSON.stringify(response), hash(response), this.now(), this.namespace, id(key), lease.epoch, lease.actorId]);
      if (changed.rowsAffected !== 1) throw new CommandLogError('worker_command_completion_conflict', 409);
    });
  }
}
