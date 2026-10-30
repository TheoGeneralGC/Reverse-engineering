import { createHash, randomBytes } from 'node:crypto';
import type { ControlSql, ControlTransaction, SqlRow } from './authority.ts';
import type { WireBody } from './command-log.ts';

export type BlobBody = Extract<WireBody, { kind: 'blob' }>;
export type BodyScope = { namespace: string; commandId: string; method: string; path: string };
export interface PrivateBlobPort {
  uploadGrant(pathname: string, bytes: number, expiresAt: number): Promise<{ url: string }>;
  downloadGrant(pathname: string, expiresAt: number): Promise<{ url: string }>;
  read(pathname: string): Promise<ReadableStream<Uint8Array> | null>;
  write(pathname: string, bytes: Uint8Array): Promise<void>;
  remove(pathname: string): Promise<void>;
}
export class BlobTransportError extends Error {
  readonly code: string; readonly status: number;
  constructor(code = 'invalid_transport_body', status = 400) {
    super('The file transfer could not be completed.'); this.code = code; this.status = status;
  }
}
function fail(code?: string, status?: number): never { throw new BlobTransportError(code, status); }
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const identifier = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : fail();
const fingerprint = (scope: BodyScope) => {
  identifier(scope.namespace); identifier(scope.commandId);
  if (!['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(scope.method) ||
      !/^\/api(?:[/?]|$)/.test(scope.path) || scope.path.length > 8192 || /[\x00-\x20\x7f\\#]/.test(scope.path)) fail();
  const url = new URL(scope.path, 'https://core.invalid');
  if (url.origin !== 'https://core.invalid' || url.pathname + url.search !== scope.path) fail();
  return digest(JSON.stringify([scope.namespace, scope.commandId, scope.method, scope.path]));
};

/** Temporary private transport storage. It never accepts a caller-supplied URL. */
export class PrivateBodyTransport {
  readonly namespace: string;
  private readonly sql: ControlSql; private readonly blob: PrivateBlobPort;
  private readonly now: () => number; private readonly quotaBytes: number;
  private readonly maxBodyBytes: number; private readonly lifetimeMs: number;
  constructor(options: { sql: ControlSql; blob: PrivateBlobPort; namespace: string; now?: () => number;
    quotaBytes?: number; maxBodyBytes?: number; lifetimeMs?: number }) {
    this.namespace = identifier(options.namespace); this.sql = options.sql; this.blob = options.blob;
    this.now = options.now ?? Date.now; this.quotaBytes = options.quotaBytes ?? 1024 ** 3;
    this.maxBodyBytes = options.maxBodyBytes ?? 64 * 1024 ** 2; this.lifetimeMs = options.lifetimeMs ?? 600_000;
    if (![this.quotaBytes, this.maxBodyBytes, this.lifetimeMs].every(Number.isSafeInteger) ||
        this.quotaBytes < 1 || this.quotaBytes > 1024 ** 3 || this.maxBodyBytes < 1 ||
        this.maxBodyBytes > 128 * 1024 ** 2 || this.lifetimeMs < 1000 || this.lifetimeMs > 3600_000) throw new TypeError('Invalid private transport configuration');
  }
  async initialize(): Promise<void> {
    await this.sql.execute(`CREATE TABLE IF NOT EXISTS runtime_body_objects(
      ref TEXT PRIMARY KEY, namespace TEXT NOT NULL, command_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('request','response')),
      pathname TEXT NOT NULL UNIQUE, digest TEXT NOT NULL, bytes INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('reserved','ready','bound','completed','uncertain','releasing','released')),
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`);
    await this.sql.execute('CREATE INDEX IF NOT EXISTS runtime_body_cleanup ON runtime_body_objects(namespace,state,expires_at)');
  }
  private bodyInput(bytes: number, sha256: string): void {
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > this.maxBodyBytes || !/^[a-f0-9]{64}$/.test(sha256)) fail();
  }
  private async reserve(scope: BodyScope, bytes: number, sha256: string, direction: 'request' | 'response'): Promise<SqlRow> {
    if (scope.namespace !== this.namespace) fail(); const hash = fingerprint(scope); this.bodyInput(bytes, sha256);
    const ref = randomBytes(24).toString('base64url'), at = this.now(), expires = at + this.lifetimeMs;
    const pathname = `mail-rpc/${digest(this.namespace).slice(0, 32)}/${ref}`;
    return this.sql.transaction(async tx => {
      const used = Number((await tx.execute("SELECT COALESCE(SUM(bytes),0) AS bytes FROM runtime_body_objects WHERE namespace=? AND state!='released'", [this.namespace])).rows[0]?.bytes ?? 0);
      if (!Number.isSafeInteger(used) || used + bytes > this.quotaBytes) fail('transport_staging_quota', 413);
      await tx.execute('INSERT INTO runtime_body_objects VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        [ref, this.namespace, scope.commandId, hash, direction, pathname, sha256, bytes, 'reserved', at, expires]);
      return { ref, namespace: this.namespace, command_id: scope.commandId, fingerprint: hash,
        direction, pathname, digest: sha256, bytes, state: 'reserved', created_at: at, expires_at: expires };
    });
  }
  private wire(row: SqlRow): BlobBody { return { kind: 'blob', ref: String(row.ref), sha256: String(row.digest), bytes: Number(row.bytes) }; }
  private async required(body: BlobBody, scope: Pick<BodyScope, 'namespace' | 'commandId'>, direction: 'request' | 'response', fullScope?: BodyScope, sql: ControlTransaction = this.sql): Promise<SqlRow> {
    identifier(scope.namespace); identifier(scope.commandId); this.bodyInput(body.bytes, body.sha256);
    if (scope.namespace !== this.namespace || !/^[A-Za-z0-9_-]{16,256}$/.test(body.ref)) fail();
    const row = (await sql.execute('SELECT * FROM runtime_body_objects WHERE ref=? AND namespace=? AND command_id=?', [body.ref, this.namespace, scope.commandId])).rows[0];
    const allowedStates = ['reserved', 'ready', 'bound', 'completed', 'released', ...(direction === 'request' ? ['uncertain'] : [])];
    if (!row || row.direction !== direction || !allowedStates.includes(String(row.state)) ||
        row.pathname !== `mail-rpc/${digest(this.namespace).slice(0, 32)}/${body.ref}` ||
        Number(row.bytes) !== body.bytes || row.digest !== body.sha256 ||
        fullScope && row.fingerprint !== fingerprint(fullScope)) fail('transport_body_not_available', 409);
    if (Number(row.expires_at) <= this.now() || row.state === 'released' || row.state === 'uncertain') {
      // Upload grants expire; accepted commands retain their immutable bodies.
      // A completed duplicate may still return its cached response after cleanup.
      if (direction !== 'request') fail('transport_body_not_available', 409);
      const command = (await sql.execute('SELECT request_json FROM runtime_commands WHERE namespace=? AND id=?', [this.namespace, scope.commandId])).rows[0];
      let saved: { method?: string; path?: string; body?: BlobBody } | undefined;
      try { saved = command ? JSON.parse(String(command.request_json)) : undefined; } catch { fail('transport_body_not_available', 409); }
      if (!saved || saved.body?.kind !== 'blob' || saved.body.ref !== body.ref || saved.body.sha256 !== body.sha256 ||
          saved.body.bytes !== body.bytes || fullScope && (saved.method !== fullScope.method || saved.path !== fullScope.path)) fail('transport_body_not_available', 409);
    }
    return row;
  }
  async createRequestUpload(scope: BodyScope, bytes: number, sha256: string): Promise<{ body: BlobBody; upload: { url: string; expiresAt: number } }> {
    // Only current large-body API families need direct upload grants.
    const path = new URL(scope.path, 'https://core.invalid').pathname;
    if (scope.method !== 'POST' || !(path === '/api/knowledge/sources/files' || /^\/api\/drafts\/[^/]+\/attachments$/.test(path))) fail();
    const row = await this.reserve(scope, bytes, sha256, 'request');
    const grant = await this.blob.uploadGrant(String(row.pathname), bytes, Number(row.expires_at));
    return { body: this.wire(row), upload: { url: grant.url, expiresAt: Number(row.expires_at) } };
  }
  async validateRequestBody(body: BlobBody, scope: BodyScope): Promise<void> { await this.required(body, scope, 'request', scope); }
  /** Call inside the command's acceptance transaction, before INSERT. */
  async authorizeRequestBody(tx: ControlTransaction, body: BlobBody, scope: BodyScope): Promise<void> {
    const row = await this.required(body, scope, 'request', scope, tx);
    if (row.state === 'released' || Number(row.expires_at) <= this.now()) fail('transport_body_not_available', 409);
    const changed = await tx.execute("UPDATE runtime_body_objects SET state='bound' WHERE ref=? AND state IN ('reserved','ready','bound')", [body.ref]);
    if (changed.rowsAffected !== 1) fail('transport_body_not_available', 409);
  }
  async readRequestBody(body: BlobBody, scope: BodyScope): Promise<Buffer> {
    const row = await this.required(body, scope, 'request', scope);
    if (row.state === 'released' || row.state === 'uncertain') fail('transport_body_not_available', 409);
    const stream = await this.blob.read(String(row.pathname)); if (!stream) fail('transport_upload_missing', 409);
    const reader = stream.getReader(), chunks: Buffer[] = []; let size = 0;
    try {
      while (true) { const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength; if (size > body.bytes) { await reader.cancel(); fail('transport_body_mismatch', 409); }
        chunks.push(Buffer.from(chunk.value)); }
    } finally { reader.releaseLock(); }
    const result = Buffer.concat(chunks, size);
    if (size !== body.bytes || digest(result) !== body.sha256) fail('transport_body_mismatch', 409);
    await this.sql.execute("UPDATE runtime_body_objects SET state='ready' WHERE ref=? AND state='reserved'", [body.ref]);
    return result;
  }
  async writeResponseBody(scope: BodyScope, bytes: Uint8Array): Promise<BlobBody> {
    const row = await this.reserve(scope, bytes.byteLength, digest(bytes), 'response');
    await this.blob.write(String(row.pathname), bytes);
    await this.sql.execute("UPDATE runtime_body_objects SET state='ready' WHERE ref=? AND state='reserved'", [row.ref]);
    return this.wire(row);
  }
  async responseDownload(body: BlobBody, scope: Pick<BodyScope, 'namespace' | 'commandId'>): Promise<{ url: string; expiresAt: number }> {
    const row = await this.required(body, scope, 'response');
    const expiresAt = Math.min(Number(row.expires_at), this.now() + 60_000);
    const grant = await this.blob.downloadGrant(String(row.pathname), expiresAt);
    return { url: grant.url, expiresAt };
  }
  async settle(commandId: string, state: 'completed' | 'uncertain'): Promise<void> {
    identifier(commandId);
    await this.sql.execute("UPDATE runtime_body_objects SET state=? WHERE namespace=? AND command_id=? AND state IN ('reserved','ready','bound')", [state, this.namespace, commandId]);
  }
  async cleanup(limit = 20): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Invalid transport cleanup limit');
    const rows = (await this.sql.execute(`SELECT body.ref FROM runtime_body_objects AS body
      WHERE body.namespace=? AND body.state IN ('reserved','ready','bound','completed','releasing') AND body.expires_at<=?
      AND NOT EXISTS(SELECT 1 FROM runtime_commands AS command WHERE command.namespace=body.namespace AND command.id=body.command_id AND command.state!='completed')
      ORDER BY body.expires_at,body.ref LIMIT ?`, [this.namespace, this.now() - 60_000, limit])).rows;
    let released = 0;
    for (const candidate of rows) {
      const row = await this.sql.transaction(async tx => {
        const value = (await tx.execute("SELECT * FROM runtime_body_objects WHERE ref=? AND namespace=? AND state IN ('reserved','ready','bound','completed','releasing') AND expires_at<=?", [candidate.ref, this.namespace, this.now() - 60_000])).rows[0];
        if (!value) return null;
        const busy = (await tx.execute("SELECT state FROM runtime_commands WHERE namespace=? AND id=? AND state!='completed'", [this.namespace, value.command_id])).rows.length;
        if (busy) return null;
        await tx.execute("UPDATE runtime_body_objects SET state='releasing' WHERE ref=?", [value.ref]);
        return value;
      });
      if (!row) continue;
      // Acceptance checks this marker under the same SQL transaction boundary.
      // A failed delete retains its quota and is safe to resume for this object.
      if (row.pathname !== `mail-rpc/${digest(this.namespace).slice(0, 32)}/${String(row.ref)}`) fail('transport_body_not_available', 409);
      await this.blob.remove(String(row.pathname));
      const result = await this.sql.execute("UPDATE runtime_body_objects SET state='released' WHERE ref=? AND namespace=? AND state='releasing'", [row.ref, this.namespace]);
      released += result.rowsAffected;
    }
    return released;
  }
}
