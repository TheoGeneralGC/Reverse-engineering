import type { CollectorDatabase, SqlConnection } from './database.ts';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomUUID } from 'node:crypto';
import { CLOCK_SKEW_MS, CollectorError, HEX, IDENTIFIER, MAX_BODY, MAX_TARGET, canonicalTarget, equalHex, exactObject, requireValue, sha256, signature } from '../../collector/src/protocol.ts';

type State = 'prepared' | 'armed' | 'confirmed' | 'disabled';
type Registration = { tenant: string; id: string; account_ref: string; delivery_ref: string; token_digest: string; state: State; revision: number; ack_ref: string | null; confirmed_at: number | null; created_at: number; updated_at: number };
type Signer = { tenant: string; key: Buffer };
export type CollectorOptions = { database: CollectorDatabase; signers: ReadonlyMap<string, Signer>; cursorKey: Buffer; now?: () => number; maxEventsPerTokenMinute?: number; maxEventsPerMinute?: number };
import type { Input, Output } from '../../collector/src/collector.ts';
export type { Input, Output } from '../../collector/src/collector.ts';
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const SAFE_HEADERS = { 'cache-control': 'no-store, no-cache, must-revalidate, private', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" };
const json = (status: number, value: unknown): Output => ({ status, headers: { ...SAFE_HEADERS, 'content-type': 'application/json; charset=utf-8' }, body: Buffer.from(JSON.stringify(value)) });
const pixel = (head: boolean): Output => ({ status: 200, headers: { ...SAFE_HEADERS, 'content-type': 'image/gif', 'content-length': String(PIXEL.length) }, body: head ? Buffer.alloc(0) : Buffer.from(PIXEL) });
const objectJson = (body: Buffer) => { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); } catch { throw new CollectorError(400, 'invalid_json'); } };
const number = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const fixedHex = (value: unknown, pattern = HEX): value is string => typeof value === 'string' && pattern.test(value);
const serialize = (r: Registration) => ({ registrationId: r.id, accountRef: r.account_ref, deliveryRef: r.delivery_ref, tokenDigest: r.token_digest, state: r.state, revision: r.revision, acknowledgementRef: r.ack_ref, confirmedAt: r.confirmed_at, createdAt: r.created_at, updatedAt: r.updated_at });

