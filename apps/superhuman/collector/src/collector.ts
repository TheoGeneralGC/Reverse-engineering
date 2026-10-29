import { createHmac, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import { CLOCK_SKEW_MS, CollectorError, HEX, IDENTIFIER, MAX_BODY, MAX_TARGET, canonicalTarget, equalHex, exactObject, requireValue, sha256, signature } from './protocol.ts';

type State = 'prepared' | 'armed' | 'confirmed' | 'disabled';
type Registration = { tenant: string; id: string; account_ref: string; delivery_ref: string; token_digest: string; state: State; revision: number; ack_ref: string | null; confirmed_at: number | null; created_at: number; updated_at: number };
type Signer = { tenant: string; key: Buffer };
export type CollectorOptions = { databasePath: string; signers: ReadonlyMap<string, Signer>; cursorKey: Buffer; now?: () => number; maxEventsPerTokenMinute?: number; maxEventsPerMinute?: number };
export type Input = { method: string; target: string; headers: Record<string, string | undefined>; body?: Buffer };
export type Output = { status: number; headers: Record<string, string>; body: Buffer };
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const SAFE_HEADERS = { 'cache-control': 'no-store, no-cache, must-revalidate, private', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" };
const json = (status: number, value: unknown): Output => ({ status, headers: { ...SAFE_HEADERS, 'content-type': 'application/json; charset=utf-8' }, body: Buffer.from(JSON.stringify(value)) });
const pixel = (head: boolean): Output => ({ status: 200, headers: { ...SAFE_HEADERS, 'content-type': 'image/gif', 'content-length': String(PIXEL.length) }, body: head ? Buffer.alloc(0) : Buffer.from(PIXEL) });
const objectJson = (body: Buffer) => { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); } catch { throw new CollectorError(400, 'invalid_json'); } };
const number = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const fixedHex = (value: unknown, pattern = HEX): value is string => typeof value === 'string' && pattern.test(value);
const serialize = (r: Registration) => ({ registrationId: r.id, accountRef: r.account_ref, deliveryRef: r.delivery_ref, tokenDigest: r.token_digest, state: r.state, revision: r.revision, acknowledgementRef: r.ack_ref, confirmedAt: r.confirmed_at, createdAt: r.created_at, updatedAt: r.updated_at });

