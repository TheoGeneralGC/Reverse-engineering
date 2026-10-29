import {generatedHash,generatedScopeValid,type GeneratedPublicationScope} from './generated-draft-policy.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Store } from './store.ts';
import { HttpError, type Account, type Draft } from './types.ts';
import type { ProviderDraftError, ProviderDraftOperation, ProviderDraftSnapshot, ProviderDraftState, ProviderDraftDiscardReceipt, ProviderDraftDiscardRequest, ProviderDraftDiscardResponse } from './provider-draft-types.ts';
import type { ProviderDraftMimeSnapshot } from './provider-draft-mime.ts';
import { PROVIDER_DRAFT_MAX_RAW_BYTES, providerDraftHash } from './provider-draft-mime.ts';
import { createHash } from 'node:crypto';
export type ProviderDraftOrigin = 'composer' | 'reply' | 'forward' | 'ai-created' | 'ai-send' | 'auto-generated-managed';
export type ProviderDraftLink = Omit<ProviderDraftSnapshot, 'ownership' | 'operation' | 'deliveryBlocked'> & { ownerMarker: string; origin: ProviderDraftOrigin; createdAt: string; replyContext: { internetMessageId: string | null; references: string | null; providerThreadId: string | null }; activeOperationId: string | null; discardId: string | null; generated?:{policy:'generated-enrollment-v1';scope:GeneratedPublicationScope;ownerFingerprint:string} };
const keys = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const timestamp = (value: unknown) => { try { return typeof value === 'string' && new Date(value).toISOString() === value; } catch { return false; } };
const providerId = (value: unknown): value is string | null => value === null || typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
const states = new Set<ProviderDraftState>(['unmanaged','idle','queued','saving','synced','blocked','outcome_unknown','remote_conflict','suspended','discard_queued','discarding','discarded','consumed']);
const errorValid = (value: ProviderDraftError | null) => value === null || !!value && typeof value.code === 'string' && typeof value.message === 'string' && ['none','explicit-check'].includes(value.retry);
export function providerDraftInvalid(): never { throw new HttpError(400, 'Invalid cloud draft request', 'provider_draft_invalid_request'); }
export function providerDraftCorrupt(): never { throw new HttpError(500, 'The cloud draft record could not be verified', 'provider_draft_corrupt'); }
export function providerDraftMissing(): never { throw new HttpError(404, 'Cloud draft resource not found', 'provider_draft_not_found'); }
export class ProviderDraftRepository {
  readonly store: Store; readonly now: () => number;
  constructor(store: Store, now = Date.now) {
    this.store = store; this.now = now;
    this.transaction(() => store.db.exec(`
      CREATE TABLE IF NOT EXISTS provider_draft_links(account_id TEXT NOT NULL,draft_id TEXT NOT NULL UNIQUE,revision INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(account_id,draft_id));
      CREATE TABLE IF NOT EXISTS provider_draft_operations(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,draft_id TEXT NOT NULL,state TEXT NOT NULL,owner TEXT NOT NULL,owner_pid INTEGER NOT NULL,data TEXT NOT NULL,raw BLOB,raw_hash TEXT,decoded_hash TEXT);
      CREATE INDEX IF NOT EXISTS provider_draft_operation_scope ON provider_draft_operations(account_id,draft_id,id);
      CREATE INDEX IF NOT EXISTS provider_draft_pending ON provider_draft_links(CASE WHEN json_valid(data) THEN json_extract(data,'$.state') END);
      CREATE TABLE IF NOT EXISTS provider_draft_discards(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,draft_id TEXT NOT NULL,client_key TEXT NOT NULL,fingerprint TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(account_id,client_key));
    `));
  }
  transaction<T>(fn: () => T): T {
    if (this.store.db.isTransaction) return fn();
    this.store.db.exec('BEGIN IMMEDIATE'); try { const value = fn(); this.store.db.exec('COMMIT'); return value; } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
  }
  account(accountId: string): Account {
    if (typeof accountId !== 'string' || !accountId || Buffer.byteLength(accountId) > 1024 || /[\x00-\x20\x7f]/.test(accountId)) providerDraftInvalid();
    const row = this.store.db.prepare("SELECT data FROM records WHERE kind='account' AND id=?").get(accountId); if (!row) providerDraftMissing();
    let account: Account; try { account = JSON.parse(String(row.data)); } catch { return providerDraftCorrupt(); }
    if (!account || account.id !== accountId || !['demo','google'].includes(account.provider) || typeof account.email !== 'string') providerDraftCorrupt(); return account;
  }
  draft(accountId: string, draftId: string): Draft | undefined {
    this.account(accountId); if (!keys(draftId)) providerDraftInvalid();
    const row = this.store.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=? AND CASE WHEN json_valid(data) THEN json_extract(data,'$.accountId') END=?").get(draftId, accountId); if (!row) return;
    let draft: Draft; try { draft = JSON.parse(String(row.data)); } catch { return providerDraftCorrupt(); }
    if (!draft || draft.id !== draftId || draft.accountId !== accountId) providerDraftCorrupt(); return draft;
  }
  link(accountId: string, draftId: string): ProviderDraftLink | undefined {
    this.account(accountId); if (!keys(draftId)) providerDraftInvalid();
    const row = this.store.db.prepare('SELECT revision,data FROM provider_draft_links WHERE account_id=? AND draft_id=?').get(accountId, draftId); if (!row) return;
    let value: ProviderDraftLink; try { value = JSON.parse(String(row.data)); } catch { return providerDraftCorrupt(); }
    if (!value || value.accountId !== accountId || value.draftId !== draftId || !revision(value.revision) || value.revision !== row.revision || !states.has(value.state) || value.state === 'unmanaged' || !/^[A-Za-z0-9_-]{32}$/.test(value.ownerMarker) || !['composer','reply','forward','ai-created','ai-send','auto-generated-managed'].includes(value.origin) || !timestamp(value.createdAt) || !value.replyContext || ![value.replyContext.internetMessageId,value.replyContext.references,value.replyContext.providerThreadId].every(v=>v===null||typeof v==='string'&&v.length<=16384) || (value.desiredRevision===null)!==(value.desiredHash===null) || (value.syncedRevision===null)!==(value.syncedHash===null) || ![value.desiredRevision,value.syncedRevision].every(v => v === null || revision(v)) || ![value.desiredHash,value.syncedHash].every(v => v === null || sha(v)) || ![value.providerDraftId,value.providerMessageId,value.providerThreadId].every(providerId) || ![value.activeOperationId,value.discardId].every(v => v === null || keys(v)) || !errorValid(value.error)) providerDraftCorrupt();
    if(value.origin==='auto-generated-managed'){if(!value.generated||value.generated.policy!=='generated-enrollment-v1'||!generatedScopeValid(value.generated.scope)||value.generated.scope.accountId!==accountId||value.generated.ownerFingerprint!==generatedHash({scope:value.generated.scope,ownerMarker:value.ownerMarker}))providerDraftCorrupt()}else if(value.generated!==undefined)providerDraftCorrupt();
    if(value.state==='synced'){
      if(!value.activeOperationId||!value.providerDraftId||!value.providerMessageId||value.desiredRevision===null||value.desiredRevision!==value.syncedRevision||!value.desiredHash||value.desiredHash!==value.syncedHash)providerDraftCorrupt();
      let op:ProviderDraftOperation;try{op=this.operation(accountId,draftId,value.activeOperationId)}catch{return providerDraftCorrupt()}
      if(!['create','update'].includes(op.kind)||op.state!=='confirmed'||op.resolution!=='matching-snapshot'||!op.result||op.contentHash!==value.syncedHash||op.draftRevision>value.syncedRevision!||op.result.providerDraftId!==value.providerDraftId||op.result.providerMessageId!==value.providerMessageId||op.result.providerThreadId!==value.providerThreadId)providerDraftCorrupt();
    }
    return value;
  }
  saveLink(value: ProviderDraftLink): ProviderDraftLink {
    if (!this.store.db.isTransaction) throw new Error('Cloud draft transition requires a transaction');
    const old = this.link(value.accountId, value.draftId);
    if (!old || old.ownerMarker !== value.ownerMarker || old.origin !== value.origin || generatedHash(old.generated??null)!==generatedHash(value.generated??null) || old.createdAt !== value.createdAt || providerDraftHash(old.replyContext) !== providerDraftHash(value.replyContext) || old.revision !== value.revision || old.providerDraftId && old.providerDraftId !== value.providerDraftId || ['discarded','consumed'].includes(old.state) && value.state !== old.state || value.revision >= Number.MAX_SAFE_INTEGER) providerDraftCorrupt();
    const next = { ...value, revision: value.revision + 1 };
    this.store.db.prepare('UPDATE provider_draft_links SET revision=?,data=? WHERE account_id=? AND draft_id=? AND revision=?').run(next.revision, JSON.stringify(next), next.accountId, next.draftId, value.revision);
    return this.link(value.accountId, value.draftId)!;
  }
  enroll(draft: Draft, origin: ProviderDraftOrigin, scope?:GeneratedPublicationScope): ProviderDraftLink | undefined {
    return this.transaction(() => {
      const account = this.account(draft.accountId);
      if (account.provider !== 'google') return;
      if (!['composer','reply','forward','ai-created','ai-send','auto-generated-managed'].includes(origin) || !keys(draft.id) || !revision(draft.revision) || draft.revision < 1 || draft.providerDraftId || this.link(draft.accountId,draft.id)) throw new HttpError(409, 'Only a newly replica-created draft can be enrolled', 'provider_draft_enrollment_conflict');
      if(origin==='auto-generated-managed'?!scope||!generatedScopeValid(scope)||scope.accountId!==draft.accountId||scope.threadId!==draft.threadId:scope!==undefined)throw new HttpError(409,'Invalid generated enrollment scope','provider_draft_enrollment_conflict');
      const current = this.draft(draft.accountId,draft.id);
      if (!current || providerDraftHash(current) !== providerDraftHash(draft)) throw new HttpError(409, 'The new draft identity changed', 'provider_draft_scope_changed');
      let previous=draft.deliveryReplyContext,providerThreadId=previous?.providerThreadId;
      if(draft.threadId&&!previous){const row=this.store.db.prepare("SELECT r.data FROM thread_summaries s JOIN records r ON r.kind='thread' AND r.id=s.id WHERE s.account_id=? AND s.id=?").get(draft.accountId,draft.threadId);if(!row)throw new HttpError(409,'The reply target is not in this account','provider_draft_scope_changed');const thread=JSON.parse(String(row.data));previous=thread.messages?.at(-1);providerThreadId=thread.providerId;}
      const value: ProviderDraftLink = { accountId: draft.accountId, draftId: draft.id, revision: 0, ownerMarker: randomBytes(24).toString('base64url'), origin, createdAt: new Date(this.now()).toISOString(), replyContext:{internetMessageId:previous?.internetMessageId??null,references:previous?.references??null,providerThreadId:providerThreadId??null}, state: 'idle', desiredRevision: null, desiredHash: null, syncedRevision: null, syncedHash: null, providerDraftId: null, providerMessageId: null, providerThreadId: null, activeOperationId: null, discardId: null, error: null };
      if(scope)value.generated={policy:'generated-enrollment-v1',scope:structuredClone(scope),ownerFingerprint:generatedHash({scope,ownerMarker:value.ownerMarker})};
      this.store.db.prepare('INSERT INTO provider_draft_links VALUES(?,?,?,?)').run(value.accountId,value.draftId,0,JSON.stringify(value)); return value;
    });
  }
  desire(draft: Draft, contentHash: string, meaningful: boolean): ProviderDraftLink | undefined {
    return this.transaction(() => {
      const current = this.link(draft.accountId,draft.id); if (!current) return;
      if (!sha(contentHash) || !revision(draft.revision) || draft.revision < 1) providerDraftInvalid();
      if (['discarded','consumed'].includes(current.state) || current.discardId) throw new HttpError(409,'The cloud draft has a terminal discard/delivery intent','provider_draft_locked');
      if(current.desiredRevision!==null&&(draft.revision<current.desiredRevision||draft.revision===current.desiredRevision&&current.desiredHash!==contentHash))throw new HttpError(409,'The desired cloud snapshot revision or identity regressed','provider_draft_revision_conflict');
      const held = ['saving','outcome_unknown','remote_conflict','discard_queued','discarding'].includes(current.state);
      const editable = ['draft','failed'].includes(draft.status) && !draft.artifactSendId && !draft.composerSendId;
      const equalSynced = !!current.providerDraftId && !!current.providerMessageId && current.syncedHash === contentHash;
      const state = held ? current.state : editable ? equalSynced ? 'synced' : meaningful ? 'queued' : 'idle' : 'suspended';
      if (current.desiredRevision === draft.revision && current.desiredHash === contentHash && current.state === state) return current;
      return this.saveLink({ ...current, desiredRevision: draft.revision, desiredHash: contentHash, ...(state === 'synced' ? {syncedRevision:draft.revision}:{}), state, error: held ? current.error : null });
    });
  }
  operation(accountId: string, draftId: string, id: string): ProviderDraftOperation {
    this.account(accountId); if (!keys(draftId) || !keys(id)) providerDraftInvalid();
    const row = this.store.db.prepare('SELECT state,data FROM provider_draft_operations WHERE account_id=? AND draft_id=? AND id=?').get(accountId,draftId,id); if (!row) providerDraftMissing();
    let op: ProviderDraftOperation; try { op = JSON.parse(String(row.data)); } catch { return providerDraftCorrupt(); }
    if (!op || op.id !== id || op.accountId !== accountId || op.draftId !== draftId || !['create','update','delete'].includes(op.kind) || !['queued','dispatching','confirmed','unknown','failed','superseded'].includes(op.state) || op.state !== row.state || !revision(op.draftRevision) || op.draftRevision < 1 || !sha(op.contentHash) || ![op.providerDraftId,op.providerMessageId,op.providerThreadId].every(providerId) || !timestamp(op.createdAt) || ![op.issuedAt,op.completedAt].every(v => v === null || timestamp(v)) || !['unverified','matching-snapshot','target-unavailable','delivery-consumed'].includes(op.resolution) || !errorValid(op.error) || op.result !== null && (!op.result || !providerId(op.result.providerDraftId) || !op.result.providerDraftId || !providerId(op.result.providerMessageId) || !op.result.providerMessageId || !providerId(op.result.providerThreadId))) providerDraftCorrupt();
    if(op.kind==='delete'){
      if(op.result!==null||!op.providerDraftId&&op.issuedAt!==null||op.state==='confirmed'&&(op.resolution!=='target-unavailable'||!op.completedAt)||op.state==='unknown'&&op.resolution==='target-unavailable'&&(!op.providerDraftId||!op.issuedAt||!op.completedAt))providerDraftCorrupt();
    }else if(op.state==='confirmed'&&(!op.result||op.resolution!=='matching-snapshot'||!op.issuedAt||!op.completedAt||op.providerDraftId&&op.result.providerDraftId!==op.providerDraftId)||op.state!=='confirmed'&&op.result!==null)providerDraftCorrupt();
    return op;
  }
  insertOperation(link: ProviderDraftLink, snapshot: ProviderDraftMimeSnapshot, kind: 'create'|'update', owner: string): ProviderDraftOperation {
    if (!this.store.db.isTransaction) throw new Error('Cloud draft claim requires a transaction');
    const prior = link.activeOperationId ? this.operation(link.accountId,link.draftId,link.activeOperationId) : null;
    if (prior && ['queued','dispatching','unknown'].includes(prior.state) || link.discardId || link.state !== 'queued' || snapshot.marker.owner !== link.ownerMarker || snapshot.marker.revision !== link.desiredRevision || snapshot.contentHash !== link.desiredHash || snapshot.raw.length > PROVIDER_DRAFT_MAX_RAW_BYTES || !sha(snapshot.decodedHash) || !sha(snapshot.rawHash) || createHash('sha256').update(snapshot.raw).digest('hex') !== snapshot.rawHash || kind === 'create' && link.providerDraftId !== null || kind === 'update' && !link.providerDraftId) throw new HttpError(409,'The queued cloud snapshot changed','provider_draft_revision_conflict');
    const at = new Date(this.now()).toISOString(), op: ProviderDraftOperation = { id:snapshot.marker.operationId,accountId:link.accountId,draftId:link.draftId,kind,state:'dispatching',draftRevision:snapshot.marker.revision,contentHash:snapshot.contentHash,providerDraftId:link.providerDraftId,providerMessageId:link.providerMessageId,providerThreadId:link.providerThreadId,result:null,createdAt:at,issuedAt:at,completedAt:null,resolution:'unverified',error:null };
    this.store.db.prepare('INSERT INTO provider_draft_operations VALUES(?,?,?,?,?,?,?,?,?,?)').run(op.id,op.accountId,op.draftId,op.state,owner,process.pid,JSON.stringify(op),snapshot.raw,snapshot.rawHash,snapshot.decodedHash);
    this.saveLink({ ...link, state:'saving',activeOperationId:op.id,error:null }); return op;
  }
  saveOperation(op: ProviderDraftOperation): void {
    if (!this.store.db.isTransaction) throw new Error('Cloud draft result requires a transaction');
    const old = this.operation(op.accountId,op.draftId,op.id);
    const identity = (v: ProviderDraftOperation) => ({ id:v.id,accountId:v.accountId,draftId:v.draftId,kind:v.kind,draftRevision:v.draftRevision,contentHash:v.contentHash,providerDraftId:v.providerDraftId,providerMessageId:v.providerMessageId,providerThreadId:v.providerThreadId,createdAt:v.createdAt,issuedAt:v.issuedAt });
    if (providerDraftHash(identity(old)) !== providerDraftHash(identity(op)) || old.result && providerDraftHash(old.result) !== providerDraftHash(op.result) || ['confirmed','failed','superseded'].includes(old.state) && old.state !== op.state) providerDraftCorrupt();
    this.store.db.prepare('UPDATE provider_draft_operations SET state=?,data=? WHERE account_id=? AND draft_id=? AND id=?').run(op.state,JSON.stringify(op),op.accountId,op.draftId,op.id);
    this.operation(op.accountId,op.draftId,op.id);
  }
  payload(accountId: string, draftId: string, id: string): ProviderDraftMimeSnapshot {
    const op = this.operation(accountId,draftId,id), link = this.link(accountId,draftId); if (!link) providerDraftCorrupt();
    const row = this.store.db.prepare('SELECT raw,raw_hash,decoded_hash FROM provider_draft_operations WHERE account_id=? AND draft_id=? AND id=?').get(accountId,draftId,id); if (!row?.raw || !sha(row.raw_hash) || !sha(row.decoded_hash)) providerDraftCorrupt();
    const raw = Buffer.from(row.raw as Uint8Array);
    if (!raw.length || raw.length > PROVIDER_DRAFT_MAX_RAW_BYTES || createHash('sha256').update(raw).digest('hex') !== row.raw_hash) providerDraftCorrupt();
    let markerOperationId=op.id;
    if(op.kind==='delete'){const sources=this.store.db.prepare("SELECT id FROM provider_draft_operations WHERE account_id=? AND draft_id=? AND state='confirmed' AND json_extract(data,'$.kind') IN ('create','update') AND json_extract(data,'$.result.providerDraftId')=? AND json_extract(data,'$.result.providerMessageId')=? LIMIT 2").all(accountId,draftId,op.providerDraftId,op.providerMessageId);if(sources.length!==1)providerDraftCorrupt();const source=this.operation(accountId,draftId,String(sources[0].id));if(source.draftRevision!==op.draftRevision||source.contentHash!==op.contentHash)providerDraftCorrupt();markerOperationId=source.id;}
    return { raw,rawHash:row.raw_hash,decodedHash:row.decoded_hash,contentHash:op.contentHash,marker:{owner:link.ownerMarker,operationId:markerOperationId,revision:op.draftRevision,contentHash:op.contentHash},...(op.providerThreadId ? {threadId:op.providerThreadId}: {}) };
  }
  discardFingerprint(draftId:string,input:ProviderDraftDiscardRequest){return providerDraftHash({kind:'provider-draft-discard',accountId:input.accountId,draftId,expectedDraftRevision:input.expectedDraftRevision,expectedContentHash:input.expectedContentHash,expectedSyncRevision:input.expectedSyncRevision})}
  discardByRequest(accountId:string,draftId:string,key:string):ProviderDraftDiscardResponse{
    this.account(accountId);if(!keys(draftId)||!keys(key))providerDraftInvalid();
    const row=this.store.db.prepare('SELECT fingerprint,data FROM provider_draft_discards WHERE account_id=? AND draft_id=? AND client_key=?').get(accountId,draftId,key);if(!row)providerDraftMissing();
    let receipt:ProviderDraftDiscardReceipt;try{receipt=JSON.parse(String(row.data))}catch{return providerDraftCorrupt()}
    if(!receipt||!keys(receipt.id)||receipt.accountId!==accountId||receipt.draftId!==draftId||receipt.clientRequestId!==key||!keys(receipt.operationId)||!revision(receipt.draftRevision)||receipt.draftRevision<1||!sha(receipt.contentHash)||!revision(receipt.acceptedSyncRevision)||!timestamp(receipt.acceptedAt)||row.fingerprint!==this.discardFingerprint(draftId,{accountId,clientRequestId:key,expectedDraftRevision:receipt.draftRevision,expectedContentHash:receipt.contentHash,expectedSyncRevision:receipt.acceptedSyncRevision}))providerDraftCorrupt();
    const link=this.link(accountId,draftId);if(!link||link.discardId!==receipt.id)providerDraftCorrupt();
    const providerDraft=this.snapshot(accountId,draftId),op=providerDraft.operation;
    const resolution=link.state==='discarded'?op&&op.kind==='delete'&&(op.state==='unknown'||op.providerDraftId&&!op.issuedAt)?'unavailable':'discarded':'pending';
    if(op?.id===receipt.operationId||link.state==='discarded'){
      if(!op||op.id!==receipt.operationId||op.kind!=='delete'||op.result!==null||op.providerDraftId!==link.providerDraftId||op.providerMessageId!==link.providerMessageId||op.providerThreadId!==link.providerThreadId)providerDraftCorrupt();
      if(link.providerDraftId){if(!link.providerMessageId||link.syncedRevision===null||!link.syncedHash||op.contentHash!==link.syncedHash||op.draftRevision>link.syncedRevision)providerDraftCorrupt();}
      else if(op.providerMessageId!==null||op.providerThreadId!==null||op.issuedAt!==null||op.contentHash!==receipt.contentHash||op.draftRevision!==receipt.draftRevision)providerDraftCorrupt();
      if(link.state==='discarded'&&(!['confirmed','unknown'].includes(op.state)||op.resolution!=='target-unavailable'))providerDraftCorrupt();
    }
    return{receipt,providerDraft,resolution};
  }
  createDiscardReceipt(link:ProviderDraftLink,input:ProviderDraftDiscardRequest):ProviderDraftDiscardReceipt{
    if(!this.store.db.isTransaction)throw new Error('Discard acceptance requires a transaction');
    const receipt:ProviderDraftDiscardReceipt={id:randomUUID(),accountId:link.accountId,draftId:link.draftId,clientRequestId:input.clientRequestId,operationId:randomUUID(),draftRevision:input.expectedDraftRevision,contentHash:input.expectedContentHash,acceptedSyncRevision:input.expectedSyncRevision,acceptedAt:new Date(this.now()).toISOString()};
    this.store.db.prepare('INSERT INTO provider_draft_discards VALUES(?,?,?,?,?,?)').run(receipt.id,receipt.accountId,receipt.draftId,receipt.clientRequestId,this.discardFingerprint(link.draftId,input),JSON.stringify(receipt));return receipt;
  }
  currentDiscard(link:ProviderDraftLink):ProviderDraftDiscardReceipt{
    if(!link.discardId)providerDraftCorrupt();const row=this.store.db.prepare('SELECT client_key FROM provider_draft_discards WHERE id=? AND account_id=? AND draft_id=?').get(link.discardId,link.accountId,link.draftId);if(!row)providerDraftCorrupt();return this.discardByRequest(link.accountId,link.draftId,String(row.client_key)).receipt;
  }
  insertDeleteOperation(link:ProviderDraftLink,receipt:ProviderDraftDiscardReceipt,snapshot:ProviderDraftMimeSnapshot|null,owner:string,issued:boolean):ProviderDraftOperation{
    if(!this.store.db.isTransaction)throw new Error('Discard claim requires a transaction');
    if(!receipt.operationId||link.discardId!==receipt.id||receipt.accountId!==link.accountId||receipt.draftId!==link.draftId||link.state!=='discard_queued'||issued&&!snapshot||snapshot&&(!link.providerDraftId||snapshot.marker.owner!==link.ownerMarker||snapshot.contentHash!==link.syncedHash))providerDraftCorrupt();
    const at=new Date(this.now()).toISOString(),op:ProviderDraftOperation={id:receipt.operationId,accountId:link.accountId,draftId:link.draftId,kind:'delete',state:issued?'dispatching':'confirmed',draftRevision:snapshot?.marker.revision??receipt.draftRevision,contentHash:snapshot?.contentHash??receipt.contentHash,providerDraftId:link.providerDraftId,providerMessageId:link.providerMessageId,providerThreadId:link.providerThreadId,result:null,createdAt:at,issuedAt:issued?at:null,completedAt:issued?null:at,resolution:issued?'unverified':'target-unavailable',error:null};
    this.store.db.prepare('INSERT INTO provider_draft_operations VALUES(?,?,?,?,?,?,?,?,?,?)').run(op.id,op.accountId,op.draftId,op.state,owner,process.pid,JSON.stringify(op),snapshot?.raw??null,snapshot?.rawHash??null,snapshot?.decodedHash??null);
    this.saveLink({...link,activeOperationId:op.id,state:issued?'discarding':'discarded',error:null});return op;
  }
  pruneSnapshots(accountId:string,draftId:string,keepId:string|null){
    if(!this.store.db.isTransaction)throw new Error('Snapshot retention requires a transaction');
    this.store.db.prepare("UPDATE provider_draft_operations SET raw=NULL WHERE account_id=? AND draft_id=? AND state='confirmed' AND (? IS NULL OR id<>?)").run(accountId,draftId,keepId,keepId);
  }
  snapshot(accountId: string, draftId: string): ProviderDraftSnapshot {
    const link = this.link(accountId,draftId);
    if (!link) { if (!this.draft(accountId,draftId)) providerDraftMissing(); return { accountId,draftId,ownership:'unmanaged',revision:0,state:'unmanaged',desiredRevision:null,desiredHash:null,syncedRevision:null,syncedHash:null,providerDraftId:null,providerMessageId:null,providerThreadId:null,operation:null,error:null,deliveryBlocked:false }; }
    const { ownerMarker: _owner,origin: _origin,createdAt: _at,replyContext:_reply,activeOperationId,discardId: _discard,generated:_generated,...value } = link;
    let operation: ProviderDraftOperation | null = null;
    if (activeOperationId) try { operation = this.operation(accountId,draftId,activeOperationId); } catch { return providerDraftCorrupt(); }
    return { ...value,ownership:'replica-new',operation,deliveryBlocked:!['idle','queued','synced'].includes(link.state) };
  }
}
