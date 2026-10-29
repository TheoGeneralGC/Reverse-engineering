import {generatedHash,generatedScopeValid,type GeneratedPublicationScope,type DraftWriteContext,type ProviderDraftMetadataRequest,type ProviderMetadataVerifier,type ProviderMetadataWriter,type GeneratedMetadataPolicyVerifier,type ProviderAckWriteContext} from './generated-draft-policy.ts';
import type { KeyedDeliveryIdentity, KeyedDeliveryObserver } from './keyed-delivery-hooks.ts';
import { initializeSplitHeaders, refreshSplitHeaders } from './split-inbox-headers.ts';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Account, Thread, Draft, Label, Preferences, Attachment, DeliveryAttempt, ThreadListOptions, ContactSuggestionOptions, ContactContextOptions } from './types.ts';
import { HttpError } from './types.ts';
import { plainTextFromHtml, plainTextToHtml, sanitizeDraftHtml } from './rich-text.ts';
import { createSearchMatcher, normalizeSearchTimeZone, threadHasFolder as hasFolder } from './search.ts';
import { initializeThreadSummaries, listThreadSummaries } from './thread-list.ts';
import { initializeRecipientContacts, recipientSuggestions, refreshRecipientContacts } from './contacts.ts';
import { parseOutgoingRecipientHeaders } from './outgoing-recipients.ts';
import { initializeContactContext, contactContext } from './contact-context.ts';