/** Opaque tracking ingress. Database I/O is injected; no mail/model provider or message dispatch. */
export function createAsyncCollector(options: CollectorOptions) {
  requireValue(options.cursorKey.length >= 32 && options.cursorKey.length <= 64 && options.signers.size > 0 && options.signers.size <= 32, 500, 'invalid_key_configuration');
  const signers = new Map<string, Signer>();
  for (const [id, value] of options.signers) {
    requireValue(/^[a-zA-Z0-9_-]{1,48}$/.test(id) && fixedHex(value.tenant) && value.key.length >= 32 && value.key.length <= 64, 500, 'invalid_key_configuration');
    signers.set(id, { tenant: value.tenant, key: Buffer.from(value.key) });
  }
  const cursorKey = Buffer.from(options.cursorKey), clock = options.now ?? Date.now;
  const perToken = options.maxEventsPerTokenMinute ?? 16, globalLimit = options.maxEventsPerMinute ?? 10_000;
  requireValue(number(perToken) && perToken > 0 && perToken <= 1000 && number(globalLimit) && globalLimit > 0 && globalLimit <= 100_000, 500, 'invalid_rate_configuration');
  const database=options.database;
  const invocation=new AsyncLocalStorage<{signal?:AbortSignal;verifiedTimestamp?:number}>();
  const live=()=>!closed && !invocation.getStore()?.signal?.aborted;
  async function transaction<T>(run: (db: SqlConnection, stamp:number) => Promise<T>): Promise<T> {
    const context=invocation.getStore();let acquired:number|undefined;
    const alive=()=>{
      if(closed||context?.signal?.aborted)return false;
      if(acquired!==undefined){const current=now();requireValue(current>=acquired,503,'collector_clock_rollback');if(context?.verifiedTimestamp!==undefined)requireValue(Math.abs(current-context.verifiedTimestamp)<=CLOCK_SKEW_MS,401,'unauthorized')}
      return true;
    };
    return database.primaryTransaction(async(db)=>{
      acquired=now();
      if(context?.verifiedTimestamp!==undefined)requireValue(Math.abs(acquired-context.verifiedTimestamp)<=CLOCK_SKEW_MS,401,'unauthorized');
      const result=await run(db,acquired);alive();return result;
    },alive);
  }
  const now = () => { const value = clock(); requireValue(number(value), 500, 'invalid_clock'); return value; };
  function validateRegistrationFields(r: Registration) {
    const good = (value: unknown) => requireValue(value,500,'collector_artifact_corrupt');
    good(fixedHex(r.tenant) && fixedHex(r.id,IDENTIFIER) && fixedHex(r.account_ref) && fixedHex(r.delivery_ref) && fixedHex(r.token_digest));
    good(['prepared','armed','confirmed','disabled'].includes(r.state) && number(r.revision) && r.revision >= 1 && number(r.created_at) && number(r.updated_at) && r.updated_at >= r.created_at);
    const confirmed = fixedHex(r.ack_ref) && number(r.confirmed_at) && r.confirmed_at >= r.created_at && r.confirmed_at <= r.updated_at;
    good(r.state === 'confirmed' ? confirmed : r.state === 'disabled' ? confirmed || (r.ack_ref === null && r.confirmed_at === null) : r.ack_ref === null && r.confirmed_at === null);
    return r;
  }
  async function validateRegistration(db: SqlConnection, r: Registration) {
    validateRegistrationFields(r);
    const good = (value: unknown) => requireValue(value,500,'collector_artifact_corrupt');
    const binding=(await db.prepare('SELECT * FROM tracking_bindings WHERE tenant=? AND id=?').get(r.tenant,r.id));
    good(binding && binding.account_ref === r.account_ref && binding.delivery_ref === r.delivery_ref && binding.token_digest === r.token_digest && binding.created_at === r.created_at && binding.ack_ref === r.ack_ref && binding.confirmed_at === r.confirmed_at);
    return r;
  }
  const registration = async (db: SqlConnection, tenant: string, id: string) => { const r=(await db.prepare('SELECT * FROM tracking_registrations WHERE tenant=? AND id=?').get(tenant,id)) as Registration | undefined;return r ? (await validateRegistration(db, r)) : undefined; };
  async function recovered(db: SqlConnection, tenant: string, operation: string) {
    const row=(await db.prepare('SELECT * FROM tracking_requests WHERE tenant=? AND operation_id=?').get(tenant,operation));
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
      const current=(await registration(db, tenant,regId as string));good(current);
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
  const tenantRevision = async (db: SqlConnection, tenant: string) => {
    const row=(await db.prepare('SELECT revision FROM tracking_tenant_revisions WHERE tenant=?').get(tenant));
    requireValue(row ? number(row.revision) && row.revision > 0 : !(await db.prepare('SELECT 1 FROM tracking_registrations WHERE tenant=? LIMIT 1').get(tenant)),500,'collector_artifact_corrupt');
    return row ? row.revision as number : 0;
  };
  async function bumpRevision(db: SqlConnection, tenant: string, first=false) {
    const row=(await db.prepare('SELECT revision FROM tracking_tenant_revisions WHERE tenant=?').get(tenant));
    requireValue(row ? number(row.revision) && row.revision > 0 && row.revision < Number.MAX_SAFE_INTEGER : first,500,'collector_artifact_corrupt');
    (await db.prepare('INSERT INTO tracking_tenant_revisions VALUES(?,1) ON CONFLICT(tenant) DO UPDATE SET revision=revision+1').run(tenant));
  }
  async function advanceClock(db: SqlConnection, stamp: number) {
    const previous=(await db.prepare("SELECT value FROM tracking_meta WHERE key='clock_high_watermark'").get());
    if(previous){
      requireValue(typeof previous.value === 'string' && /^\d+$/.test(previous.value) && number(Number(previous.value)),500,'collector_artifact_corrupt');
      requireValue(stamp >= Number(previous.value),503,'collector_clock_rollback');
    }
    (await db.prepare("INSERT INTO tracking_meta VALUES('clock_high_watermark',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(stamp)));
  }
  async function authenticate(input: Input, body: Buffer): Promise<string> {
    const keyId = input.headers['x-rea-key-id'] ?? '', time = input.headers['x-rea-time'] ?? '', nonce = input.headers['x-rea-nonce'] ?? '', received = input.headers['x-rea-signature'] ?? '';
    const signer = signers.get(keyId), timestamp = Number(time);
    requireValue(signer && /^\d{13}$/.test(time) && number(timestamp) && Math.abs(now() - timestamp) <= CLOCK_SKEW_MS && /^[A-Za-z0-9_-]{32}$/.test(nonce) && HEX.test(received), 401, 'unauthorized');
    requireValue(equalHex(signature(signer.key, input.method, input.target, body, keyId, time, nonce), received), 401, 'unauthorized');
    const context=invocation.getStore();if(context)context.verifiedTimestamp=timestamp;
    (await transaction(async (db,stamp) => {
      requireValue(Math.abs(stamp-timestamp)<=CLOCK_SKEW_MS,401,'unauthorized');
      (await advanceClock(db, stamp));
      (await db.prepare('DELETE FROM tracking_nonces WHERE used_at<?').run(stamp - CLOCK_SKEW_MS * 2));
      requireValue(!(await db.prepare('SELECT 1 FROM tracking_nonces WHERE key_id=? AND nonce=?').get(keyId, nonce)), 401, 'replayed_request');
      (await db.prepare('INSERT INTO tracking_nonces VALUES(?,?,?)').run(keyId, nonce, stamp));
    }));
    return signer.tenant;
  }
  async function save(tenant: string, path: string, body: Buffer) {
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
    return (await transaction(async (db,stamp) => {
      (await advanceClock(db,stamp));
      const earlier = (await recovered(db, tenant,data.operationId as string));
      if (earlier) { requireValue(earlier.fingerprint === fingerprint, 409, 'request_key_conflict'); return earlier.result; }
      const basis=(await tenantRevision(db, tenant)),old = (await registration(db, tenant, id));
      if (create) {
        requireValue(!old, 409, 'registration_conflict');
        requireValue(!(await db.prepare('SELECT 1 FROM tracking_registrations WHERE token_digest=? OR (tenant=? AND delivery_ref=?)').get(data.tokenDigest as string, tenant, data.deliveryRef as string)), 409, 'registration_conflict');
        (await db.prepare('INSERT INTO tracking_registrations VALUES(?,?,?,?,?,?,1,NULL,NULL,?,?)').run(tenant,id,data.accountRef as string,data.deliveryRef as string,data.tokenDigest as string,'prepared',stamp,stamp));
        (await db.prepare('INSERT INTO tracking_bindings VALUES(?,?,?,?,?,?,NULL,NULL)').run(tenant,id,data.accountRef as string,data.deliveryRef as string,data.tokenDigest as string,stamp));
      } else {
        requireValue(old, 404, 'registration_not_found');
        requireValue(old.revision === data.expectedRevision, 409, 'revision_conflict');
        const allowed = (old.state === 'prepared' && ['armed','disabled'].includes(String(data.state))) || (old.state === 'armed' && ['confirmed','disabled'].includes(String(data.state))) || (old.state === 'confirmed' && data.state === 'disabled');
        requireValue(allowed, 409, 'state_conflict');
        if(data.state === 'confirmed') requireValue(Number((await db.prepare('UPDATE tracking_bindings SET ack_ref=?,confirmed_at=? WHERE tenant=? AND id=? AND ack_ref IS NULL AND confirmed_at IS NULL').run(data.acknowledgementRef as string,stamp,tenant,id)).changes) === 1,500,'collector_artifact_corrupt');
        (await db.prepare('UPDATE tracking_registrations SET state=?,revision=revision+1,ack_ref=?,confirmed_at=?,updated_at=? WHERE tenant=? AND id=?').run(data.state as string, data.state === 'confirmed' ? data.acknowledgementRef as string : old.ack_ref, data.state === 'confirmed' ? stamp : old.confirmed_at,stamp,tenant,id));
      }
      (await bumpRevision(db, tenant,create && basis === 0));
      const result = { registration: serialize((await registration(db, tenant,id))!), receipt: { operationId:data.operationId,requestFingerprint:fingerprint,acceptedAt:stamp } };
      (await db.prepare('INSERT INTO tracking_requests VALUES(?,?,?,?,?,?,?)').run(tenant,data.operationId as string,fingerprint,path,body.toString('utf8'),JSON.stringify(result),stamp));
      return result;
    }));
  }
  async function recordPixel(token: string, userAgent: string) {
    const digest = sha256(token);
    (await transaction(async (db,stamp) => {
      const r = (await db.prepare("SELECT * FROM tracking_registrations WHERE token_digest=? AND state IN ('armed','confirmed')").get(digest)) as Registration | undefined;
      if (!r) return;
      (await validateRegistration(db, r));
      (await advanceClock(db, stamp));
      const minute = Math.floor(stamp / 60_000), since = minute * 60_000;
      const count = (await db.prepare('SELECT count(*) n FROM tracking_events WHERE observed_at>=? AND observed_at<?').get(since,since+60_000))!.n as number;
      const own = (await db.prepare('SELECT count(*) n FROM tracking_events WHERE tenant=? AND registration_id=? AND observed_at>=? AND observed_at<?').get(r.tenant,r.id,since,since+60_000))!.n as number;
      if (count >= globalLimit || own >= perToken) {
        (await db.prepare('INSERT INTO tracking_throttle VALUES(?,?,?,1) ON CONFLICT(tenant,account_ref,minute) DO UPDATE SET dropped=dropped+1').run(r.tenant,r.account_ref,minute));
        return;
      }
      const sequence = Number((await db.prepare('SELECT coalesce(max(sequence),0)+1 n FROM tracking_events WHERE tenant=? AND account_ref=?').get(r.tenant,r.account_ref))!.n);
      const ua = userAgent.slice(0,512).toLowerCase();
      const proxy = /googleimageproxy|ggpht\.com/.test(ua) ? 'google-proxy' : /apple.*mail|mailprivacy/.test(ua) ? 'possible-apple-proxy' : 'unknown';
      const device = /iphone|android|mobile|ipad/.test(ua) ? 'mobile' : /windows|macintosh|x11/.test(ua) ? 'desktop' : 'unknown';
      (await db.prepare('INSERT INTO tracking_events VALUES(?,?,?,?,?,?,?,?)').run(r.tenant,r.account_ref,sequence,randomUUID(),r.id,stamp,device,proxy));
    }));
  }
  async function events(db: SqlConnection, tenant: string, url: URL) {
    const params = url.searchParams;
    requireValue([...params.keys()].every(key => ['accountRef','limit','cursor'].includes(key)));
    const account = params.get('accountRef'), limitRaw = params.get('limit') ?? '50';
    requireValue(fixedHex(account) && /^(?:[1-9]|[1-9][0-9]|100)$/.test(limitRaw));
    // Check the authoritative account bindings before filtering event eligibility.
    // A corrupt nullable confirmation field must fail, not hide retained events.
    const differences=['account_ref','delivery_ref','token_digest','created_at','ack_ref','confirmed_at'].map(field => `r.${field} IS NOT b.${field}`).join(' OR ');
    const brokenBinding=(await db.prepare(`SELECT 1 FROM tracking_bindings b LEFT JOIN tracking_registrations r ON r.tenant=b.tenant AND r.id=b.id
      WHERE b.tenant=? AND b.account_ref=? AND (r.id IS NULL OR ${differences}) LIMIT 1`).get(tenant,account));
    const missingBinding=(await db.prepare(`SELECT 1 FROM tracking_registrations r LEFT JOIN tracking_bindings b ON b.tenant=r.tenant AND b.id=r.id
      WHERE r.tenant=? AND r.account_ref=? AND (b.id IS NULL OR ${differences}) LIMIT 1`).get(tenant,account));
    requireValue(!brokenBinding && !missingBinding,500,'collector_artifact_corrupt');
    const limit = Number(limitRaw), revision = (await tenantRevision(db, tenant));
    let after = 0, through = Number((await db.prepare('SELECT coalesce(max(sequence),0) n FROM tracking_events WHERE tenant=? AND account_ref=?').get(tenant,account))!.n);
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
    const rows = (await db.prepare(`SELECT e.*,r.delivery_ref,r.ack_ref,
      r.tenant AS proof_tenant,r.id AS proof_registration_id,r.account_ref AS proof_account_ref,
      r.token_digest AS proof_token_digest,r.state AS proof_state,r.revision AS proof_revision,
      r.confirmed_at AS proof_confirmed_at,r.created_at AS proof_created_at,r.updated_at AS proof_updated_at
      FROM tracking_events e JOIN tracking_registrations r ON r.tenant=e.tenant AND r.id=e.registration_id
      WHERE e.tenant=? AND e.account_ref=? AND e.sequence>? AND e.sequence<=? AND r.confirmed_at IS NOT NULL ORDER BY e.sequence LIMIT ?`).all(tenant,account,after,through,limit+1));
    for (const row of rows) {
      // The preceding account-wide left-join checks validated both binding sides
      // on this same primary transaction. Load selected registration fields in
      // the event query so no network round-trip is required per event.
      const r=validateRegistrationFields({tenant:row.proof_tenant,id:row.proof_registration_id,account_ref:row.proof_account_ref,
        delivery_ref:row.delivery_ref,token_digest:row.proof_token_digest,state:row.proof_state,revision:row.proof_revision,
        ack_ref:row.ack_ref,confirmed_at:row.proof_confirmed_at,created_at:row.proof_created_at,updated_at:row.proof_updated_at} as Registration);
      requireValue(r && r.account_ref === account && r.confirmed_at !== null && number(row.sequence) && row.sequence > 0 && number(row.observed_at) && ['desktop','mobile','unknown'].includes(row.device as string) && ['google-proxy','possible-apple-proxy','unknown'].includes(row.proxy as string) && typeof row.id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(row.id),500,'collector_artifact_corrupt');
    }
    const page = rows.slice(0,limit), last = page.at(-1)?.sequence as number | undefined;
    let nextCursor: string | null = null;
    if (rows.length > limit && last !== undefined) {
      const encoded = Buffer.from(JSON.stringify({v:1,tenant,account,after:last,through,revision})).toString('base64url');
      nextCursor=encoded+'.'+createHmac('sha256',cursorKey).update(encoded).digest('hex');
    }
    const throttled = Number((await db.prepare('SELECT coalesce(sum(dropped),0) n FROM tracking_throttle WHERE tenant=? AND account_ref=?').get(tenant,account))!.n);
    requireValue(number(throttled),500,'collector_artifact_corrupt');
    return { events:page.map(r => ({id:r.id,registrationId:r.registration_id,deliveryRef:r.delivery_ref,acknowledgementRef:r.ack_ref,observedAt:r.observed_at,device:r.device,proxy:r.proxy,viewer:null,evidence:'image-fetch'})),nextCursor,coverage:{snapshotThrough:through,revision,throttled,fullMailbox:false,humanReadVerified:false} };
  }
  async function handleInput(input: Input): Promise<Output> {
    try {
      requireValue(live(),503,'collector_unavailable');
      requireValue(input.target.length <= MAX_TARGET && /^[A-Z]+$/.test(input.method) && !/[\r\n]/.test(input.target));
      const body = input.body ?? Buffer.alloc(0);
      requireValue(body.length <= MAX_BODY,413,'body_too_large');
      if (input.target.startsWith('/p/')) {
        requireValue(['GET','HEAD'].includes(input.method),405,'method_not_allowed');
        const match = /^\/p\/([A-Za-z0-9_-]{43})\.gif$/.exec(input.target);
        // Invalid, unknown, inactive and valid tokens share the same public image.
        if (match && Buffer.from(match[1],'base64url').length === 32 && Buffer.from(match[1],'base64url').toString('base64url') === match[1] && input.method === 'GET' && body.length === 0) {
          // No token, IP, arbitrary headers, recipient claim, or full user agent is logged or stored.
          try { (await recordPixel(match[1],input.headers['user-agent'] ?? '')); } catch { /* Public appearance is independent of collector state. */ }
        }
        return pixel(input.method === 'HEAD');
      }
      canonicalTarget(input.target);
      requireValue(input.headers.origin === undefined && input.headers.cookie === undefined,403,'browser_access_denied');
      requireValue(input.headers['content-type'] === 'application/json',415,'content_type_required');
      const url = new URL(input.target,'https://tracking.invalid');
      requireValue(input.method === 'GET' ? body.length === 0 : input.method === 'POST',405,'method_not_allowed');
      const tenant = (await authenticate(input,body));
      if (input.method === 'POST') {
        requireValue(!url.search && (url.pathname === '/v1/registrations' || /^\/v1\/registrations\/[a-f0-9]{32}$/.test(url.pathname)),405,'method_not_allowed');
        const result=await save(tenant,url.pathname,body);requireValue(live(),503,'collector_unavailable');return json(200,result);
      }
      return (await transaction(async (db,stamp) => {
      (await advanceClock(db,stamp));
      if (url.pathname === '/v1/events') return json(200,(await events(db,tenant,url)));
      if (/^\/v1\/requests\/[a-f0-9]{32}$/.test(url.pathname)) {
        requireValue(!url.search,400,'invalid_request');
        const stored=(await recovered(db, tenant,url.pathname.slice('/v1/requests/'.length)));
        requireValue(stored,404,'request_not_found');
        return json(200,stored.result);
      }
      requireValue(!url.search && /^\/v1\/registrations\/[a-f0-9]{32}$/.test(url.pathname),404,'not_found');
      const r=(await registration(db, tenant,url.pathname.slice('/v1/registrations/'.length)));
      requireValue(r,404,'registration_not_found');
      return json(200,{registration:serialize(r)});
      }));
    } catch (error) {
      return error instanceof CollectorError ? json(error.status,{error:{code:error.code}}) : json(500,{error:{code:'collector_unavailable'}});
    }
  }
  let closed=false;
  const handle=(input:Input,signal?:AbortSignal)=>invocation.run({signal},()=>handleInput(input));
  async function readable(): Promise<boolean> { return !closed && await database.readableMarker(); }
  return { handle, readable, close:() => { if(closed)return;closed=true;for (const signer of signers.values()) signer.key.fill(0);cursorKey.fill(0); } };
}