/** Independent opaque tracking ingress. Never reads mail, calls a network service, or dispatches a message. */
export function createCollector(options: CollectorOptions) {
  requireValue(options.databasePath === ':memory:' || isAbsolute(options.databasePath), 500, 'explicit_database_required');
  requireValue(options.cursorKey.length >= 32 && options.cursorKey.length <= 64 && options.signers.size > 0 && options.signers.size <= 32, 500, 'invalid_key_configuration');
  const signers = new Map<string, Signer>();
  for (const [id, value] of options.signers) {
    requireValue(/^[a-zA-Z0-9_-]{1,48}$/.test(id) && fixedHex(value.tenant) && value.key.length >= 32 && value.key.length <= 64, 500, 'invalid_key_configuration');
    signers.set(id, { tenant: value.tenant, key: Buffer.from(value.key) });
  }
  const cursorKey = Buffer.from(options.cursorKey), clock = options.now ?? Date.now;
  const perToken = options.maxEventsPerTokenMinute ?? 16, globalLimit = options.maxEventsPerMinute ?? 10_000;
  requireValue(number(perToken) && perToken > 0 && perToken <= 1000 && number(globalLimit) && globalLimit > 0 && globalLimit <= 100_000, 500, 'invalid_rate_configuration');
  const db = new DatabaseSync(options.databasePath);
  try {
    const objects=db.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
    const expectedTables=['tracking_meta','tracking_registrations','tracking_bindings','tracking_requests','tracking_nonces','tracking_tenant_revisions','tracking_events','tracking_throttle'];
    const tables=objects.filter(row => row.type === 'table').map(row => row.name as string);
    requireValue(!objects.length || (tables.length === expectedTables.length && expectedTables.every(name => tables.includes(name)) && objects.every(row => row.type === 'table' || row.type === 'index' && ['tracking_registration_account','tracking_events_rate'].includes(row.name as string)) && db.prepare("SELECT value FROM tracking_meta WHERE key='schema'").get()?.value === 'rea-tracking-collector-v2'),500,'collector_database_identity_mismatch');
  } catch {
    db.close();throw new CollectorError(500,'collector_database_identity_mismatch');
  }
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS tracking_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT OR IGNORE INTO tracking_meta VALUES('schema','rea-tracking-collector-v2');
    CREATE TABLE IF NOT EXISTS tracking_registrations(
      tenant TEXT NOT NULL,id TEXT NOT NULL,account_ref TEXT NOT NULL,delivery_ref TEXT NOT NULL,
      token_digest TEXT NOT NULL UNIQUE,state TEXT NOT NULL CHECK(state IN ('prepared','armed','confirmed','disabled')),
      revision INTEGER NOT NULL,ack_ref TEXT,confirmed_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
      PRIMARY KEY(tenant,id),UNIQUE(tenant,delivery_ref));
    CREATE INDEX IF NOT EXISTS tracking_registration_account ON tracking_registrations(tenant,account_ref);
    CREATE TABLE IF NOT EXISTS tracking_bindings(tenant TEXT NOT NULL,id TEXT NOT NULL,account_ref TEXT NOT NULL,delivery_ref TEXT NOT NULL,token_digest TEXT NOT NULL,created_at INTEGER NOT NULL,ack_ref TEXT,confirmed_at INTEGER,PRIMARY KEY(tenant,id),FOREIGN KEY(tenant,id) REFERENCES tracking_registrations(tenant,id));
    CREATE TABLE IF NOT EXISTS tracking_requests(tenant TEXT NOT NULL,operation_id TEXT NOT NULL,fingerprint TEXT NOT NULL,request_path TEXT NOT NULL,request_json TEXT NOT NULL,response_json TEXT NOT NULL,accepted_at INTEGER NOT NULL,PRIMARY KEY(tenant,operation_id));
    CREATE TABLE IF NOT EXISTS tracking_nonces(key_id TEXT NOT NULL,nonce TEXT NOT NULL,used_at INTEGER NOT NULL,PRIMARY KEY(key_id,nonce));
    CREATE TABLE IF NOT EXISTS tracking_tenant_revisions(tenant TEXT PRIMARY KEY,revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tracking_events(
      tenant TEXT NOT NULL,account_ref TEXT NOT NULL,sequence INTEGER NOT NULL,id TEXT NOT NULL UNIQUE,registration_id TEXT NOT NULL,
      observed_at INTEGER NOT NULL,device TEXT NOT NULL,proxy TEXT NOT NULL,PRIMARY KEY(tenant,account_ref,sequence),
      FOREIGN KEY(tenant,registration_id) REFERENCES tracking_registrations(tenant,id));
    CREATE INDEX IF NOT EXISTS tracking_events_rate ON tracking_events(observed_at,registration_id);
    CREATE TABLE IF NOT EXISTS tracking_throttle(tenant TEXT NOT NULL,account_ref TEXT NOT NULL,minute INTEGER NOT NULL,dropped INTEGER NOT NULL,PRIMARY KEY(tenant,account_ref,minute));`);
  function transaction<T>(run: () => T): T { db.exec('BEGIN IMMEDIATE'); try { const result = run(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  const now = () => { const value = clock(); requireValue(number(value), 500, 'invalid_clock'); return value; };
  function validateRegistration(r: Registration): Registration {
    const good = (value: unknown) => requireValue(value,500,'collector_artifact_corrupt');
    good(fixedHex(r.tenant) && fixedHex(r.id,IDENTIFIER) && fixedHex(r.account_ref) && fixedHex(r.delivery_ref) && fixedHex(r.token_digest));
    good(['prepared','armed','confirmed','disabled'].includes(r.state) && number(r.revision) && r.revision >= 1 && number(r.created_at) && number(r.updated_at) && r.updated_at >= r.created_at);
    const confirmed = fixedHex(r.ack_ref) && number(r.confirmed_at) && r.confirmed_at >= r.created_at && r.confirmed_at <= r.updated_at;
    good(r.state === 'confirmed' ? confirmed : r.state === 'disabled' ? confirmed || (r.ack_ref === null && r.confirmed_at === null) : r.ack_ref === null && r.confirmed_at === null);
    const binding=db.prepare('SELECT * FROM tracking_bindings WHERE tenant=? AND id=?').get(r.tenant,r.id);
    good(binding && binding.account_ref === r.account_ref && binding.delivery_ref === r.delivery_ref && binding.token_digest === r.token_digest && binding.created_at === r.created_at && binding.ack_ref === r.ack_ref && binding.confirmed_at === r.confirmed_at);
    return r;
  }
  const registration = (tenant: string, id: string) => { const r=db.prepare('SELECT * FROM tracking_registrations WHERE tenant=? AND id=?').get(tenant,id) as Registration | undefined;return r ? validateRegistration(r) : undefined; };
  function recovered(tenant: string, operation: string) {
    const row=db.prepare('SELECT * FROM tracking_requests WHERE tenant=? AND operation_id=?').get(tenant,operation);
    if (!row) return undefined;
    const good = (value: unknown) => requireValue(value,500,'collector_artifact_corrupt');
    try {
      good(typeof row.request_path === 'string' && typeof row.request_json === 'string' && typeof row.response_json === 'string' && fixedHex(row.fingerprint) && number(row.accepted_at));
      good(sha256(Buffer.from(row.request_path+'\n'+row.request_json)) === row.fingerprint);
      const request=objectJson(Buffer.from(row.request_json as string)) as Record<string,unknown>;
      const result=exactObject(objectJson(Buffer.from(row.response_json as string)),['registration','receipt']);
      const r=exactObject(result.registration,['registrationId','accountRef','deliveryRef','tokenDigest','state','revision','acknowledgementRef','confirmedAt','createdAt','updatedAt']);
      const receipt=exactObject(result.receipt,['operationId','requestFingerprint','acceptedAt']);
      good(receipt.operationId === operation && receipt.requestFingerprint === row.fingerprint && receipt.acceptedAt === row.accepted_at && request.operationId === operation);
      const regId=row.request_path === '/v1/registrations' ? request.registrationId : (row.request_path as string).slice('/v1/registrations/'.length);
      good(fixedHex(regId,IDENTIFIER));
      const current=registration(tenant,regId as string);good(current);
      // Historical snapshots before confirmation legitimately have no ACK. Validate
      // their immutable metadata independently from the current binding's later ACK.
      const accepted={tenant,id:r.registrationId,account_ref:r.accountRef,delivery_ref:r.deliveryRef,token_digest:r.tokenDigest,state:r.state,revision:r.revision,ack_ref:r.acknowledgementRef,confirmed_at:r.confirmedAt,created_at:r.createdAt,updated_at:r.updatedAt} as Registration;
      good(fixedHex(accepted.id,IDENTIFIER) && fixedHex(accepted.account_ref) && fixedHex(accepted.delivery_ref) && fixedHex(accepted.token_digest) && number(accepted.revision) && accepted.revision > 0 && number(accepted.created_at) && number(accepted.updated_at) && accepted.updated_at >= accepted.created_at && accepted.updated_at <= current!.updated_at);
      const confirmed=accepted.ack_ref === current!.ack_ref && fixedHex(accepted.ack_ref) && accepted.confirmed_at === current!.confirmed_at && number(accepted.confirmed_at) && accepted.confirmed_at >= accepted.created_at && accepted.confirmed_at <= accepted.updated_at;
      good(accepted.state === 'confirmed' ? confirmed : accepted.state === 'disabled' ? confirmed || accepted.ack_ref === null && accepted.confirmed_at === null : ['prepared','armed'].includes(accepted.state) && accepted.ack_ref === null && accepted.confirmed_at === null);
      good(accepted.id === regId && accepted.account_ref === current!.account_ref && accepted.delivery_ref === current!.delivery_ref && accepted.token_digest === current!.token_digest && accepted.created_at === current!.created_at && accepted.updated_at === row.accepted_at && accepted.revision <= current!.revision && number(request.expectedRevision) && accepted.revision === request.expectedRevision+1 && accepted.state === request.state);
      if (row.request_path === '/v1/registrations') {
        exactObject(request,['operationId','registrationId','accountRef','deliveryRef','tokenDigest','state','expectedRevision']);
        good(request.expectedRevision === 0 && request.state === 'prepared' && accepted.account_ref === request.accountRef && accepted.delivery_ref === request.deliveryRef && accepted.token_digest === request.tokenDigest && accepted.created_at === row.accepted_at);
      } else {
        good(/^\/v1\/registrations\/[a-f0-9]{32}$/.test(row.request_path as string));
        exactObject(request,['operationId','expectedRevision','state','acknowledgementRef']);
        good(['armed','confirmed','disabled'].includes(String(request.state)) && (request.state === 'confirmed' ? accepted.ack_ref === request.acknowledgementRef && accepted.confirmed_at === row.accepted_at : request.acknowledgementRef === null));
      }
      if (accepted.revision === current!.revision) good(Object.entries(serialize(accepted)).every(([key,value]) => serialize(current!)[key as keyof ReturnType<typeof serialize>] === value));
      return { fingerprint:row.fingerprint as string,result };
    } catch { throw new CollectorError(500,'collector_artifact_corrupt'); }
  }
  const tenantRevision = (tenant: string) => {
    const row=db.prepare('SELECT revision FROM tracking_tenant_revisions WHERE tenant=?').get(tenant);
    requireValue(row ? number(row.revision) && row.revision > 0 : !db.prepare('SELECT 1 FROM tracking_registrations WHERE tenant=? LIMIT 1').get(tenant),500,'collector_artifact_corrupt');
    return row ? row.revision as number : 0;
  };
  function bumpRevision(tenant: string, first=false) {
    const row=db.prepare('SELECT revision FROM tracking_tenant_revisions WHERE tenant=?').get(tenant);
    requireValue(row ? number(row.revision) && row.revision > 0 && row.revision < Number.MAX_SAFE_INTEGER : first,500,'collector_artifact_corrupt');
    db.prepare('INSERT INTO tracking_tenant_revisions VALUES(?,1) ON CONFLICT(tenant) DO UPDATE SET revision=revision+1').run(tenant);
  }
  function advanceClock(stamp: number) {
    const previous=db.prepare("SELECT value FROM tracking_meta WHERE key='clock_high_watermark'").get();
    if(previous){
      requireValue(typeof previous.value === 'string' && /^\d+$/.test(previous.value) && number(Number(previous.value)),500,'collector_artifact_corrupt');
      requireValue(stamp >= Number(previous.value),503,'collector_clock_rollback');
    }
    db.prepare("INSERT INTO tracking_meta VALUES('clock_high_watermark',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(stamp));
  }
  function authenticate(input: Input, body: Buffer): string {
    const keyId = input.headers['x-rea-key-id'] ?? '', time = input.headers['x-rea-time'] ?? '', nonce = input.headers['x-rea-nonce'] ?? '', received = input.headers['x-rea-signature'] ?? '';
    const signer = signers.get(keyId), timestamp = Number(time);
    requireValue(signer && /^\d{13}$/.test(time) && number(timestamp) && Math.abs(now() - timestamp) <= CLOCK_SKEW_MS && /^[A-Za-z0-9_-]{32}$/.test(nonce) && HEX.test(received), 401, 'unauthorized');
    requireValue(equalHex(signature(signer.key, input.method, input.target, body, keyId, time, nonce), received), 401, 'unauthorized');
    transaction(() => {
      advanceClock(now());
      db.prepare('DELETE FROM tracking_nonces WHERE used_at<?').run(now() - CLOCK_SKEW_MS * 2);
      requireValue(!db.prepare('SELECT 1 FROM tracking_nonces WHERE key_id=? AND nonce=?').get(keyId, nonce), 401, 'replayed_request');
      db.prepare('INSERT INTO tracking_nonces VALUES(?,?,?)').run(keyId, nonce, now());
    });
    return signer.tenant;
  }
  function save(tenant: string, path: string, body: Buffer) {
    const value = objectJson(body), create = path === '/v1/registrations';
    const data = exactObject(value, create ? ['operationId','registrationId','accountRef','deliveryRef','tokenDigest','state','expectedRevision'] : ['operationId','expectedRevision','state','acknowledgementRef']);
    requireValue(fixedHex(data.operationId, IDENTIFIER) && number(data.expectedRevision));
    let id: string;
    if (create) {
      requireValue(fixedHex(data.registrationId, IDENTIFIER) && fixedHex(data.accountRef) && fixedHex(data.deliveryRef) && fixedHex(data.tokenDigest) && data.state === 'prepared' && data.expectedRevision === 0);
      id = data.registrationId;
    } else {
      id = path.slice('/v1/registrations/'.length);
      requireValue(['armed','confirmed','disabled'].includes(String(data.state)) && (data.state === 'confirmed' ? fixedHex(data.acknowledgementRef) : data.acknowledgementRef === null));
    }
    const fingerprint = sha256(Buffer.concat([Buffer.from(path + '\n'), body]));
    return transaction(() => {
      const earlier = recovered(tenant,data.operationId as string);
      if (earlier) { requireValue(earlier.fingerprint === fingerprint, 409, 'request_key_conflict'); return earlier.result; }
      const basis=tenantRevision(tenant),old = registration(tenant, id), stamp = now();
      if (create) {
        requireValue(!old, 409, 'registration_conflict');
        requireValue(!db.prepare('SELECT 1 FROM tracking_registrations WHERE token_digest=? OR (tenant=? AND delivery_ref=?)').get(data.tokenDigest as string, tenant, data.deliveryRef as string), 409, 'registration_conflict');
        db.prepare('INSERT INTO tracking_registrations VALUES(?,?,?,?,?,?,1,NULL,NULL,?,?)').run(tenant,id,data.accountRef as string,data.deliveryRef as string,data.tokenDigest as string,'prepared',stamp,stamp);
        db.prepare('INSERT INTO tracking_bindings VALUES(?,?,?,?,?,?,NULL,NULL)').run(tenant,id,data.accountRef as string,data.deliveryRef as string,data.tokenDigest as string,stamp);
      } else {
        requireValue(old, 404, 'registration_not_found');
        requireValue(old.revision === data.expectedRevision, 409, 'revision_conflict');
        const allowed = (old.state === 'prepared' && ['armed','disabled'].includes(String(data.state))) || (old.state === 'armed' && ['confirmed','disabled'].includes(String(data.state))) || (old.state === 'confirmed' && data.state === 'disabled');
        requireValue(allowed, 409, 'state_conflict');
        if(data.state === 'confirmed') requireValue(Number(db.prepare('UPDATE tracking_bindings SET ack_ref=?,confirmed_at=? WHERE tenant=? AND id=? AND ack_ref IS NULL AND confirmed_at IS NULL').run(data.acknowledgementRef as string,stamp,tenant,id).changes) === 1,500,'collector_artifact_corrupt');
        db.prepare('UPDATE tracking_registrations SET state=?,revision=revision+1,ack_ref=?,confirmed_at=?,updated_at=? WHERE tenant=? AND id=?').run(data.state as string, data.state === 'confirmed' ? data.acknowledgementRef as string : old.ack_ref, data.state === 'confirmed' ? stamp : old.confirmed_at,stamp,tenant,id);
      }
      bumpRevision(tenant,create && basis === 0);
      const result = { registration: serialize(registration(tenant,id)!), receipt: { operationId:data.operationId,requestFingerprint:fingerprint,acceptedAt:stamp } };
      db.prepare('INSERT INTO tracking_requests VALUES(?,?,?,?,?,?,?)').run(tenant,data.operationId as string,fingerprint,path,body.toString('utf8'),JSON.stringify(result),stamp);
      return result;
    });
  }
  function recordPixel(token: string, userAgent: string) {
    const digest = sha256(token), stamp = now();
    transaction(() => {
      const r = db.prepare("SELECT * FROM tracking_registrations WHERE token_digest=? AND state IN ('armed','confirmed')").get(digest) as Registration | undefined;
      if (!r) return;
      validateRegistration(r);
      advanceClock(stamp);
      const minute = Math.floor(stamp / 60_000), since = minute * 60_000;
      const count = db.prepare('SELECT count(*) n FROM tracking_events WHERE observed_at>=? AND observed_at<?').get(since,since+60_000)!.n as number;
      const own = db.prepare('SELECT count(*) n FROM tracking_events WHERE tenant=? AND registration_id=? AND observed_at>=? AND observed_at<?').get(r.tenant,r.id,since,since+60_000)!.n as number;
      if (count >= globalLimit || own >= perToken) {
        db.prepare('INSERT INTO tracking_throttle VALUES(?,?,?,1) ON CONFLICT(tenant,account_ref,minute) DO UPDATE SET dropped=dropped+1').run(r.tenant,r.account_ref,minute);
        return;
      }
      const sequence = Number(db.prepare('SELECT coalesce(max(sequence),0)+1 n FROM tracking_events WHERE tenant=? AND account_ref=?').get(r.tenant,r.account_ref)!.n);
      const ua = userAgent.slice(0,512).toLowerCase();
      const proxy = /googleimageproxy|ggpht\.com/.test(ua) ? 'google-proxy' : /apple.*mail|mailprivacy/.test(ua) ? 'possible-apple-proxy' : 'unknown';
      const device = /iphone|android|mobile|ipad/.test(ua) ? 'mobile' : /windows|macintosh|x11/.test(ua) ? 'desktop' : 'unknown';
      db.prepare('INSERT INTO tracking_events VALUES(?,?,?,?,?,?,?,?)').run(r.tenant,r.account_ref,sequence,randomUUID(),r.id,stamp,device,proxy);
    });
  }
  function events(tenant: string, url: URL) {
    const params = url.searchParams;
    requireValue([...params.keys()].every(key => ['accountRef','limit','cursor'].includes(key)));
    const account = params.get('accountRef'), limitRaw = params.get('limit') ?? '50';
    requireValue(fixedHex(account) && /^(?:[1-9]|[1-9][0-9]|100)$/.test(limitRaw));
    // Check the authoritative account bindings before filtering event eligibility.
    // A corrupt nullable confirmation field must fail, not hide retained events.
    const differences=['account_ref','delivery_ref','token_digest','created_at','ack_ref','confirmed_at'].map(field => `r.${field} IS NOT b.${field}`).join(' OR ');
    const brokenBinding=db.prepare(`SELECT 1 FROM tracking_bindings b LEFT JOIN tracking_registrations r ON r.tenant=b.tenant AND r.id=b.id
      WHERE b.tenant=? AND b.account_ref=? AND (r.id IS NULL OR ${differences}) LIMIT 1`).get(tenant,account);
    const missingBinding=db.prepare(`SELECT 1 FROM tracking_registrations r LEFT JOIN tracking_bindings b ON b.tenant=r.tenant AND b.id=r.id
      WHERE r.tenant=? AND r.account_ref=? AND (b.id IS NULL OR ${differences}) LIMIT 1`).get(tenant,account);
    requireValue(!brokenBinding && !missingBinding,500,'collector_artifact_corrupt');
    const limit = Number(limitRaw), revision = tenantRevision(tenant);
    let after = 0, through = Number(db.prepare('SELECT coalesce(max(sequence),0) n FROM tracking_events WHERE tenant=? AND account_ref=?').get(tenant,account)!.n);
    if (params.has('cursor')) {
      const cursor = params.get('cursor')!;
      requireValue(cursor.length <= 1024 && /^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(cursor),400,'invalid_cursor');
      const [encoded,mac] = cursor.split('.');
      requireValue(equalHex(createHmac('sha256',cursorKey).update(encoded).digest('hex'),mac),400,'invalid_cursor');
      const data = exactObject(objectJson(Buffer.from(encoded,'base64url')),['v','tenant','account','after','through','revision']);
      requireValue(data.v === 1 && data.tenant === tenant && data.account === account && number(data.after) && number(data.through) && data.after <= data.through,400,'invalid_cursor');
      requireValue(data.revision === revision,409,'events_page_stale');
      after=data.after;through=data.through;
    }
    const rows = db.prepare(`SELECT e.*,r.delivery_ref,r.ack_ref FROM tracking_events e JOIN tracking_registrations r ON r.tenant=e.tenant AND r.id=e.registration_id
      WHERE e.tenant=? AND e.account_ref=? AND e.sequence>? AND e.sequence<=? AND r.confirmed_at IS NOT NULL ORDER BY e.sequence LIMIT ?`).all(tenant,account,after,through,limit+1);
    for (const row of rows) {
      const r=registration(tenant,row.registration_id as string);
      requireValue(r && r.account_ref === account && r.confirmed_at !== null && number(row.sequence) && row.sequence > 0 && number(row.observed_at) && ['desktop','mobile','unknown'].includes(row.device as string) && ['google-proxy','possible-apple-proxy','unknown'].includes(row.proxy as string) && typeof row.id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(row.id),500,'collector_artifact_corrupt');
    }
    const page = rows.slice(0,limit), last = page.at(-1)?.sequence as number | undefined;
    let nextCursor: string | null = null;
    if (rows.length > limit && last !== undefined) {
      const encoded = Buffer.from(JSON.stringify({v:1,tenant,account,after:last,through,revision})).toString('base64url');
      nextCursor=encoded+'.'+createHmac('sha256',cursorKey).update(encoded).digest('hex');
    }
    const throttled = Number(db.prepare('SELECT coalesce(sum(dropped),0) n FROM tracking_throttle WHERE tenant=? AND account_ref=?').get(tenant,account)!.n);
    requireValue(number(throttled),500,'collector_artifact_corrupt');
    return { events:page.map(r => ({id:r.id,registrationId:r.registration_id,deliveryRef:r.delivery_ref,acknowledgementRef:r.ack_ref,observedAt:r.observed_at,device:r.device,proxy:r.proxy,viewer:null,evidence:'image-fetch'})),nextCursor,coverage:{snapshotThrough:through,revision,throttled,fullMailbox:false,humanReadVerified:false} };
  }
  function handle(input: Input): Output {
    try {
      requireValue(input.target.length <= MAX_TARGET && /^[A-Z]+$/.test(input.method) && !/[\r\n]/.test(input.target));
      const body = input.body ?? Buffer.alloc(0);
      requireValue(body.length <= MAX_BODY,413,'body_too_large');
      if (input.target.startsWith('/p/')) {
        requireValue(['GET','HEAD'].includes(input.method),405,'method_not_allowed');
        const match = /^\/p\/([A-Za-z0-9_-]{43})\.gif$/.exec(input.target);
        // Invalid, unknown, inactive and valid tokens share the same public image.
        if (match && Buffer.from(match[1],'base64url').length === 32 && Buffer.from(match[1],'base64url').toString('base64url') === match[1] && input.method === 'GET' && body.length === 0) {
          // No token, IP, arbitrary headers, recipient claim, or full user agent is logged or stored.
          try { recordPixel(match[1],input.headers['user-agent'] ?? ''); } catch { /* Public appearance is independent of collector state. */ }
        }
        return pixel(input.method === 'HEAD');
      }
      canonicalTarget(input.target);
      requireValue(input.headers.origin === undefined && input.headers.cookie === undefined,403,'browser_access_denied');
      requireValue(input.headers['content-type'] === 'application/json',415,'content_type_required');
      const url = new URL(input.target,'https://tracking.invalid');
      requireValue(input.method === 'GET' ? body.length === 0 : input.method === 'POST',405,'method_not_allowed');
      const tenant = authenticate(input,body);
      if (input.method === 'POST') {
        requireValue(!url.search && (url.pathname === '/v1/registrations' || /^\/v1\/registrations\/[a-f0-9]{32}$/.test(url.pathname)),405,'method_not_allowed');
        return json(200,save(tenant,url.pathname,body));
      }
      if (url.pathname === '/v1/events') return json(200,transaction(() => events(tenant,url)));
      if (/^\/v1\/requests\/[a-f0-9]{32}$/.test(url.pathname)) {
        requireValue(!url.search,400,'invalid_request');
        const stored=recovered(tenant,url.pathname.slice('/v1/requests/'.length));
        requireValue(stored,404,'request_not_found');
        return json(200,stored.result);
      }
      requireValue(!url.search && /^\/v1\/registrations\/[a-f0-9]{32}$/.test(url.pathname),404,'not_found');
      const r=registration(tenant,url.pathname.slice('/v1/registrations/'.length));
      requireValue(r,404,'registration_not_found');
      return json(200,{registration:serialize(r)});
    } catch (error) {
      return error instanceof CollectorError ? json(error.status,{error:{code:error.code}}) : json(500,{error:{code:'collector_unavailable'}});
    }
  }
  let closed=false;
  function readable(): boolean {
    if(closed)return false;
    try { return db.prepare("SELECT value FROM tracking_meta WHERE key='schema'").get()?.value === 'rea-tracking-collector-v2'; }
    catch { return false; }
  }
  return { handle, readable, close:() => { if(closed)return;closed=true;db.close();for (const signer of signers.values()) signer.key.fill(0);cursorKey.fill(0); } };
}