export type DeliveryContext = { artifactOperationId?: string; composerOperationId?: string; reconciliation?: boolean; recovery?: boolean; trackingContinuation?: boolean };
export type DeliveryHooks = { claim: (draft: Draft, attempt: DeliveryAttempt, context: DeliveryContext) => void; complete: (draft: Draft, attempt: DeliveryAttempt, context: DeliveryContext) => void; unknown: (draft: Draft, context: DeliveryContext) => void; held?: (draft:Draft,context:DeliveryContext)=>void; resume?: (draft:Draft,context:DeliveryContext)=>void; native?: (draft:Draft,context:DeliveryContext)=>void };
export type DraftLifecycleOrigin = 'composer' | 'reply' | 'forward' | 'ai-created' | 'ai-send' | 'auto-generated-local' | 'auto-generated-managed';
export type DraftWriteCondition = { accountId: string; threadId: string; expectedRevision: number };
export type DraftLifecycleHooks = {
  beforeWrite?: (before: Draft | undefined, next: Draft, context: DraftWriteContext) => void;
  written?: (before: Draft | undefined, next: Draft, context: DraftWriteContext) => void;
  created?: (draft: Draft, origin: DraftLifecycleOrigin, scope?: GeneratedPublicationScope) => void;
  beforeRemove?: (draft: Draft, context?: { providerDiscardId?: string }) => void;
  acceptedIntent?: (draft: Draft, intent: 'discard') => void;
  deliveryReadiness?: (draft: Draft) => void;
  beforeDelivery?: (draft: Draft) => void;
  beforeNativeSend?: (draft: Draft) => void;
};
export class Store {
  private readonly keyedDeliveryObservers = new Set<KeyedDeliveryObserver>();
  registerKeyedDeliveryObserver(observer:KeyedDeliveryObserver){this.keyedDeliveryObservers.add(observer);return()=>this.keyedDeliveryObservers.delete(observer)}
  trackingDeliveryIdentity(accountId:string,source:'composer'|'artifact',operationId:string){if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tracking_delivery_bindings'").get())return undefined;const table=source==='composer'?'draft_send_operations':'ai_draft_sends',required=this.db.prepare(`SELECT tracking_required FROM ${table} WHERE account_id=? AND id=?`).get(accountId,operationId);return required?.tracking_required===1||this.db.prepare('SELECT 1 FROM tracking_delivery_bindings WHERE account_id=? AND source=? AND operation_id=?').get(accountId,source,operationId)?{accountId,source,operationId}:undefined}
  keyedDeliveryAccepted(identity:KeyedDeliveryIdentity,draft:Draft){if(!this.db.isTransaction)throw Error('Keyed acceptance requires a transaction');for(const h of this.keyedDeliveryObservers)h.accepted?.(identity,draft);if([...this.keyedDeliveryObservers].some(h=>h.trackingRequired)){const table=identity.source==='composer'?'draft_send_operations':'ai_draft_sends';if(this.db.prepare(`UPDATE ${table} SET tracking_required=1 WHERE account_id=? AND id=? AND draft_id=?`).run(identity.accountId,identity.operationId,identity.draftId).changes!==1)throw new HttpError(409,'Tracking decision owner changed','tracking_delivery_conflict')}}
  keyedDeliveryCancelled(identity:KeyedDeliveryIdentity,draft:Draft){if(!this.db.isTransaction)throw Error('Keyed cancellation requires a transaction');for(const h of this.keyedDeliveryObservers)h.cancelled?.(identity,draft)}
  trackingNeverIssued(draft:Draft,context:DeliveryContext={}):boolean{return[...this.keyedDeliveryObservers].some(h=>h.neverIssued?.(draft,context)===true)}
  holdTrackedDelivery(id:string,context:DeliveryContext={},reason='Tracking requires explicit review before Gmail issue'):boolean{
    this.db.exec('SAVEPOINT tracking_hold');try{const draft=this.get<Draft>('draft',id);if(!draft){this.db.exec('RELEASE tracking_hold');return false}if(!this.trackingNeverIssued(draft,context)){this.db.exec('RELEASE tracking_hold');return false}
      this.requireDeliveryHook(draft,context)?.held?.(draft,context);for(const h of this.keyedDeliveryObservers)h.held?.(draft,context);
      const held={...draft,status:'delivery_held' as const,error:reason};
      if(draft.deliveryAttemptId){const a=this.required<DeliveryAttempt>('delivery',draft.deliveryAttemptId);if(a.status==='sent')throw new HttpError(409,'Acknowledged delivery cannot be held','delivery_identity_conflict');this.put('delivery',a.id,{...a,status:'not_issued',error:reason})}
      this.putDeliveryDraft(held);this.db.exec('RELEASE tracking_hold');return true;
    }catch(error){this.db.exec('ROLLBACK TO tracking_hold; RELEASE tracking_hold');throw error}
  }
  resumeTrackedDelivery(id:string,context:DeliveryContext):Draft{
    if(!this.db.isTransaction)throw Error('Continuation requires its receipt transaction');const draft=this.required<Draft>('draft',id);
    if(draft.status!=='delivery_held'||!this.trackingNeverIssued(draft,context))throw new HttpError(409,'This delivery is not a never-issued hold','tracking_delivery_conflict');
    const hooks=this.requireDeliveryHook(draft,context);if(!hooks?.resume)throw new HttpError(409,'The delivery owner cannot continue','tracking_delivery_conflict');hooks.resume(draft,context);
    const op=context.composerOperationId?this.db.prepare('SELECT data FROM draft_send_operations WHERE id=?').get(context.composerOperationId):undefined;
    const mode=op?JSON.parse(String(op.data))as{mode:string;scheduledAt:string|null}:undefined;
    return this.putDeliveryDraft({...draft,status:draft.deliveryAttemptId?'sending':mode?.mode==='scheduled'?'scheduled':'send_queued',error:undefined});
  }
  private readonly draftLifecycleHooks = new Set<DraftLifecycleHooks>();
  private readonly metadataContexts = new WeakSet<object>();
  private readonly generatedMetadataVerifiers = new Set<GeneratedMetadataPolicyVerifier>();
  private readonly generatedEnrollmentVerifiers=new Set<(draft:Draft,scope:GeneratedPublicationScope,ownerFingerprint:string)=>boolean>();
  registerGeneratedEnrollmentVerifier(verify:(draft:Draft,scope:GeneratedPublicationScope,ownerFingerprint:string)=>boolean){this.generatedEnrollmentVerifiers.add(verify);return()=>this.generatedEnrollmentVerifiers.delete(verify)}
  assertGeneratedEnrollment(draft:Draft,scope:GeneratedPublicationScope,ownerFingerprint:string){let count=0;for(const verify of this.generatedEnrollmentVerifiers)if(verify(draft,scope,ownerFingerprint))count++;if(count!==1)throw new HttpError(409,'Generated publication enrollment unavailable','provider_draft_enrollment_conflict')}
  registerGeneratedMetadataVerifier(verify:GeneratedMetadataPolicyVerifier){this.generatedMetadataVerifiers.add(verify);return()=>this.generatedMetadataVerifiers.delete(verify)}
  isProviderMetadataContext(context:DraftWriteContext):context is ProviderAckWriteContext{return context.lane==='provider-ack-v1'&&this.metadataContexts.has(context)}
  preservesGeneratedMetadata(before:Draft,next:Draft,context:DraftWriteContext):boolean{
    if(!this.isProviderMetadataContext(context))return false;
    let verified=0;for(const verify of this.generatedMetadataVerifiers)if(verify(context,before,next))verified++;
    if(verified>1)throw new HttpError(500,'Ambiguous generated publication owner','auto_draft_generation_corrupt');return verified===1;
  }
  createProviderMetadataWriter(verify:ProviderMetadataVerifier):ProviderMetadataWriter{
    let closed=false;
    return{close(){closed=true},write:(request:ProviderDraftMetadataRequest)=>{
      if(closed)throw new HttpError(503,'Cloud metadata owner stopped','provider_draft_stopping');
      if(!this.db.isTransaction)throw Error('Cloud metadata requires ACK transaction');
      if(!request||Object.keys(request).sort().join(',')!=='accountId,draftId,expectedCurrentRecordFingerprint,expectedLinkRevision,operationId,patch'||!request.patch||Object.keys(request.patch).sort().join(',')!=='providerDraftId,providerDraftSyncedAt'||!Number.isSafeInteger(request.expectedLinkRevision)||request.expectedLinkRevision<0||!/^[a-f0-9]{64}$/.test(request.expectedCurrentRecordFingerprint)||!/^[A-Za-z0-9_-]{1,256}$/.test(request.patch.providerDraftId)||new Date(request.patch.providerDraftSyncedAt).toISOString()!==request.patch.providerDraftSyncedAt)throw new HttpError(400,'Invalid cloud metadata patch','provider_draft_invalid_request');
      const row=this.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=?").get(request.draftId);if(!row)return{applied:false,reason:'not-editable'};
      const before=JSON.parse(String(row.data)) as Draft;
      if(before.id!==request.draftId||before.accountId!==request.accountId||generatedHash(before)!==request.expectedCurrentRecordFingerprint)return{applied:false,reason:'local-cas-miss'};
      verify(request,before);
      if(!['draft','failed'].includes(before.status)||before.artifactSendId||before.composerSendId||before.deliveryAttemptId||this.artifactDeliveryId(before.id)||this.composerDeliveryId(before.id))return{applied:false,reason:'not-editable'};
      if(before.providerDraftId&&before.providerDraftId!==request.patch.providerDraftId)throw new HttpError(409,'Cloud draft mapping changed','provider_draft_revision_conflict');
      const next={...before,...request.patch},context:ProviderAckWriteContext={lane:'provider-ack-v1',accountId:before.accountId,draftId:before.id,operationId:request.operationId,linkRevision:request.expectedLinkRevision,currentRecordFingerprint:request.expectedCurrentRecordFingerprint};this.metadataContexts.add(context);
      this.db.exec('SAVEPOINT provider_metadata_write');
      try{for(const hook of this.draftLifecycleHooks)hook.beforeWrite?.(before,next,context);
        // Hooks can synchronously advance the provider ledger without changing
        // records.data. Recheck link/operation/owner inside this savepoint; a
        // refusal rolls back only local metadata/hooks, retaining the ACK.
        if(closed)throw new HttpError(503,'Cloud metadata owner stopped','provider_draft_stopping');
        verify(request,before);
        if(this.db.prepare("UPDATE records SET data=? WHERE kind='draft' AND id=? AND data=?").run(JSON.stringify(next),before.id,String(row.data)).changes!==1){this.db.exec('ROLLBACK TO provider_metadata_write; RELEASE provider_metadata_write');return{applied:false,reason:'local-cas-miss'}}
        for(const hook of this.draftLifecycleHooks)hook.written?.(before,next,context);
        // A written observer is equally synchronous; do not release a local
        // metadata savepoint that advanced authority or replaced this row.
        if(closed)throw new HttpError(503,'Cloud metadata owner stopped','provider_draft_stopping');
        verify(request,before);
        if(this.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=?").get(before.id)?.data!==JSON.stringify(next))throw new HttpError(409,'Cloud metadata local row changed','provider_draft_revision_conflict');
        this.db.exec('RELEASE provider_metadata_write');return{applied:true,draft:next};
      }catch(error){this.db.exec('ROLLBACK TO provider_metadata_write; RELEASE provider_metadata_write');throw error}finally{this.metadataContexts.delete(context)}
    }};
  }
  assertProviderDraftDeliveryReady(draft: Draft) { for (const hook of this.draftLifecycleHooks) hook.deliveryReadiness?.(draft); }
  assertProviderDraftNativeSend(draft: Draft) { for (const hook of this.draftLifecycleHooks) hook.beforeNativeSend?.(draft); }
  hasProviderDraftLink(draftId: string): boolean { return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='provider_draft_links'").get() && !!this.db.prepare('SELECT 1 FROM provider_draft_links WHERE draft_id=?').get(draftId); }
  registerDraftLifecycleHooks(hooks: DraftLifecycleHooks) { this.draftLifecycleHooks.add(hooks); return () => { this.draftLifecycleHooks.delete(hooks); }; }
  noteDraftIntent(draft: Draft, intent: 'discard') { if (!this.db.isTransaction) throw new Error('Draft intent observation requires its acceptance transaction'); for (const hook of this.draftLifecycleHooks) hook.acceptedIntent?.(draft, intent); }
  deliveryHooks?: DeliveryHooks;
  composerDeliveryHooks?: DeliveryHooks;
  private deliveryWriteDepth = 0;
  private putDeliveryDraft(draft: Draft): Draft { this.deliveryWriteDepth++; try { return this.put('draft', draft.id, draft); } finally { this.deliveryWriteDepth--; } }

  artifactDeliveryId(draftId: string): string | undefined { if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_draft_sends'").get()) return undefined; const row = this.db.prepare("SELECT id FROM ai_draft_sends WHERE draft_id=? AND state<>'cancelled'").get(draftId); return row ? String(row.id) : undefined; }
  composerDeliveryId(draftId:string):string|undefined{if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='draft_send_operations'").get())return undefined;const row=this.db.prepare("SELECT id FROM draft_send_operations WHERE draft_id=? AND state<>'cancelled' ORDER BY generation DESC LIMIT 1").get(draftId);return row?String(row.id):undefined;}
  cancelledDeliveryHistory(draftId:string):boolean{
    for(const table of ['ai_draft_sends','draft_send_operations'])if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)&&this.db.prepare(`SELECT 1 FROM ${table} WHERE draft_id=? AND state='cancelled'`).get(draftId))return true;return false;
  }
  private requireDeliveryHook(draft:Draft,context:DeliveryContext={}):DeliveryHooks|undefined{
    const artifact=this.artifactDeliveryId(draft.id),composer=this.composerDeliveryId(draft.id);
    if((context.artifactOperationId&&context.composerOperationId)||(context.artifactOperationId&&context.artifactOperationId!==artifact)||(context.composerOperationId&&context.composerOperationId!==composer))throw new HttpError(409,'Delivery context does not own this draft','delivery_identity_conflict');
    if((artifact||draft.artifactSendId)&&(composer||draft.composerSendId))throw new HttpError(409,'Competing delivery identities','delivery_identity_conflict');
    if(artifact||draft.artifactSendId){if(artifact!==draft.artifactSendId||!this.deliveryHooks)throw new HttpError(409,'This artifact requires its durable delivery owner','artifact_delivery_locked');return this.deliveryHooks;}
    if(composer||draft.composerSendId){if(composer!==draft.composerSendId||!this.composerDeliveryHooks)throw new HttpError(409,'This draft requires its durable delivery owner','composer_delivery_locked');return this.composerDeliveryHooks;}
    return undefined;
  }
  assertUntrackedNativeSend(draft:Draft){for(const h of this.keyedDeliveryObservers)h.untrackedNative?.(draft)}
  assertKeyedNativeSend(draft:Draft,context:DeliveryContext){this.requireDeliveryHook(draft,context)?.native?.(draft,context)}
  private assertDraftMutable(draft: Draft) { if (draft.artifactSendId || draft.composerSendId || this.artifactDeliveryId(draft.id) || this.composerDeliveryId(draft.id)) throw new HttpError(409, 'A reviewed artifact delivery cannot be edited or reused', 'artifact_delivery_locked'); }

  db: DatabaseSync;
  constructor(path: string, seed = true) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS secrets(account_id TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_states(state TEXT PRIMARY KEY,verifier TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS undo(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,data TEXT NOT NULL,expires INTEGER NOT NULL,after_data TEXT);
      CREATE TABLE IF NOT EXISTS draft_attachments(id TEXT PRIMARY KEY,draft_id TEXT NOT NULL,name TEXT NOT NULL,mime_type TEXT NOT NULL,size INTEGER NOT NULL,data BLOB NOT NULL);
      CREATE INDEX IF NOT EXISTS thread_account_lookup ON records(json_extract(data,'$.accountId')) WHERE kind='thread';
      CREATE INDEX IF NOT EXISTS thread_snooze_candidates ON records(json_extract(data,'$.snoozedUntil'))
        WHERE kind='thread' AND json_type(data,'$.snoozedUntil')='text' AND json_extract(data,'$.snoozedUntil')<>'';`);
    if (!this.db.prepare('PRAGMA table_info(undo)').all().some(row => row.name === 'after_data')) this.db.exec('ALTER TABLE undo ADD COLUMN after_data TEXT');
    if (!this.db.prepare('PRAGMA table_info(oauth_states)').all().some(row => row.name === 'context')) this.db.exec('ALTER TABLE oauth_states ADD COLUMN context TEXT');
    initializeThreadSummaries(this.db);
    initializeRecipientContacts(this.db);
    initializeContactContext(this.db);
    initializeSplitHeaders(this.db);
    if (seed && this.list<Account>('account').length === 0) this.seed();
  }
  list<T>(kind: string): T[] { return this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid').all(kind).map(r => JSON.parse(String(r.data))); }
  get<T>(kind: string, id: string): T | undefined { const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind, id); return row ? JSON.parse(String(row.data)) : undefined; }
  put<T>(kind: string, id: string, data: T): T {
    const oldDraft = kind === 'draft' ? this.get<Draft>('draft', id) : undefined;
    if (oldDraft && !this.deliveryWriteDepth) this.assertDraftMutable(oldDraft);
    const draftHooked = kind === 'draft' && this.draftLifecycleHooks.size > 0;
    if (kind === 'thread') this.db.exec('SAVEPOINT recipient_record_write');
    if (draftHooked) this.db.exec('SAVEPOINT provider_draft_record_write');
    try {
      if (draftHooked && !this.deliveryWriteDepth) for (const hook of this.draftLifecycleHooks) hook.beforeWrite?.(oldDraft, data as Draft, {lane:'authored'});
      this.db.prepare('INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind, id, JSON.stringify(data));
      if (draftHooked) { for (const hook of this.draftLifecycleHooks) hook.written?.(oldDraft, data as Draft, {lane:'authored'}); this.db.exec('RELEASE provider_draft_record_write'); }
      if (kind === 'thread') { refreshRecipientContacts(this.db, { threadId: id }); refreshSplitHeaders(this.db, { threadId: id }); this.db.exec('RELEASE recipient_record_write'); }
      return data;
    } catch (error) { if (kind === 'thread') this.db.exec('ROLLBACK TO recipient_record_write; RELEASE recipient_record_write'); if (draftHooked) this.db.exec('ROLLBACK TO provider_draft_record_write; RELEASE provider_draft_record_write'); throw error; }
  }
  remove(kind: string, id: string, context?: { providerDiscardId?: string }) {
    const hooked = kind === 'draft' && this.draftLifecycleHooks.size > 0;
    if (hooked) this.db.exec('SAVEPOINT provider_draft_remove');
    try { if (kind === 'draft') { const draft = this.get<Draft>('draft', id); if (draft) { this.assertDraftMutable(draft); for (const hook of this.draftLifecycleHooks) hook.beforeRemove?.(draft, context); } } this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id); if (hooked) this.db.exec('RELEASE provider_draft_remove'); }
    catch (error) { if (hooked) this.db.exec('ROLLBACK TO provider_draft_remove; RELEASE provider_draft_remove'); throw error; }
  }
  required<T>(kind: string, id: string): T { const row = this.get<T>(kind, id); if (!row) throw new HttpError(404, `${kind} not found`, 'not_found'); return row; }
  preferences(): Preferences { return this.get<Preferences>('preferences', 'global')!; }
  updatePreferences(value: Partial<Preferences>) { return this.put('preferences', 'global', { ...this.preferences(), ...value }); }
  threadSummaries(options: ThreadListOptions) { return listThreadSummaries(this.db, options, (accountId, query, timeZone) => new Set(this.threads(accountId, 'all', query, timeZone).map(thread => thread.id))); }
  recipientSuggestions(options: ContactSuggestionOptions) { return recipientSuggestions(this.db, options); }
  contactContext(options: ContactContextOptions) { return contactContext(this.db, options); }
  threads(accountId?: string, folder = 'inbox', query = '', timeZone?: string) {
    timeZone = normalizeSearchTimeZone(timeZone);
    query = query.trim();
    let result = accountId
      ? this.db.prepare("SELECT data FROM records WHERE kind='thread' AND json_extract(data,'$.accountId')=? ORDER BY rowid").all(accountId).map(row => JSON.parse(String(row.data)) as Thread)
      : this.list<Thread>('thread');
    if (!query) result = result.filter(t => folder === 'all' ? t.folder !== 'trash' && t.folder !== 'spam' : folder === 'starred' ? t.starred : folder === 'snoozed' ? !!t.snoozedUntil : folder === 'important' ? hasFolder(t, 'inbox') && t.important && !t.snoozedUntil : folder === 'other' ? hasFolder(t, 'inbox') && !t.important && !t.snoozedUntil : folder.startsWith('label:') ? t.labels.includes(folder.slice(6)) : hasFolder(t, folder) && !t.snoozedUntil);
    if (query) {
      result = result.filter(createSearchMatcher(query, { labels: this.list<Label>('label'), accountEmail: id => this.get<Account>('account', id)?.email, timeZone }));
    }
    return result.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }
  prepareAction(id: string, action: string, value: { until?: string; labelId?: string } = {}) {
    const before = this.required<Thread>('thread', id);
    const thread: Thread = structuredClone(before);
    switch (action) {
      case 'archive': thread.folder = 'done'; delete thread.snoozedUntil; break;
      case 'unarchive': thread.folder = 'inbox'; delete thread.snoozedUntil; delete thread.snoozeRetryAt; delete thread.snoozeError; break;
      case 'trash': thread.folder = 'trash'; delete thread.snoozedUntil; break;
      case 'spam': thread.folder = 'spam'; delete thread.snoozedUntil; break;
      case 'star': thread.starred = true; break;
      case 'unstar': thread.starred = false; break;
      case 'read': thread.unread = false; break;
      case 'unread': thread.unread = true; break;
      case 'mute': thread.muted = !thread.muted; break;
      case 'snooze': if (!value.until || !Number.isFinite(Date.parse(value.until)) || Date.parse(value.until) <= Date.now()) throw new HttpError(400, 'Snooze requires a future ISO date'); thread.snoozedUntil = new Date(value.until).toISOString(); break;
      case 'label': if (!value.labelId) throw new HttpError(400, 'labelId is required'); if (this.required<Label>('label', value.labelId).accountId !== thread.accountId) throw new HttpError(400, 'Label belongs to a different account'); thread.labels = thread.labels.includes(value.labelId) ? thread.labels.filter(x => x !== value.labelId) : [...thread.labels, value.labelId]; break;
      default: throw new HttpError(400, 'Unknown thread action');
    }
    if (thread.providerLabels) {
      const labels = new Set(thread.providerLabels);
      if (action === 'archive') labels.delete('INBOX');
      if (action === 'unarchive') { labels.add('INBOX'); labels.delete('TRASH'); labels.delete('SPAM'); }
      if (action === 'trash' || action === 'spam') { labels.delete('INBOX'); labels.add(action === 'trash' ? 'TRASH' : 'SPAM'); }
      if (action === 'star' || action === 'unstar') action === 'star' ? labels.add('STARRED') : labels.delete('STARRED');
      if (action === 'read' || action === 'unread') action === 'unread' ? labels.add('UNREAD') : labels.delete('UNREAD');
      if (action === 'label' && value.labelId) { const providerId = this.required<Label>('label', value.labelId).providerId; if (providerId) thread.labels.includes(value.labelId) ? labels.add(providerId) : labels.delete(providerId); }
      thread.providerLabels = [...labels];
    }
    return { before, thread };
  }
  commitAction(before: Thread, thread: Thread) {
    const undoId = randomUUID();
    this.db.exec('BEGIN');
    try { this.put('thread', thread.id, thread); this.db.prepare('INSERT INTO undo(id,thread_id,data,expires,after_data) VALUES(?,?,?,?,?)').run(undoId, thread.id, JSON.stringify(before), Date.now() + 300_000, JSON.stringify(thread)); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { thread, undoId };
  }
  pendingUndo(id: string): Thread {
    const row = this.db.prepare('SELECT data,expires,after_data FROM undo WHERE id=?').get(id);
    if (!row || Number(row.expires) < Date.now()) throw new HttpError(410, 'Undo expired', 'undo_expired');
    const before: Thread = JSON.parse(String(row.data));
    if (!row.after_data) throw new HttpError(409, 'This older undo record cannot safely be restored', 'undo_conflict');
    const after: Thread = JSON.parse(String(row.after_data)); const current = this.required<Thread>('thread', before.id);
    const next = { ...current } as Thread & Record<string, unknown>;
    // Restore only fields changed by this operation, preserving later unrelated
    // mutations and refusing to overwrite a newer mutation of the same field.
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const prior = (before as Thread & Record<string, unknown>)[key]; const changed = (after as Thread & Record<string, unknown>)[key];
      if ((key === 'labels' || key === 'providerLabels') && Array.isArray(prior) && Array.isArray(changed)) {
        const currentLabels = new Set((current as Thread & Record<string, unknown>)[key] as string[] ?? []);
        const added = changed.filter(label => !prior.includes(label)); const removed = prior.filter(label => !changed.includes(label));
        if (added.some(label => !currentLabels.has(label)) || removed.some(label => currentLabels.has(label))) throw new HttpError(409, 'These labels changed since the action', 'undo_conflict');
        added.forEach(label => currentLabels.delete(label)); removed.forEach(label => currentLabels.add(label)); next[key] = [...currentLabels]; continue;
      }
      if (JSON.stringify(prior) !== JSON.stringify(changed)) {
        if (JSON.stringify((current as Thread & Record<string, unknown>)[key]) !== JSON.stringify(changed)) throw new HttpError(409, 'This conversation changed since the action; undo was not applied', 'undo_conflict');
        if (prior === undefined) delete next[key]; else next[key] = prior;
      }
    }
    return next;
  }
  commitUndo(id: string, thread: Thread) { this.db.exec('BEGIN'); try { this.put('thread', thread.id, thread); this.db.prepare('DELETE FROM undo WHERE id=?').run(id); this.db.exec('COMMIT'); } catch (error) { this.db.exec('ROLLBACK'); throw error; } return thread; }
  dueSnoozes(now = Date.now(), limit = 10) {
    // ORDER BY rowid can otherwise tempt SQLite to scan its broad kind index;
    // force the matching partial index so ordinary mail is never visited here.
    const candidates = this.db.prepare("SELECT data FROM records INDEXED BY thread_snooze_candidates WHERE kind='thread' AND json_type(data,'$.snoozedUntil')='text' AND json_extract(data,'$.snoozedUntil')<>'' ORDER BY rowid").all().map(row => JSON.parse(String(row.data)) as Thread);
    // Do not lexically compare timestamps in SQL: existing offset/noncanonical
    // values and retry times retain the established JavaScript Date.parse rules.
    return candidates.filter(thread => Date.parse(thread.snoozedUntil!) <= now && (!thread.snoozeRetryAt || Date.parse(thread.snoozeRetryAt) <= now)).sort((left, right) => left.snoozedUntil!.localeCompare(right.snoozedUntil!)).slice(0, limit);
  }
  wakeSnoozes(now = Date.now()) {
    // Real providers must wake through the server's account queue before local
    // state changes. This synchronous helper remains available for demo fixtures.
    for (const thread of this.dueSnoozes(now, 100)) if (this.get<Account>('account', thread.accountId)?.provider === 'demo') { const { thread: awake } = this.prepareAction(thread.id, 'unarchive'); this.put('thread', thread.id, awake); }
  }
  saveDraft(input: Partial<Draft>, creationOrigin?: Exclude<DraftLifecycleOrigin,'auto-generated-managed'>, condition?: DraftWriteCondition): Draft {
    if (condition !== undefined) {
      if (!condition || typeof condition !== 'object' || Object.keys(condition).sort().join(',') !== 'accountId,expectedRevision,threadId' || typeof condition.accountId !== 'string' || !condition.accountId || typeof condition.threadId !== 'string' || !condition.threadId || !Number.isSafeInteger(condition.expectedRevision) || condition.expectedRevision < 0 || !input.id) throw new HttpError(400, 'Invalid conditional draft save', 'draft_invalid_request');
      this.db.exec('SAVEPOINT draft_conditional_save');
      try {
        const before = this.get<Draft>('draft', input.id), thread = this.get<Thread>('thread', condition.threadId), account = this.get<Account>('account', condition.accountId);
        if (!before || before.id !== input.id || before.accountId !== condition.accountId || before.threadId !== condition.threadId || !thread || thread.id !== condition.threadId || thread.accountId !== condition.accountId || !account || account.id !== condition.accountId || input.accountId !== undefined && input.accountId !== condition.accountId || input.threadId !== undefined && input.threadId !== condition.threadId) throw new HttpError(409, 'The scoped draft changed; reload before saving', 'draft_scope_conflict');
        const revision = before.revision ?? 0;
        if (!Number.isSafeInteger(revision) || revision < 0) throw new HttpError(500, 'The draft revision is invalid', 'draft_record_corrupt');
        if (revision !== condition.expectedRevision || revision === Number.MAX_SAFE_INTEGER) throw new HttpError(409, 'The draft changed; reload before saving', 'draft_revision_conflict');
        if (!['draft', 'failed'].includes(before.status) || before.deliveryAttemptId) throw new HttpError(409, 'The draft is locked by delivery', 'draft_locked');
        // The normal path retains all mutability/discard hooks. Its authored write,
        // guard/revision changes and this CAS share this outer rollback boundary.
        const saved = this.saveDraft(input, creationOrigin);
        this.db.exec('RELEASE draft_conditional_save');return saved;
      } catch (error) { this.db.exec('ROLLBACK TO draft_conditional_save; RELEASE draft_conditional_save');throw error; }
    }
    const old = input.id ? this.get<Draft>('draft', input.id) : undefined;
    const accountId = input.accountId ?? old?.accountId ?? this.preferences().activeAccountId;
    this.required<Account>('account', accountId);
    if (old) this.assertDraftMutable(old);
    if (old && ['sent', 'sending', 'delivery_unknown'].includes(old.status)) throw new HttpError(409, old.status === 'sent' ? 'Sent drafts cannot be changed' : 'Delivery must be reconciled before this draft can change', old.status === 'sent' ? 'already_sent' : 'delivery_requires_reconciliation');
    const content = { ...input };
    if (input.html !== undefined) { content.html = sanitizeDraftHtml(input.html); if (input.body === undefined) content.body = plainTextFromHtml(content.html); }
    else if (input.body !== undefined) content.html = undefined;
    const draft: Draft = { id: input.id ?? randomUUID(), accountId, to: '', cc: '', bcc: '', subject: '', body: '', attachments: [], status: 'draft', ...old, ...content, revision:(old?.revision??0)+1, updatedAt: new Date().toISOString() };
    if (!old && creationOrigin && this.draftLifecycleHooks.size) {
      this.db.exec('SAVEPOINT provider_draft_creation');
      try { this.put('draft', draft.id, draft); for (const hook of this.draftLifecycleHooks) hook.created?.(draft, creationOrigin); this.db.exec('RELEASE provider_draft_creation'); return draft; }
      catch (error) { this.db.exec('ROLLBACK TO provider_draft_creation; RELEASE provider_draft_creation'); throw error; }
    }
    return this.put('draft', draft.id, draft);
  }
  /** Trusted internal creation only. HTTP draft JSON cannot select this origin.
   * Publication/provenance caller must already own the enclosing transaction. */
  createGeneratedLocalDraft(input: Pick<Draft,'accountId'|'threadId'|'to'|'subject'|'body'|'html'|'deliveryReplyContext'>): Draft {
    if (!this.db.isTransaction) throw new Error('Generated draft requires atomic publication');
    return this.saveDraft({ accountId: input.accountId, threadId: input.threadId, to: input.to, cc: '', bcc: '', subject: input.subject, body: input.body, html: input.html, attachments: [], deliveryReplyContext: input.deliveryReplyContext }, 'auto-generated-local');
  }
  createGeneratedManagedDraft(input:Parameters<Store['createGeneratedLocalDraft']>[0],scope:GeneratedPublicationScope):Draft{
    if(!this.db.isTransaction||!generatedScopeValid(scope)||scope.accountId!==input.accountId||scope.threadId!==input.threadId)throw new HttpError(409,'Generated enrollment requires owned publication','provider_draft_enrollment_conflict');
    const draft=this.saveDraft({accountId:input.accountId,threadId:input.threadId,to:input.to,cc:'',bcc:'',subject:input.subject,body:input.body,html:input.html,attachments:[],deliveryReplyContext:input.deliveryReplyContext});
    for(const hook of this.draftLifecycleHooks)hook.created?.(draft,'auto-generated-managed',scope);
    if(!this.hasProviderDraftLink(draft.id))throw new HttpError(409,'Generated cloud enrollment unavailable','provider_draft_enrollment_conflict');return draft;
  }
  restoreCancelledArtifactDraft(id: string, operationId: string, at: string): Draft {
    if (!this.db.isTransaction) throw new Error('Cancelled restoration requires its operation transaction');
    const row = this.db.prepare("SELECT account_id FROM ai_draft_sends WHERE id=? AND draft_id=? AND state='cancelled' AND json_extract(data,'$.deliveryAttemptId') IS NULL").get(operationId,id);
    const draftRow=row?this.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=? AND json_extract(data,'$.accountId')=?").get(id,String(row.account_id)):undefined;
    if(!draftRow)throw new HttpError(409,'The owned cancelled draft is unavailable','ai_draft_send_not_cancellable');
    const draft=JSON.parse(String(draftRow.data))as Draft;
    if(!row||draft.accountId!==row.account_id||draft.artifactSendId!==operationId||draft.status!=='send_queued'||draft.deliveryAttemptId)throw new HttpError(409,'This draft can no longer be restored by Undo','ai_draft_send_not_cancellable');
    const restored={...draft,status:'draft' as const,artifactSendId:undefined,updatedAt:at,error:undefined};return this.putDeliveryDraft(restored);
  }
  lockComposerDraft(id:string,operationId:string,replyContext:NonNullable<Draft['deliveryReplyContext']>={}):Draft{
    if(!this.db.isTransaction)throw new Error('Composer lock requires its intent transaction');
    const draft=this.required<Draft>('draft',id),row=this.db.prepare("SELECT account_id,data FROM draft_send_operations WHERE id=? AND draft_id=? AND state='queued'").get(operationId,id);
    if(!row||row.account_id!==draft.accountId||!['draft','failed'].includes(draft.status)||draft.artifactSendId||draft.composerSendId||this.artifactDeliveryId(id)||draft.deliveryAttemptId)throw new HttpError(409,'Draft cannot be locked for this intent','draft_send_conflict');
    const op=JSON.parse(String(row.data))as {mode?:string;scheduledAt?:string|null};
    for (const hook of this.draftLifecycleHooks) hook.beforeDelivery?.(draft);
    return this.putDeliveryDraft({...draft,status:op.mode==='scheduled'?'scheduled':'send_queued',scheduledAt:op.mode==='scheduled'?op.scheduledAt??undefined:undefined,composerSendId:operationId,deliveryReplyContext:replyContext});
  }
  restoreCancelledComposerDraft(id:string,operationId:string,at:string):Draft{
    if(!this.db.isTransaction)throw new Error('Composer restore requires its cancellation transaction');
    const row=this.db.prepare("SELECT account_id,data FROM draft_send_operations WHERE id=? AND draft_id=? AND state='cancelled' AND json_extract(data,'$.deliveryAttemptId') IS NULL").get(operationId,id),raw=row?this.db.prepare("SELECT data FROM records WHERE kind='draft' AND id=? AND json_extract(data,'$.accountId')=?").get(id,String(row.account_id)):undefined;
    if(!raw)throw new HttpError(409,'The owned draft cannot be restored','draft_send_not_cancellable');const draft=JSON.parse(String(raw.data))as Draft;
    const op=JSON.parse(String(row!.data))as {mode?:string;scheduledAt?:string|null};
    if(draft.composerSendId!==operationId||(op.mode==='scheduled'?(draft.status!=='scheduled'||draft.scheduledAt!==op.scheduledAt):draft.status!=='send_queued')||draft.deliveryAttemptId||draft.artifactSendId)throw new HttpError(409,'This draft has already changed delivery state','draft_send_not_cancellable');
    return this.putDeliveryDraft({...draft,status:'draft',scheduledAt:undefined,composerSendId:undefined,deliveryReplyContext:undefined,revision:(draft.revision??0)+1,error:undefined,updatedAt:at});
  }
  beginDelivery(id: string, context: DeliveryContext = {}) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const draft = this.required<Draft>('draft', id);
      if (draft.status === 'sent') throw new HttpError(409, 'Message was already sent', 'already_sent');
      if (draft.status === 'sending' || draft.status === 'delivery_unknown' || draft.status === 'delivery_held') throw new HttpError(409, 'Delivery outcome must be reconciled; this message will not be resent automatically', 'delivery_requires_reconciliation');
      if(!context.artifactOperationId&&!context.composerOperationId&&this.cancelledDeliveryHistory(id))throw new HttpError(409,'A fresh explicit keyed Send intent is required after Undo','send_intent_required');
      const hooks=this.requireDeliveryHook(draft,context);
      for (const hook of this.draftLifecycleHooks) hook.beforeDelivery?.(draft);
      parseOutgoingRecipientHeaders(draft);
      const attemptId = randomUUID(); const messageId = `<rea-${attemptId}@reconstruction.invalid>`; const marker = randomBytes(24).toString('base64url');
      const attempt: DeliveryAttempt = { id: attemptId, draftId: id, status: 'dispatching', messageId, marker, startedAt: new Date().toISOString() };
      const pending: Draft = { ...draft, status: 'sending', deliveryAttemptId: attemptId, deliveryMessageId: messageId, deliveryMarker: marker, providerMessageId: undefined, providerInternetMessageId: undefined, deliveryMarkerVerified: undefined, error: undefined, updatedAt: attempt.startedAt };
      hooks?.claim(pending,attempt,context);
      for(const h of this.keyedDeliveryObservers)h.claim?.(pending,attempt,context);
      this.put('delivery', attemptId, attempt); this.putDeliveryDraft(pending); this.db.exec('COMMIT');
      return pending;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  completeDelivery(id: string, providerMessageId?: string, providerInternetMessageId?: string, markerVerified?: boolean, context: DeliveryContext = {}) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const draft = this.required<Draft>('draft', id); if (!draft.deliveryAttemptId) throw new HttpError(409, 'No delivery attempt exists');
      const attempt = this.required<DeliveryAttempt>('delivery', draft.deliveryAttemptId); const completedAt = new Date().toISOString();
      this.put('delivery', attempt.id, { ...attempt, status: 'sent', providerMessageId, providerInternetMessageId, markerVerified, completedAt, error: undefined });
      const sent: Draft = { ...draft, status: 'sent', providerMessageId, providerInternetMessageId, deliveryMarkerVerified: markerVerified, scheduledAt: undefined, error: undefined, updatedAt: completedAt };
      this.requireDeliveryHook(draft,context)?.complete(sent,{...attempt,status:'sent',providerMessageId},context);
      for(const h of this.keyedDeliveryObservers)h.complete?.(sent,{...attempt,status:'sent',providerMessageId},context);
      this.putDeliveryDraft(sent); this.db.exec('COMMIT'); return sent;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  recordDeliveryMetadata(id: string, attemptId: string, providerMessageId: string, providerInternetMessageId: string | undefined, markerVerified: boolean) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const draft = this.required<Draft>('draft', id); const attempt = this.required<DeliveryAttempt>('delivery', attemptId); if (draft.status !== 'sent' || draft.deliveryAttemptId !== attemptId || attempt.draftId !== id || attempt.status !== 'sent' || draft.providerMessageId !== providerMessageId || attempt.providerMessageId !== providerMessageId) throw new HttpError(409, 'Delivery identity changed; metadata was not applied', 'delivery_identity_conflict'); this.put('delivery', attemptId, { ...attempt, providerInternetMessageId, markerVerified }); const updated = { ...draft, providerInternetMessageId, deliveryMarkerVerified: markerVerified }; this.putDeliveryDraft(updated); this.db.exec('COMMIT'); return updated; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  unknownDelivery(id: string, reason: string, context: DeliveryContext = {}) {
    if(this.holdTrackedDelivery(id,context))return this.required<Draft>('draft',id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Re-read under the write lock: another process may have committed an ACK
      // since its caller observed an in-flight attempt. Never downgrade sent.
      const draft = this.required<Draft>('draft', id);
      if (draft.status === 'sent') { this.db.exec('COMMIT'); return draft; }
      if (draft.deliveryAttemptId) { const attempt = this.required<DeliveryAttempt>('delivery', draft.deliveryAttemptId); this.put('delivery', attempt.id, { ...attempt, status: 'unknown', error: reason }); }
      const unknown: Draft = { ...draft, status: 'delivery_unknown', error: reason, updatedAt: new Date().toISOString() };
      if (!context.recovery) this.requireDeliveryHook(draft,context)?.unknown(unknown,context);
      for(const h of this.keyedDeliveryObservers)h.unknown?.(unknown,context);
      this.putDeliveryDraft(unknown); this.db.exec('COMMIT'); return unknown;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  recoverInterruptedDeliveries(shouldRecover: (draft: Draft) => boolean = () => true) { for (const draft of this.list<Draft>('draft')) if (draft.status === 'sending' && shouldRecover(draft)) this.unknownDelivery(draft.id, 'The process stopped during delivery. Check the provider and reconcile this attempt before any further action.', { recovery: true }); }
  addAttachment(draftId: string, input: { name: string; mimeType: string; data: string }) {
    const draft = this.required<Draft>('draft', draftId);
    if (draft.status !== 'draft' && draft.status !== 'failed') throw new HttpError(409, 'Cancel scheduling before editing attachments');
    if (!input.name || input.name.length > 255 || /[\x00-\x1f\x7f/\\]/.test(input.name)) throw new HttpError(400, 'Attachment name is invalid');
    if (!/^[a-z\d][a-z\d.+-]*\/[a-z\d][a-z\d.+-]*$/i.test(input.mimeType) || input.mimeType.length > 150) throw new HttpError(400, 'Attachment MIME type is invalid');
    if (input.data.length > Math.ceil(10 * 1024 * 1024 / 3) * 4) throw new HttpError(413, 'Each attachment must be 10 MiB or smaller');
    if (input.data.length % 4 || /[^a-z\d+/]/i.test(input.data.replace(/={1,2}$/, ''))) throw new HttpError(400, 'Attachment data must be standard base64');
    const bytes = Buffer.from(input.data, 'base64');
    if (bytes.length > 10 * 1024 * 1024) throw new HttpError(413, 'Each attachment must be 10 MiB or smaller');
    const attachments = draft.attachments ?? [];
    if (attachments.length >= 20 || attachments.reduce((n, item) => n + item.size, 0) + bytes.length > 25 * 1024 * 1024) throw new HttpError(413, 'A draft allows at most 20 attachments and 25 MiB total');
    const attachment: Attachment = { id: randomUUID(), name: input.name, mimeType: input.mimeType.toLowerCase(), size: bytes.length };
    this.db.exec('BEGIN');
    try { this.db.prepare('INSERT INTO draft_attachments VALUES(?,?,?,?,?,?)').run(attachment.id, draftId, attachment.name, attachment.mimeType, attachment.size, bytes); this.saveDraft({ id: draftId, attachments: [...attachments, attachment] }); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { draft: this.required<Draft>('draft', draftId), attachment };
  }
  attachmentBytes(draftId: string, attachmentId: string) { const row = this.db.prepare('SELECT data FROM draft_attachments WHERE id=? AND draft_id=?').get(attachmentId, draftId); if (!row) throw new HttpError(404, 'Attachment not found'); return Buffer.from(row.data as Uint8Array); }
  removeAttachment(draftId: string, attachmentId: string) { const draft = this.required<Draft>('draft', draftId); if (draft.status !== 'draft' && draft.status !== 'failed') throw new HttpError(409, 'Cancel scheduling before editing attachments'); this.attachmentBytes(draftId, attachmentId); this.db.exec('BEGIN'); try { this.db.prepare('DELETE FROM draft_attachments WHERE id=? AND draft_id=?').run(attachmentId, draftId); const next = this.saveDraft({ id: draftId, attachments: (draft.attachments ?? []).filter(item => item.id !== attachmentId) }); this.db.exec('COMMIT'); return next; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  deleteDraft(id: string, context?: { providerDiscardId?: string }) { this.assertDraftMutable(this.required<Draft>('draft', id)); this.db.exec('SAVEPOINT owned_draft_delete'); try { this.db.prepare('DELETE FROM draft_attachments WHERE draft_id=?').run(id); this.remove('draft', id, context); this.db.exec('RELEASE owned_draft_delete'); } catch (error) { this.db.exec('ROLLBACK TO owned_draft_delete; RELEASE owned_draft_delete'); throw error; } }
  replyDraft(threadId: string, mode: 'reply' | 'replyAll' | 'forward') {
    const thread = this.required<Thread>('thread', threadId); const account = this.required<Account>('account', thread.accountId); const message = thread.messages.at(-1); if (!message) throw new HttpError(400, 'Conversation has no messages');
    const own = account.email.toLowerCase(); const unique = (people: { name: string; email: string }[]) => [...new Map(people.filter(p => p.email.toLowerCase() !== own).map(p => [p.email.toLowerCase(), p.email])).values()];
    const primary = unique(message.sender.email.toLowerCase() === own ? message.to : [message.sender]);
    const to = mode === 'forward' ? [] : mode === 'reply' ? primary : unique([...(message.sender.email.toLowerCase() === own ? [] : [message.sender]), ...message.to]);
    const cc = mode === 'replyAll' ? unique(message.cc ?? []).filter(email => !to.some(p => p.toLowerCase() === email.toLowerCase())) : [];
    const forwardHeading = `\n\n---------- Forwarded message ----------\nFrom: ${message.sender.name} <${message.sender.email}>\nDate: ${message.date}\nSubject: ${thread.subject}\nTo: ${message.to.map(p => p.email).join(', ')}`;
    const forwardText = mode === 'forward' ? message.text || (message.html ? plainTextFromHtml(sanitizeDraftHtml(message.html)) : '') : '';
    const body = mode === 'forward' ? `${forwardHeading}\n\n${forwardText}` : '';
    const html = mode === 'forward' && message.html ? `${plainTextToHtml(forwardHeading)}<blockquote>${sanitizeDraftHtml(message.html)}</blockquote>` : undefined;
    return this.saveDraft({ accountId: account.id, ...(mode !== 'forward' ? { threadId } : {}), to: to.join(', '), cc: cc.join(', '), subject: `${mode === 'forward' ? /^fwd?:/i.test(thread.subject) ? '' : 'Fwd: ' : /^re:/i.test(thread.subject) ? '' : 'Re: '}${thread.subject}`, body, ...(html !== undefined ? { html } : {}) }, mode === 'forward' ? 'forward' : 'reply');
  }
  seed() {
    const account: Account = { id: 'demo', email: 'alex@demo.local', name: 'Alex Morgan', provider: 'demo', color: '#6e65cc' };
    this.put('account', account.id, account);
    this.put<Preferences>('preferences', 'global', { theme: 'light', activeAccountId: account.id, signature: 'Alex', defaultRemind: 'tomorrow', splitInbox: ['Important', 'Other'], 'Auto Advance': true, 'Hide Empty Split Inboxes': false, 'Backtick as Escape': false, 'Show Sender Full Names': true, snippets: [{ id: 'thanks', title: 'Thanks', body: 'Thanks for the update! I’ll take a look and get back to you shortly.' }, { id: 'intro', title: 'Introduction', body: 'Great to meet you. I’d love to learn more about what you’re working on.' }] });
    for (const [id, name, color] of [['work', 'Work', '#8c85df'], ['personal', 'Personal', '#6bba9d'], ['finance', 'Finance', '#d8aa68']]) this.put<Label>('label', id, { id, accountId: account.id, name, color });
    const examples = [
      ['Jordan Lee', 'jordan@example.test', 'A few thoughts on the launch', 'Hey Alex, I’ve been thinking about the launch timeline. Here’s a revised plan for next week. Would love your thoughts before we share with the team.', '10:42', true],
      ['Maya Chen', 'maya@example.test', 'Design review — Thursday', 'The latest designs are ready for your feedback. I’ve put together a few options for the dashboard and would love to walk you through them.', '10:18', true],
      ['Sam Rivera', 'sam@example.test', 'Re: Let’s grab coffee', 'Thursday works perfectly! There’s a great little place on Market Street. How does 10am sound?', '09:54', false],
      ['Linear', 'notifications@linear.example.test', 'Your weekly project update', 'Here’s what your team shipped this week. 12 issues completed, 3 projects moved forward, and a few new ideas to explore.', '09:21', false],
      ['Priya Patel', 'priya@example.test', 'Q4 planning notes', 'Sharing the notes from our planning session. The priorities are clear — now we just need to pick a date to kick things off.', '08:47', true],
      ['Taylor Brooks', 'taylor@example.test', 'Photos from the weekend', 'Such a great weekend! Here are the photos I promised. We should do this again soon.', '08:12', false],
      ['Notion', 'team@notion.example.test', 'A little inspiration for your workspace', 'A few thoughtful ways to organize your projects, ideas, and everything in between.', '07:55', false],
      ['Chris Park', 'chris@example.test', 'Quick question about the proposal', 'One quick question before I send the proposal over. Do you want to include the additional research phase in the initial scope?', '07:30', true],
      ['Morgan Ellis', 'morgan@example.test', 'Following up on our conversation', 'It was great chatting yesterday. I’m excited about the possibility of working together and wanted to share a few more details.', '06:40', false],
      ['Figma', 'hello@figma.example.test', 'Your team’s latest files', 'Catch up on the latest files and conversations from your team. A few updates are waiting for you.', '06:15', false],
      ['Jamie Wright', 'jamie@example.test', 'Dinner next week?', 'Are you around next week? It’s been too long since we caught up. Let me know what evening works best for you.', '05:50', false],
      ['Dev Team', 'dev@example.test', 'Build is ready for review', 'The new build is up on staging. All the changes from yesterday’s review are included, and the tests are passing.', '05:20', true],
    ] as const;
    examples.forEach(([name, email, subject, text, time, unread], i) => {
      const sender = { name, email }; const id = `demo-thread-${i + 1}`;
      const date = `2026-10-27T${time}:00.000Z`;
      this.put<Thread>('thread', id, { id, accountId: account.id, subject, snippet: text, sender, participants: [sender, { name: account.name, email: account.email }], lastMessageAt: date, unread, starred: i === 1, important: i !== 3 && i !== 6 && i !== 9, folder: 'inbox', labels: i % 3 === 0 ? ['work'] : [], messages: [{ id: `message-${i}`, sender, to: [{ name: account.name, email: account.email }], date, text: `Hi Alex,\n\n${text}\n\nBest,\n${name}`, attachments: i === 5 ? [{ id: 'demo-attachment', name: 'weekend-notes.txt', mimeType: 'text/plain', size: 88 }] : [] }] });
    });
    const archived = structuredClone(this.required<Thread>('thread', 'demo-thread-1')); archived.id = 'demo-archived'; archived.subject = 'Last week’s meeting notes'; archived.folder = 'done'; archived.unread = false; this.put('thread', archived.id, archived);
  }
  close() { this.db.close(); }
}
