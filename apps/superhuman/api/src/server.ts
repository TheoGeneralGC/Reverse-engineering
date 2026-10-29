import {loadAutoDraftRuntimeConfiguration} from './auto-drafts-runtime-configuration.ts';
import { loadTrackingRuntimeConfiguration } from './tracking-runtime-config.ts';
import { TrackingReadService } from './tracking-read.ts';
import { TrackingDeliveryService } from './tracking-delivery.ts';
import { TrackingPreferencesService } from './tracking-preferences.ts';
import { TrackingCollectorClient, type CollectorConfiguration } from './tracking-collector.ts';
import { SplitInboxService } from './split-inbox.ts';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './store.ts';
import { GoogleProvider } from './google.ts';
import { AiProvider } from './ai.ts';
import { AiChatService } from './ai-chat.ts';
import { AiDraftSendService } from './ai-draft-send.ts';
import { DraftSendService } from './draft-send.ts';
import { DeliveryAccelerationService } from './delivery-accelerate.ts';
import { KnowledgeService } from './knowledge.ts';
import { KNOWLEDGE_MAX_FILE_BYTES, knowledgeFilename, knowledgeKey, knowledgeObject, knowledgeRevision } from './knowledge-input.ts';
import { ProviderDraftService } from './provider-drafts.ts';
import { googleDraftTransport, type ProviderDraftTransport } from './provider-draft-transport.ts';
import { PersonalizationService } from './personalization.ts';
import { AutomationService } from './automation.ts';
import { AutoDraftsService } from './auto-drafts.ts';
import {AutoDraftsV2Authority,type AutoDraftsV2AuthorityOptions} from './auto-drafts-v2-authority.ts';
import {autoDraftReplyTimeZone} from './auto-drafts-reply-policy.ts';
import type {AutoDraftModelProfileInput} from './auto-drafts-readiness.ts';
import {Readable} from 'node:stream';
import type { AutomationFixtureClassifier } from './automation-engine.ts';
import type { AutomationConfiguration } from './automation-types.ts';
import { deliveryDeadline } from './delivery-delay.ts';
import { identifier as aiId, integer as aiInteger, invalid as aiInvalid, strictObject as aiObject } from './ai-chat-store.ts';
import { OperationQueue } from './operation-queue.ts';
import { GoogleCalendarProvider } from './calendar.ts';
import type { GoogleService } from './google-scopes.ts';
import { HttpError } from './types.ts';
import type { Account, Draft, Label, Thread, ThreadListOptions } from './types.ts';

const rootPath = fileURLToPath(new URL('../../../../', import.meta.url));
function json(response: ServerResponse, status: number, body: unknown) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(body)); }
async function body(request: IncomingMessage, limit = 1_000_000): Promise<Record<string, unknown>> {
  if (!(request.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Use application/json');
  let size = 0; const buffers: Buffer[] = []; for await (const chunk of request) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > limit) throw new HttpError(413, 'Request is too large'); buffers.push(bytes); }
  try { const value = JSON.parse(Buffer.concat(buffers).toString('utf8') || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; } catch { throw new HttpError(400, 'Invalid JSON object'); }
}
function string(value: unknown, fallback = '') { if (value === undefined) return fallback; if (typeof value !== 'string') throw new HttpError(400, 'Expected a string'); return value; }
function date(value: unknown) { const result = string(value); if (!Number.isFinite(Date.parse(result))) throw new HttpError(400, 'Expected an ISO date'); return new Date(result).toISOString(); }

export type AppScheduler = { now: () => number; schedule: (callback: () => void, delayMs: number) => { cancel: () => void } };
type SyncHealth = { status: 'queued' | 'running' | 'ready' | 'error'; updatedAt: string; error?: string; code?: string; nextSyncAt?: string; failureCount?: number; lastErrorAt?: string; lastSuccessAt?: string; requiresReconnect?: boolean; diagnostic?: { pathFamily?: string; httpStatus?: number; status?: string; reasons?: string[]; retryAfterSeconds?: number } };
const systemScheduler: AppScheduler = { now: Date.now, schedule: (callback, delayMs) => { const timer = setTimeout(callback, delayMs); timer.unref(); return { cancel: () => clearTimeout(timer) }; } };

export function resolveApplicationDatabasePath(optionPath: unknown, environmentPath: unknown, requireExplicit: boolean): string | undefined {
  if (optionPath !== undefined && (typeof optionPath !== 'string' || !optionPath.trim())) throw new TypeError('Database path must be a nonempty string');
  if (environmentPath !== undefined && typeof environmentPath !== 'string') throw new TypeError('Database path must be a string');
  const configured = optionPath as string | undefined ?? (typeof environmentPath === 'string' && environmentPath.trim() ? environmentPath : undefined);
  if (requireExplicit && !configured) throw new TypeError('Node tests require an explicit databasePath or DATABASE_PATH');
  return configured;
}

export type AutoDraftGenerationOptions=Pick<AutoDraftsV2AuthorityOptions,'processing'|'replyTimeZone'|'model'|'cursorKey'|'maximumIdentityAgeMs'>&{googleFetch?:typeof fetch;modelProfile:(accountId:string)=>AutoDraftModelProfileInput};

export function createApp(options: { databasePath?: string; env?: NodeJS.ProcessEnv; seed?: boolean; runJobs?: boolean; scheduler?: AppScheduler; aiFetch?: typeof fetch; undoWindowMs?: number; automationFixture?: AutomationFixtureClassifier<AutomationConfiguration>; providerDraftTransport?: ProviderDraftTransport; providerDraftAutomatic?: boolean; trackingCollector?: CollectorConfiguration; autoDraftGeneration?:AutoDraftGenerationOptions } = {}) {
  const unknownOptions = Object.keys(options).filter(key => !['databasePath', 'env', 'seed', 'runJobs', 'scheduler', 'aiFetch', 'undoWindowMs', 'automationFixture', 'providerDraftTransport', 'providerDraftAutomatic', 'trackingCollector', 'autoDraftGeneration'].includes(key));
  if (unknownOptions.length) throw new TypeError('Unknown application configuration option');
  if (options.providerDraftAutomatic !== undefined && typeof options.providerDraftAutomatic !== 'boolean') throw new TypeError('providerDraftAutomatic must be a boolean');
  const autoOptions=options.autoDraftGeneration;
  if(autoOptions!==undefined&&(!autoOptions||typeof autoOptions!=='object'||Array.isArray(autoOptions)||Object.keys(autoOptions).some(k=>!['processing','replyTimeZone','model','modelProfile','cursorKey','googleFetch','maximumIdentityAgeMs'].includes(k))||autoOptions.processing!==undefined&&typeof autoOptions.processing!=='boolean'||typeof autoOptions.model?.prepare!=='function'||typeof autoOptions.modelProfile!=='function'||!(autoOptions.cursorKey instanceof Uint8Array)||autoOptions.cursorKey.byteLength!==32||autoOptions.googleFetch!==undefined&&typeof autoOptions.googleFetch!=='function'))throw new TypeError('Invalid automatic draft generation configuration');
  if(autoOptions?.replyTimeZone!==undefined)autoDraftReplyTimeZone(autoOptions.replyTimeZone);
  const env = options.env ?? process.env;
  const configuredDatabase = resolveApplicationDatabasePath(options.databasePath, env.DATABASE_PATH, !!process.env.NODE_TEST_CONTEXT);
  const scheduler = options.scheduler ?? systemScheduler;
  if(options.undoWindowMs!==undefined)deliveryDeadline(scheduler.now(),options.undoWindowMs);
  const syncPollMs = 30_000; const syncContinuationMs = 1_500;
  let closing = false;
  if (options.trackingCollector !== undefined && (!options.trackingCollector || typeof options.trackingCollector !== 'object' || Array.isArray(options.trackingCollector))) throw new TypeError('Invalid tracking collector configuration');
  const trackingCollector = options.trackingCollector === undefined ? undefined : new TrackingCollectorClient({ ...options.trackingCollector, now: options.trackingCollector.now ?? Date.now });
  let store: Store;
  try { store = new Store(configuredDatabase ?? resolve(rootPath, '.local/superhuman/mail.sqlite'), options.seed ?? true); } catch (error) { trackingCollector?.close(); throw error; }
  let autoDraftGeneration:AutoDraftsV2Authority|undefined;let google:GoogleProvider;
  try{if(autoOptions){autoDraftGeneration=new AutoDraftsV2Authority(store,{...autoOptions,googleEnvironment:env,googleFetch:autoOptions.googleFetch??fetch,webOrigin:env.WEB_ORIGIN||'http://127.0.0.1:5173',now:scheduler.now});google=autoDraftGeneration.facade.runtime.google}else google=new GoogleProvider(store,env)}catch(error){store.close();trackingCollector?.close();throw error}
  try { google.migrateLegacyMailGrants(); } catch (error) { store.close(); trackingCollector?.close(); throw error; }
  let automation: AutomationService;
  try { automation = new AutomationService(store, { now: scheduler.now, fixture: options.automationFixture }); } catch (error) { store.close(); trackingCollector?.close(); throw error; }
  let autoDrafts: AutoDraftsService;
  try { autoDrafts = new AutoDraftsService(store, { now: scheduler.now }); } catch (error) { store.close(); trackingCollector?.close(); throw error; }
  let splitInboxes: SplitInboxService;
  try { splitInboxes = new SplitInboxService(store, { now: scheduler.now }); } catch (error) { store.close(); trackingCollector?.close(); throw error; }
  let tracking: TrackingPreferencesService;
  try { tracking = new TrackingPreferencesService(store, { now: scheduler.now, configuration: () => trackingCollector?.capability() ?? { configured: false, configurationFingerprint: null } }); } catch (error) { store.close(); trackingCollector?.close(); throw error; }
  const trackingBasis=options.trackingCollector&&trackingCollector?{origin:options.trackingCollector.origin,keyId:options.trackingCollector.keyId,tenant:options.trackingCollector.tenant,configurationFingerprint:trackingCollector.capability().configurationFingerprint}:null;
  const trackingDelivery=new TrackingDeliveryService(store,google,tracking,trackingCollector,{configuration:()=>trackingBasis,wallNow:options.trackingCollector?.now??Date.now,isClosing:()=>closing});
  const trackingReads=new TrackingReadService(store,tracking,trackingDelivery,trackingCollector,{now:options.trackingCollector?.now??Date.now});
  const ai = new AiProvider(store, env, options.aiFetch);
  const personalization = new PersonalizationService(store, scheduler.now);
  const calendar = new GoogleCalendarProvider(store, google, env, google.fetcher, { now: scheduler.now });
  const knowledge = new KnowledgeService(store, { now: scheduler.now, resume: options.runJobs !== false });
  const inFlightSends = new Set<string>();
  const aiChat = new AiChatService(store, env, options.aiFetch, { now: scheduler.now, isDraftLocked: id => inFlightSends.has(id) });
  const aiSend = new AiDraftSendService(store, aiChat.drafts, google, scheduler.now, undefined, { windowMs: options.undoWindowMs ?? 10000, schedule: (callback,ms)=>scheduler.schedule(callback,ms) });
  const draftSend = new DraftSendService(store, google, scheduler.now, undefined, { windowMs: options.undoWindowMs ?? 10000, schedule: (callback,ms)=>scheduler.schedule(callback,ms), isDraftLocked: id => inFlightSends.has(id) });
  const deliveryControl = new DeliveryAccelerationService(store, aiSend, draftSend, scheduler.now);
  store.recoverInterruptedDeliveries(draft => !aiSend.ownsLiveDelivery(draft.id) && !draftSend.ownsLiveDelivery(draft.id));
  if (options.runJobs !== false) aiChat.startIndexing();
  let jobsPromise: Promise<void> | undefined;
  const deliveryMetadataJobs = new Set<Promise<void>>();
  const trackingConfirmationJobs=new Set<Promise<void>>();
  function confirmTracking(draft:Draft){const operationId=draft.composerSendId??draft.artifactSendId;if(!operationId||!trackingDelivery.isTracked(draft))return;const work=trackingDelivery.confirm({accountId:draft.accountId,source:draft.composerSendId?'composer':'artifact',operationId}).catch(()=>{});trackingConfirmationJobs.add(work);void work.finally(()=>trackingConfirmationJobs.delete(work));}
  const syncs = new Map<string, Promise<unknown>>();
  const operations = new OperationQueue();
  const providerDrafts = new ProviderDraftService(store, options.providerDraftTransport ?? googleDraftTransport(google), { clock: scheduler, queue: operations, automatic: options.providerDraftAutomatic ?? options.runJobs !== false, resume: options.providerDraftAutomatic ?? options.runJobs !== false });
  const autoDraftInitializations=new Map<string,Promise<void>>(),autoDraftJobs=new Map<string,Promise<number>>();
  const autoDraftAccounts=(accountId?:string)=>store.list<Account>('account').filter(a=>a.provider==='google'&&(accountId===undefined||a.id===accountId));
  /** Explicit startup/background observation. HTTP GET never calls this. */
  async function initializeAutoDrafts(accountId?:string){
    if(!autoDraftGeneration)return;if(closing)throw new HttpError(503,'Automatic draft server stopped','auto_draft_generation_stopping');autoDraftGeneration.adoptAccounts();
    await Promise.all(autoDraftAccounts(accountId).map(account=>{const old=autoDraftInitializations.get(account.id);if(old)return old;const generation=autoDraftGeneration!;
      const work=(async()=>{await generation.install(account.id);await generation.observeModelProfile(account.id,autoOptions!.modelProfile(account.id));
        if(autoOptions?.processing===true&&generation.authority.identity(account.id).state==='unavailable'&&generation.authority.binding(account.id).capable)await operations.run(account.id,()=>generation.refreshIdentity(account.id));
        generation.facade.runtime.worker.foundation.recover((owner,pid)=>{if(owner===generation.facade.runtime.worker.foundation.owner)return true;if(!pid)return false;try{process.kill(pid,0);return true}catch{return false}});
        await generation.settle(account.id);
      })().finally(()=>{if(autoDraftInitializations.get(account.id)===work)autoDraftInitializations.delete(account.id)});autoDraftInitializations.set(account.id,work);return work;
    }));
  }
  /** Models run after provider work releases the account queue, never inside it. */
  async function runAutoDraftJobs(accountId?:string){
    if(!autoDraftGeneration||autoOptions?.processing!==true||closing)return 0;
    await initializeAutoDrafts(accountId);if(closing)return 0;
    const jobs=autoDraftAccounts(accountId).map(account=>{const existing=autoDraftJobs.get(account.id);if(existing)return existing;if(operations.tails.has(account.id))return Promise.resolve(0);const generation=autoDraftGeneration!;
      const work=(async()=>{if(closing||operations.tails.has(account.id))return 0;const row=store.db.prepare("SELECT id FROM auto_draft_jobs WHERE account_id=? AND json_extract(proof,'$.generation.state')='queued' ORDER BY CAST(json_extract(proof,'$.generation.ordinal') AS INTEGER) LIMIT 1").get(account.id);if(!row)return 0;await generation.run(account.id,String(row.id));return 1})().finally(()=>{if(autoDraftJobs.get(account.id)===work)autoDraftJobs.delete(account.id)});autoDraftJobs.set(account.id,work);return work;
    });return(await Promise.all(jobs)).reduce((a,b)=>a+b,0);
  }
  /** Observe already-owned work only; no initialization, sync or dispatch. */
  async function waitAutoDraftIdle(){while(autoDraftInitializations.size||autoDraftJobs.size||syncs.size){await Promise.allSettled([...autoDraftInitializations.values(),...autoDraftJobs.values(),...syncs.values()]);await Promise.resolve()}}
  let pendingWake: Promise<{ woken: number; failed: number }> | undefined;

  function wakeSnoozes(now = scheduler.now()) {
    store.wakeSnoozes(now);
    if (pendingWake) return pendingWake;
    pendingWake = (async () => {
      let woken = 0; let failed = 0;
      for (const candidate of store.dueSnoozes(now, 10)) {
        await operations.run(candidate.accountId, async () => {
          const current = store.get<Thread>('thread', candidate.id);
          if (!current?.snoozedUntil || Date.parse(current.snoozedUntil) > now || (current.snoozeRetryAt && Date.parse(current.snoozeRetryAt) > now)) return;
          const { before, thread } = store.prepareAction(current.id, 'unarchive');
          try {
            if (store.required<Account>('account', current.accountId).provider === 'google') await google.updateThread(before, thread);
            store.put('thread', thread.id, thread); woken++;
          } catch {
            // Keep the due item snoozed until the provider confirms INBOX. A
            // fixed retry delay bounds repeated reads and timer attempts.
            store.put('thread', current.id, { ...current, snoozeRetryAt: new Date(now + 60_000).toISOString(), snoozeError: 'Could not restore this conversation to the provider inbox. It remains snoozed and will retry.' }); failed++;
          }
        });
      }
      return { woken, failed };
    })().finally(() => { pendingWake = undefined; });
    return pendingWake;
  }

  function syncStatus(accountId: string) {
    const health = store.get<SyncHealth>('syncHealth', accountId);
    return { ...google.syncStatus(accountId), nextSyncAt: health?.nextSyncAt, failureCount: health?.failureCount ?? 0, lastErrorAt: health?.lastErrorAt, lastSuccessAt: health?.lastSuccessAt, requiresReconnect: health?.requiresReconnect ?? false, diagnostic: health?.diagnostic };
  }
  function requestSync(accountId: string) {
    const existing = syncs.get(accountId); if (existing) return existing;
    if (closing) return Promise.reject(new HttpError(503, 'Server is shutting down'));
    if (store.required<Account>('account', accountId).provider !== 'google') return Promise.reject(new HttpError(400, 'This account is a demo account'));
    const previous = store.get<SyncHealth>('syncHealth', accountId);
    // Explicit user retry can override our transient backoff, but cannot bypass
    // provider quota/rate-limit guidance by repeatedly pressing Retry.
    if (previous?.nextSyncAt && Date.parse(previous.nextSyncAt) > scheduler.now() && ['google_rate_limited', 'google_daily_quota_exceeded'].includes(previous.code ?? '')) return Promise.reject(new HttpError(429, `Google synchronization will retry after ${previous.nextSyncAt}`, 'sync_retry_pending'));
    store.put<SyncHealth>('syncHealth', accountId, { ...previous, status: 'queued', updatedAt: new Date(scheduler.now()).toISOString() });
    const promise = operations.run(accountId, async () => {
      store.put<SyncHealth>('syncHealth', accountId, { ...previous, status: 'running', updatedAt: new Date(scheduler.now()).toISOString() });
      try {
        // Never drain an import inside the account queue. Each short slice
        // releases it so queued sends and mailbox actions run before the next.
        const limits={maxPages:1,pageSize:5,catchupDuringInitial:true};const synced=autoDraftGeneration?await autoDraftGeneration.sync(accountId,limits):null;const result=synced?synced.sync:await google.sync(accountId,limits);
        const partial = result.partial === true; const now = scheduler.now();
        store.put<SyncHealth>('syncHealth', accountId, { status: 'ready', updatedAt: new Date(now).toISOString(), lastSuccessAt: new Date(now).toISOString(), failureCount: 0, nextSyncAt: new Date(now + (partial ? syncContinuationMs : syncPollMs)).toISOString() });
        return result;
      }
      catch (error) {
        const now = scheduler.now(); const failureCount = Math.min((previous?.failureCount ?? 0) + 1, 30);
        const code = error instanceof HttpError ? error.code : 'sync_failed';
        const diagnostic = (error as { diagnostic?: SyncHealth['diagnostic'] } | null)?.diagnostic;
        const seconds = diagnostic?.retryAfterSeconds;
        const providerDelay = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
        const delay = Math.max(Math.min(syncPollMs * 2 ** Math.min(failureCount - 1, 5), 15 * 60_000), providerDelay, code === 'google_daily_quota_exceeded' ? 24 * 60 * 60_000 : 0);
        const requiresReconnect = error instanceof HttpError && (error.status === 401 || error.status === 403);
        store.put<SyncHealth>('syncHealth', accountId, { status: 'error', code, error: error instanceof HttpError ? error.message : 'Mailbox synchronization failed; retry sync without reconnecting the account.', updatedAt: new Date(now).toISOString(), failureCount, lastErrorAt: new Date(now).toISOString(), lastSuccessAt: previous?.lastSuccessAt, requiresReconnect, diagnostic, ...(!requiresReconnect ? { nextSyncAt: new Date(now + delay).toISOString() } : {}) });
        throw error;
      }
    }).finally(() => syncs.delete(accountId));
    syncs.set(accountId, promise);if(autoOptions?.processing===true)void promise.then(()=>runAutoDraftJobs(accountId)).catch(()=>{}); return promise;
  }

  function runSyncJobs(now = scheduler.now()) {
    if (closing || !google.status().configured) return 0;
    let launched = 0;
    for (const account of store.list<Account>('account')) {
      if (account.provider !== 'google' || syncs.has(account.id) || operations.tails.has(account.id)) continue;
      const health = store.get<SyncHealth>('syncHealth', account.id);
      if (health?.requiresReconnect || (health?.nextSyncAt && Date.parse(health.nextSyncAt) > now)) continue;
      // Give due/soon-due authorized deliveries priority over another import
      // slice. Accounts remain independent even when one provider is slow.
      if (store.list<Draft>('draft').some(draft => draft.accountId === account.id && draft.status === 'scheduled' && !draft.composerSendId && draft.scheduledAt && Date.parse(draft.scheduledAt) <= now + 15_000) || draftSend.hasDueScheduled(account.id,now+15_000)) continue;
      launched++; void requestSync(account.id).catch(() => {});
    }
    return launched;
  }

  function assertComposerDelivery(draft: Draft, artifactOperationId?: string, composerOperationId?: string) {
    const linked = store.composerDeliveryId(draft.id);
    if ((draft.composerSendId || composerOperationId || linked) && (draft.composerSendId !== composerOperationId || linked !== composerOperationId || artifactOperationId)) throw new HttpError(409, 'Use the exact composer delivery operation', 'composer_delivery_locked');
    if (!artifactOperationId && !composerOperationId && store.cancelledDeliveryHistory(draft.id)) throw new HttpError(409, 'A fresh explicit keyed Send intent is required after Undo', 'send_intent_required');
  }
  const deliverComposer = (draftId: string, operationId: string) => deliver(draftId, undefined, operationId);
  async function deliver(id: string, artifactOperationId?: string, composerOperationId?: string, trackingContinuation=false) {
    if (closing) throw new HttpError(503, 'Server is shutting down', 'delivery_stopping');
    const selected = store.required<Draft>('draft', id);
    if ((selected.artifactSendId || artifactOperationId || store.artifactDeliveryId(id)) && (selected.artifactSendId !== artifactOperationId || store.artifactDeliveryId(id) !== artifactOperationId)) throw new HttpError(409, 'Use the original artifact Send operation; generic Send cannot redispatch it', 'artifact_delivery_locked');
    assertComposerDelivery(selected, artifactOperationId, composerOperationId);
    if (inFlightSends.has(id)) throw new HttpError(409, 'Message delivery is already in progress', 'delivery_in_progress');
    const accountId = store.required<Draft>('draft', id).accountId;
    inFlightSends.add(id);
    try { return await operations.run(accountId, () => dispatchDelivery(id, artifactOperationId, composerOperationId,trackingContinuation)); }
    finally { inFlightSends.delete(id); }
  }
  async function dispatchDelivery(id: string, artifactOperationId?: string, composerOperationId?: string,trackingContinuation=false) {
    if (closing) throw new HttpError(503, 'Server is shutting down', 'delivery_stopping');
    const draft = store.required<Draft>('draft', id);
    if ((draft.artifactSendId || artifactOperationId || store.artifactDeliveryId(id)) && (draft.artifactSendId !== artifactOperationId || store.artifactDeliveryId(id) !== artifactOperationId)) throw new HttpError(409, 'The artifact operation owns this delivery', 'artifact_delivery_locked');
    assertComposerDelivery(draft, artifactOperationId, composerOperationId);
    const deliveryContext = { artifactOperationId, composerOperationId,trackingContinuation };
    if (draft.status === 'sent') throw new HttpError(409, 'Message was already sent', 'already_sent');
    if (draft.status === 'delivery_held') throw new HttpError(409,'Use the explicit tracking continuation intent','tracking_delivery_held');
    if ((draft.status === 'sending' && !(trackingContinuation&&store.trackingNeverIssued(draft,deliveryContext))) || draft.status === 'delivery_unknown') throw new HttpError(409, 'Delivery outcome must be reconciled; this message will not be resent automatically', 'delivery_requires_reconciliation');
    // Validate all recipients before any external operation or state transition.
    google.validateDelivery(draft);
    if (store.required<Account>('account', draft.accountId).provider !== 'google') throw new HttpError(409, 'Demo accounts cannot deliver email', 'demo_delivery_disabled');
    let attemptStarted = trackingContinuation&&!!draft.deliveryAttemptId;
    try {
      await providerDrafts.checkBeforeDelivery(draft);
      if (closing) throw new HttpError(503, 'Server is shutting down', 'delivery_stopping');
      const tracked=attemptStarted?trackingDelivery.isTracked(draft,deliveryContext):await trackingDelivery.prepare(draft,deliveryContext);
      const pending = attemptStarted?draft:store.beginDelivery(id, deliveryContext); attemptStarted = true;
      const result = await (tracked?trackingDelivery.send(pending,deliveryContext):google.send(pending)) as { id?: string };
      if (!result || typeof result.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(result.id)) throw new HttpError(502, 'Gmail returned an invalid delivery acknowledgment', 'invalid_google_send_response');
      const sent=store.completeDelivery(id, result.id, undefined, undefined, deliveryContext);
      if(tracked)confirmTracking(sent);
      // The ACK is already durable. A best-effort read can enrich its final
      // provider header, but failure must never downgrade or repeat the send.
      const providerMessageId = result.id;
      const metadataJob = operations.run(pending.accountId, async () => {
        try { const current = store.required<Draft>('draft', id); if (current.status !== 'sent' || current.deliveryAttemptId !== pending.deliveryAttemptId || current.providerMessageId !== providerMessageId) return; const metadata = await google.acknowledgedDeliveryMetadata(current, providerMessageId); if (metadata) store.recordDeliveryMetadata(id, pending.deliveryAttemptId!, providerMessageId, metadata.providerInternetMessageId, metadata.markerVerified); } catch { /* An acknowledged send remains sent; no write retry or auth flow. */ }
      });
      deliveryMetadataJobs.add(metadataJob); void metadataJob.finally(() => deliveryMetadataJobs.delete(metadataJob));
      return { sent: true, result };
    } catch (error) {
      if(store.holdTrackedDelivery(id,deliveryContext))throw new HttpError(409,'Tracking is held before Gmail issue; review its status','tracking_delivery_held');
      if (attemptStarted) {
        store.unknownDelivery(id, 'Delivery could not be confirmed. Check the provider and reconcile this attempt; it will not be automatically retried.', deliveryContext);
        throw new HttpError(409, 'Delivery could not be confirmed. Reconcile this attempt before taking further action.', 'delivery_requires_reconciliation');
      }
      throw error;
    }
  }
  async function reconcileDraft(id: string) {
    const draft = store.required<Draft>('draft', id);
    if (inFlightSends.has(id) || draft.status === 'sending') throw new HttpError(409, 'Delivery is still in progress');
    if (draft.status !== 'delivery_unknown') throw new HttpError(409, 'This draft has no unknown delivery to reconcile');
    return operations.run(draft.accountId, async () => {
      const current = store.required<Draft>('draft', id); if (current.status === 'sent') return { resolved: true, draft: current };
      const result = await google.reconcileDelivery(current);
      const message = result.reason === 'legacy_attempt_unverifiable' ? 'This older attempt has no verifiable delivery marker. It remains locked; inspect the provider manually.' : result.reason === 'multiple_marker_matches' ? 'Multiple Sent messages carry this delivery marker. The attempt remains unknown and requires review.' : result.scanComplete ? 'No verified Sent match was found yet. The attempt remains unknown and will not be resent automatically.' : 'The bounded Sent check could not prove a unique match. The attempt remains unknown and will not be resent automatically.';
      const resolved=result.found?store.completeDelivery(id,result.providerMessageId,result.providerInternetMessageId,true,current.composerSendId?{composerOperationId:current.composerSendId,reconciliation:true}:aiSend.deliveryContext(current,true)):store.required<Draft>('draft',id);if(result.found)confirmTracking(resolved);
      return { resolved: result.found, matches: result.matches, scanComplete: result.scanComplete, scannedCandidates: result.scannedCandidates, reason: result.reason, draft:resolved, ...(!result.found ? { message } : {}) };
    });
  }
  function runJobs() {
    if (jobsPromise) return jobsPromise;
    if (closing) return Promise.resolve();
    jobsPromise = (async () => {
      draftSend.runScheduled(deliverComposer);
      const waking = wakeSnoozes(); const groups = new Map<string, string[]>();
      for (const draft of store.list<Draft>('draft').filter(draft => draft.status === 'scheduled' && !draft.composerSendId && !store.composerDeliveryId(draft.id))) groups.set(draft.accountId, [...(groups.get(draft.accountId) ?? []), draft.id]);
      await Promise.all([waking, runAutoDraftJobs(), ...[...groups.values()].map(async ids => { for (const id of ids) {
        const selected = store.get<Draft>('draft', id);
        if (selected?.status !== 'scheduled' || !selected.scheduledAt || Date.parse(selected.scheduledAt) > scheduler.now()) continue;
        try { await deliver(id); }
        catch (error) {
          const current = store.get<Draft>('draft', id);
          // Only a still-current, pre-dispatch scheduling failure may become
          // failed. Never downgrade sent/in-flight/unknown or a newer edit.
          if (current?.status === 'scheduled' && current.updatedAt === selected.updatedAt && !(error instanceof HttpError && error.status === 409)) store.saveDraft({ id, status: 'failed', error: error instanceof Error ? error.message : 'Delivery preflight failed' });
        }
      } })]);
    })().finally(() => { jobsPromise = undefined; });
    return jobsPromise;
  }
  let syncTimer: { cancel: () => void } | undefined; let jobTimer: { cancel: () => void } | undefined; let calendarTimer: { cancel: () => void } | undefined;
  function scheduleSyncTick(delayMs: number) { if (!closing) syncTimer = scheduler.schedule(() => { if (closing) return; runSyncJobs(); scheduleSyncTick(1000); }, delayMs); }
  function scheduleJobTick() { if (!closing) jobTimer = scheduler.schedule(() => { if (closing) return; void runJobs().catch(() => {}); scheduleJobTick(); }, 15_000); }
  function scheduleCalendarTick(delayMs: number) { if (!closing) calendarTimer = scheduler.schedule(() => { if (closing) return; calendar.runJobs(scheduler.now()); scheduleCalendarTick(1500); }, delayMs); }
  if(autoOptions&&options.runJobs!==false)void initializeAutoDrafts().catch(()=>{});
  if (options.runJobs !== false) { scheduleSyncTick(0); scheduleJobTick(); if (calendar.status().configured) scheduleCalendarTick(0); }
  const frontendOrigin = env.WEB_ORIGIN || 'http://127.0.0.1:5173';
  const allowedOrigins = new Set([frontendOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000']);
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin) && origin !== `http://${request.headers.host}`) return json(response, 403, { error: { code: 'origin_not_allowed', message: 'Origin is not allowed' } });
    if (origin) { response.setHeader('access-control-allow-origin', origin); response.setHeader('vary', 'Origin'); response.setHeader('access-control-allow-headers', 'Content-Type'); response.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS'); }
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    // Loopback-only development service; reject DNS-rebinding Host names.
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(request.headers.host ?? '')) return json(response, 403, { error: { code: 'invalid_host', message: 'Loopback Host required' } });
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const path = url.pathname; const method = request.method;
      if(path.startsWith('/api/auto-drafts/v2/')){if(!autoDraftGeneration)throw new HttpError(404,'Automatic draft generation is not configured','auto_draft_generation_not_found');const init:RequestInit&{duplex?:'half'}={method,headers:request.headers as HeadersInit};if(method!=='GET'&&method!=='HEAD'){init.body=Readable.toWeb(request) as ReadableStream<Uint8Array>;init.duplex='half'}const result=await autoDraftGeneration.handle(new Request(new URL(request.url??'/', 'http://127.0.0.1'),init));response.writeHead(result.status,Object.fromEntries(result.headers));response.end(Buffer.from(await result.arrayBuffer()));return}
      if(path.startsWith('/api/auto-drafts/')){
        const invalid=():never=>{throw new HttpError(400,'Invalid Auto Drafts request','auto_drafts_invalid_request')};
        const query=(allowed:string[])=>{if([...url.searchParams.keys()].some(k=>!allowed.includes(k)||url.searchParams.getAll(k).length!==1)||url.searchParams.getAll('accountId').length!==1||allowed.includes('section')&&url.searchParams.getAll('section').length!==1)return invalid();return Object.fromEntries(url.searchParams)};
        const input=async()=>{if(url.search)return invalid();try{return await body(request,16384)}catch(error){if(error instanceof HttpError&&[400,413,415].includes(error.status))return invalid();throw error}};
        if(path==='/api/auto-drafts/settings'&&method==='GET')return json(response,200,autoDrafts.get(query(['accountId']).accountId));
        if(path==='/api/auto-drafts/preferences'&&method==='PATCH')return json(response,200,await autoDrafts.savePreferences(await input()));
        if(path==='/api/auto-drafts/teammate-scheduling'&&method==='PUT')return json(response,200,await autoDrafts.saveScheduling(await input()));
        const recovered=path.match(/^\/api\/auto-drafts\/requests\/by-request\/([^/]+)$/);
        if(recovered&&method==='GET'){const q=query(['accountId','section']);let key:string;try{key=decodeURIComponent(recovered[1])}catch{return invalid()}return json(response,200,await autoDrafts.byRequest(q.accountId,q.section,key));}
        throw new HttpError(404,'Auto Drafts request receipt not found','auto_drafts_request_not_found');
      }
      if(path==='/api/tracking/reads'||path.startsWith('/api/tracking/reads/')){
        const query=(allowed:string[])=>{if([...url.searchParams.keys()].some(k=>!allowed.includes(k)||url.searchParams.getAll(k).length!==1)||url.searchParams.getAll('accountId').length!==1)throw new HttpError(400,'Select one read account','tracking_read_invalid_request');return Object.fromEntries(url.searchParams)};
        const decode=(v:string)=>{try{return decodeURIComponent(v)}catch{throw new HttpError(400,'Invalid read identity','tracking_read_invalid_request')}};
        if(path==='/api/tracking/reads'&&method==='GET')return json(response,200,trackingReads.view(query(['accountId']).accountId));
        if(path==='/api/tracking/reads/feed'&&method==='GET'){const q=query(['accountId','limit','cursor']);return json(response,200,trackingReads.feed(q.accountId,{...(q.limit===undefined?{}:{limit:q.limit}),...(q.cursor===undefined?{}:{cursor:q.cursor})}))}
        if(path==='/api/tracking/reads/refresh'&&method==='POST'){if(url.search)throw new HttpError(400,'Unexpected read query','tracking_read_invalid_request');const r=trackingReads.refresh(await body(request,8192));return json(response,r.status,r.response)}
        const recovered=path.match(/^\/api\/tracking\/reads\/refresh\/requests\/by-request\/([^/]+)$/);
        if(recovered&&method==='GET')return json(response,200,trackingReads.byRequest(query(['accountId']).accountId,decode(recovered[1])));
        const message=path.match(/^\/api\/tracking\/reads\/messages\/([^/]+)$/);
        if(message&&method==='GET'){const q=query(['accountId','limit','cursor']);return json(response,200,trackingReads.message(q.accountId,decode(message[1]),{...(q.limit===undefined?{}:{limit:q.limit}),...(q.cursor===undefined?{}:{cursor:q.cursor})}))}
        const target=path.match(/^\/api\/tracking\/reads\/targets\/([^/]+)$/);
        if(target&&method==='GET'){const q=query(['accountId','expectedRevision','expectedTargetVersion']);if(!/^(0|[1-9]\d*)$/.test(q.expectedRevision??'')||!q.expectedTargetVersion)throw new HttpError(400,'Invalid read target context','tracking_read_invalid_request');return json(response,200,trackingReads.target(q.accountId,decode(target[1]),Number(q.expectedRevision),q.expectedTargetVersion))}
        throw new HttpError(404,'Read evidence route not found','tracking_read_not_found');
      }
      if(path==='/api/tracking/feed'||path==='/api/tracking/capabilities'||path.startsWith('/api/tracking/deliveries/')){
        const decode=(v:string)=>{try{return decodeURIComponent(v)}catch{throw new HttpError(400,'Invalid tracking delivery identity','tracking_delivery_invalid_request')}};
        const accountQuery=()=>{if([...url.searchParams.keys()].some(k=>k!=='accountId')||url.searchParams.getAll('accountId').length!==1)throw new HttpError(400,'Select one tracking account','tracking_delivery_invalid_request');return url.searchParams.get('accountId')!};
        if(path==='/api/tracking/feed'&&method==='GET')return json(response,200,trackingDelivery.feed(accountQuery()));
        if(path==='/api/tracking/capabilities'&&method==='GET')return json(response,200,trackingDelivery.capabilities(accountQuery()));
        const match=path.match(/^\/api\/tracking\/deliveries\/(composer|artifact)\/([^/]+)(?:\/(reconcile|continue)|\/requests\/by-request\/([^/]+))?$/);
        if(!match)throw new HttpError(404,'Tracking delivery route not found','tracking_delivery_not_found');
        const source=match[1]as'composer'|'artifact',operationId=decode(match[2]);
        if(method==='GET'){const scope={accountId:accountQuery(),source,operationId};if(match[4])return json(response,200,trackingDelivery.byRequest(scope,decode(match[4])));if(!match[3])return json(response,200,trackingDelivery.status(scope))}
        if(method==='POST'&&match[3]){if(url.search)throw new HttpError(400,'Unexpected tracking query','tracking_delivery_invalid_request');const input=await body(request,8192);return json(response,200,await trackingDelivery.control({accountId:string(input.accountId),source,operationId},match[3]as'reconcile'|'continue',input,(draftId,c)=>deliver(draftId,c.artifactOperationId,c.composerOperationId,true)))}
        throw new HttpError(404,'Tracking delivery route not found','tracking_delivery_not_found');
      }
      if(path==='/api/tracking/preferences'||path.startsWith('/api/tracking/preferences/')){
        const accountQuery=()=>{if([...url.searchParams.keys()].some(key=>key!=='accountId')||url.searchParams.getAll('accountId').length!==1)throw new HttpError(400,'Select one tracking account','tracking_invalid_request');return url.searchParams.get('accountId')!};
        if(path==='/api/tracking/preferences'&&method==='GET')return json(response,200,tracking.response(accountQuery()));
        if(path==='/api/tracking/preferences'&&method==='PATCH'){if(url.search)throw new HttpError(400,'Unexpected tracking query','tracking_invalid_request');return json(response,200,tracking.save(await body(request,8192)));}
        const recovered=path.match(/^\/api\/tracking\/preferences\/requests\/by-request\/([^/]+)$/);
        if(recovered&&method==='GET'){let key:string;try{key=decodeURIComponent(recovered[1])}catch{throw new HttpError(400,'Invalid tracking key','tracking_invalid_request');}return json(response,200,tracking.byRequest(accountQuery(),key));}
        throw new HttpError(404,'Tracking preference route not found','tracking_not_found');
      }
      if(path==='/api/split-inboxes'||path.startsWith('/api/split-inboxes/')){
        const query=(allowed:string[])=>{if([...url.searchParams.keys()].some(key=>!allowed.includes(key)||url.searchParams.getAll(key).length!==1)||url.searchParams.getAll('accountId').length!==1)throw new HttpError(400,'Select one Split Inbox account','split_invalid_request');return Object.fromEntries(url.searchParams)};
        const decode=(value:string)=>{try{return decodeURIComponent(value)}catch{throw new HttpError(400,'Invalid Split Inbox identity','split_invalid_request')}};
        if(path==='/api/split-inboxes'&&method==='GET')return json(response,200,splitInboxes.settings(query(['accountId']).accountId));
        if(path==='/api/split-inboxes'&&method==='PATCH'){if(url.search)throw new HttpError(400,'Unexpected Split Inbox query','split_invalid_request');return json(response,200,splitInboxes.save(await body(request)));}
        if(path==='/api/split-inboxes/validate'&&method==='POST'){if(url.search)throw new HttpError(400,'Unexpected Split Inbox query','split_invalid_request');return json(response,200,splitInboxes.validate(await body(request,16000)));}
        if(path==='/api/split-inboxes/views'&&method==='GET')return json(response,200,splitInboxes.views(query(['accountId']).accountId));
        const recovered=path.match(/^\/api\/split-inboxes\/requests\/by-request\/([^/]+)$/);
        if(recovered&&method==='GET')return json(response,200,splitInboxes.byRequest(query(['accountId']).accountId,decode(recovered[1])));
        const view=path.match(/^\/api\/split-inboxes\/views\/([^/]+)\/threads$/);
        if(view&&method==='GET'){const q=query(['accountId','limit','cursor']);return json(response,200,splitInboxes.page(q.accountId,decode(view[1]),{limit:q.limit,cursor:q.cursor}));}
        throw new HttpError(404,'Split Inbox route not found','split_not_found');
      }
      if(path.startsWith('/api/automation/')){
        const query=()=>{if([...url.searchParams.keys()].some(key=>key!=='accountId')||url.searchParams.getAll('accountId').length!==1)throw new HttpError(400,'Select one automation account','automation_invalid_request');return url.searchParams.get('accountId')!};
        const decode=(value:string)=>{try{const id=decodeURIComponent(value);if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw Error();return id}catch{throw new HttpError(400,'Invalid automation artifact identity','automation_invalid_request')}};
        if(path==='/api/automation/settings'&&method==='GET')return json(response,200,automation.response(query()));
        if(path==='/api/automation/settings'&&method==='PATCH')return json(response,200,automation.save(query(),await body(request,262144)));
        if(path==='/api/automation/previews'&&method==='POST'){if(url.search)throw new HttpError(400,'Unexpected automation query','automation_invalid_request');const result=automation.preview(await body(request,16000));return json(response,result.accepted?202:200,{preview:result.preview});}
        const previewRequest=path.match(/^\/api\/automation\/previews\/by-request\/([^/]+)$/);
        if(previewRequest&&method==='GET')return json(response,200,{preview:automation.engine.byRequest(query(),decode(previewRequest[1]))});
        const applicationRequest=path.match(/^\/api\/automation\/applications\/by-request\/([^/]+)$/);
        if(applicationRequest&&method==='GET')return json(response,200,automation.engine.applicationByRequest(query(),decode(applicationRequest[1])));
        const preview=path.match(/^\/api\/automation\/previews\/([^/]+)(?:\/(apply))?$/);
        if(preview&&!preview[2]&&method==='GET')return json(response,200,{preview:automation.engine.get(query(),decode(preview[1]))});
        if(preview?.[2]&&method==='POST'){if(url.search)throw new HttpError(400,'Unexpected automation query','automation_invalid_request');return json(response,200,automation.apply(decode(preview[1]),await body(request,5000)));}
        throw new HttpError(404,'Automation route not found','automation_not_found');
      }
      if(path.startsWith('/api/knowledge/')){
        const query=(allowed:string[])=>{if([...url.searchParams.keys()].some(key=>!allowed.includes(key)||url.searchParams.getAll(key).length!==1))throw new HttpError(400,'Invalid knowledge query','knowledge_invalid_request');return Object.fromEntries(url.searchParams)};
        const decode=(value:string)=>{try{const id=decodeURIComponent(value);if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw Error();return id}catch{throw new HttpError(400,'Invalid knowledge source ID','knowledge_invalid_request')}};
        if(path==='/api/knowledge/status'&&method==='GET'){const q=query(['accountId']);return json(response,200,{knowledge:knowledge.status(q.accountId)});}
        if(path==='/api/knowledge/sources'&&method==='GET'){const q=query(['accountId','limit','cursor']);return json(response,200,knowledge.repository.list(q.accountId,q.limit===undefined?50:Number(q.limit),q.cursor));}
        if(path==='/api/knowledge/sources/files'&&method==='POST'){
          const q=query(['accountId','clientRequestId','name']);knowledge.repository.account(q.accountId);knowledgeFilename(q.name);knowledgeKey(q.clientRequestId);
          if((request.headers['content-type']??'').split(';')[0].trim()!=='application/octet-stream')throw new HttpError(415,'Upload the selected file as raw binary bytes','knowledge_upload_content_type');
          const declared=request.headers['content-length'];if(typeof declared==='string'&&/^\d+$/.test(declared)&&Number(declared)>KNOWLEDGE_MAX_FILE_BYTES)throw new HttpError(413,'Files must be 50 MiB or smaller','knowledge_file_too_large');
          let size=0;const chunks:Buffer[]=[];for await(const chunk of request){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>KNOWLEDGE_MAX_FILE_BYTES)throw new HttpError(413,'Files must be 50 MiB or smaller','knowledge_file_too_large');chunks.push(bytes)}
          const result=knowledge.upload(q.accountId,q.clientRequestId,q.name,Buffer.concat(chunks,size));return json(response,result.created?201:200,knowledge.repository.actionByRequest(q.accountId,q.clientRequestId));
        }
        if(path==='/api/knowledge/sources/links'&&method==='POST'){const input=knowledgeObject(await body(request,16384),['accountId','clientRequestId','url']);const result=knowledge.addLink(string(input.accountId),string(input.clientRequestId),string(input.url));return json(response,result.created?201:200,knowledge.repository.actionByRequest(string(input.accountId),string(input.clientRequestId)));}
        const recovered=path.match(/^\/api\/knowledge\/source-actions\/by-request\/([^/]+)$/);
        if(recovered&&method==='GET'){const q=query(['accountId']);return json(response,200,knowledge.repository.actionByRequest(q.accountId,decode(recovered[1])));}
        const source=path.match(/^\/api\/knowledge\/sources\/([^/]+)(?:\/(download|retry))?$/);
        if(source){const id=decode(source[1]);
          if(method==='GET'){const q=query(['accountId']),value=knowledge.repository.get(q.accountId,id);if(!source[2])return json(response,200,{source:value});if(source[2]==='download'){const bytes=knowledge.repository.blob(q.accountId,id),filename=value.file?.name??value.name+'.'+(value.link?.extension??'html'),encoded=encodeURIComponent(filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());response.writeHead(200,{'content-type':value.file?.mediaType??value.link?.mediaType??'text/html; charset=utf-8','content-disposition':`attachment; filename*=UTF-8''${encoded}`,'cache-control':'no-store','x-content-type-options':'nosniff'});response.end(bytes);return;}}
          if(!source[2]&&method==='PATCH'){const input=knowledgeObject(await body(request,65536),['accountId','expectedRevision','name','description']);if(input.name===undefined&&input.description===undefined)throw new HttpError(400,'Choose a field to save','knowledge_invalid_request');return json(response,200,{source:knowledge.repository.edit(string(input.accountId),id,knowledgeRevision(input.expectedRevision),{name:input.name,description:input.description})});}
          if(!source[2]&&method==='DELETE'){const input=knowledgeObject(await body(request,3000),['accountId','expectedRevision']);return json(response,200,knowledge.repository.remove(string(input.accountId),id,knowledgeRevision(input.expectedRevision)));}
          if(source[2]==='retry'&&method==='POST'){const input=knowledgeObject(await body(request,5000),['accountId','clientRequestId','expectedRevision']);const result=knowledge.retry(string(input.accountId),id,string(input.clientRequestId),knowledgeRevision(input.expectedRevision));return json(response,result.created?202:200,knowledge.repository.actionByRequest(string(input.accountId),string(input.clientRequestId)));}
        }
        throw new HttpError(404,'Knowledge route not found','knowledge_not_found');
      }
      if (path === '/api/personalization') {
        if ([...url.searchParams.keys()].some(key => key !== 'accountId') || url.searchParams.getAll('accountId').length !== 1) throw new HttpError(400, 'Select exactly one personalization account', 'personalization_invalid');
        const accountId = url.searchParams.get('accountId');
        if (!accountId || Buffer.byteLength(accountId) > 1024 || /[\x00-\x20\x7f]/.test(accountId)) throw new HttpError(400, 'Select a valid personalization account', 'personalization_invalid');
        if (method === 'GET') return json(response, 200, { settings: personalization.get(accountId) });
        if (method === 'PATCH') return json(response, 200, { settings: personalization.patch(accountId, await body(request)) });
        throw new HttpError(405, 'Use GET or PATCH for personalization', 'method_not_allowed');
      }
      if (path.startsWith('/api/ai/chat/')) {
        const decode = (value: string) => { try { return aiId(decodeURIComponent(value)); } catch { return aiInvalid(); } };
        const query = (keys: string[]) => { if ([...url.searchParams.keys()].some(k => !keys.includes(k) || url.searchParams.getAll(k).length !== 1)) aiInvalid(); return Object.fromEntries(url.searchParams); };
        if (path === '/api/ai/chat/status' && method === 'GET') { const q = query(['accountId']); return json(response, 200, { status: aiChat.status(aiId(q.accountId)) }); }
        const sendArtifact = path.match(/^\/api\/ai\/chat\/artifacts\/([^/]+)\/send$/);
        if (sendArtifact && method === 'GET') { const q = query(['accountId','sessionId','turnId']); return json(response,200,aiSend.get({accountId:aiId(q.accountId),sessionId:aiId(q.sessionId),turnId:aiId(q.turnId)},decode(sendArtifact[1]))); }
        if (sendArtifact && method === 'POST') { const result=aiSend.submit(decode(sendArtifact[1]),await body(request,5000)); if(result.accepted)void aiSend.execute(result.snapshot.operation!.id,deliver).catch(()=>{}); return json(response,result.accepted?202:200,result.snapshot); }
        const sendRequest = path.match(/^\/api\/ai\/chat\/send-actions\/by-request\/([^/]+)$/);
        if (sendRequest && method === 'GET') { const q=query(['accountId','sessionId','turnId','previewId']); return json(response,200,aiSend.byRequest({accountId:aiId(q.accountId),sessionId:aiId(q.sessionId),turnId:aiId(q.turnId)},aiId(q.previewId),decode(sendRequest[1]))); }
        const sendCancel=path.match(/^\/api\/ai\/chat\/send-actions\/([^/]+)\/cancel$/);
        if(sendCancel&&method==='POST')return json(response,200,aiSend.cancel(decode(sendCancel[1]),await body(request,5000)));
        const sendCancellation=path.match(/^\/api\/ai\/chat\/send-cancellations\/by-request\/([^/]+)$/);
        if(sendCancellation&&method==='GET'){const q=query(['accountId','sessionId','turnId','operationId']);return json(response,200,aiSend.byCancelRequest({accountId:aiId(q.accountId),sessionId:aiId(q.sessionId),turnId:aiId(q.turnId)},aiId(q.operationId),decode(sendCancellation[1])));}
        const sendReconcile = path.match(/^\/api\/ai\/chat\/send-actions\/([^/]+)\/reconcile$/);
        if(sendReconcile && method==='POST'){const input=aiObject(await body(request,5000),['accountId','sessionId','turnId']);const scope={accountId:aiId(input.accountId),sessionId:aiId(input.sessionId),turnId:aiId(input.turnId)};const operation=aiSend.scopedOperation(scope,decode(sendReconcile[1]));if(operation.state!=='outcome_unknown')throw new HttpError(409,'This action has no unknown delivery to reconcile','ai_draft_send_conflict');const reconciliation=await reconcileDraft(operation.draftId);return json(response,200,{...aiSend.get(scope,operation.previewId),reconciliation});}
        const artifact = path.match(/^\/api\/ai\/chat\/artifacts\/([^/]+)(?:\/(create-draft))?$/);
        if (artifact && !artifact[2] && method === 'GET') { const q = query(['accountId', 'sessionId', 'turnId']); return json(response, 200, aiChat.drafts.get({ accountId: aiId(q.accountId), sessionId: aiId(q.sessionId), turnId: aiId(q.turnId) }, decode(artifact[1]))); }
        if (artifact?.[2] === 'create-draft' && method === 'POST') { const result = aiChat.drafts.create(decode(artifact[1]), await body(request, 5000)); return json(response, result.created ? 201 : 200, result.result); }
        const draftAction = path.match(/^\/api\/ai\/chat\/draft-actions\/by-request\/([^/]+)$/);
        if (draftAction && method === 'GET') { const q = query(['accountId', 'sessionId', 'turnId', 'previewId']); return json(response, 200, aiChat.drafts.byRequest({ accountId: aiId(q.accountId), sessionId: aiId(q.sessionId), turnId: aiId(q.turnId) }, aiId(q.previewId), decode(draftAction[1]))); }
        if (path === '/api/ai/chat/sessions' && method === 'POST') { const input = aiObject(await body(request, 2000), ['accountId']); return json(response, 201, { session: aiChat.createSession(aiId(input.accountId)) }); }
        if (path === '/api/ai/chat/sessions' && method === 'GET') { const q = query(['accountId', 'limit', 'cursor']); return json(response, 200, aiChat.listSessions(aiId(q.accountId), aiInteger(q.limit, 20, 50), q.cursor)); }
        const session = path.match(/^\/api\/ai\/chat\/sessions\/([^/]+)$/);
        if (session && method === 'GET') { const q = query(['accountId', 'beforeSeq', 'limit']); return json(response, 200, aiChat.session(aiId(q.accountId), decode(session[1]), q.beforeSeq === undefined ? undefined : aiInteger(q.beforeSeq, 0, Number.MAX_SAFE_INTEGER), aiInteger(q.limit, 20, 50))); }
        const submit = path.match(/^\/api\/ai\/chat\/sessions\/([^/]+)\/turns$/);
        if (submit && method === 'POST') return json(response, 202, aiChat.submit(decode(submit[1]), await body(request, 20000)));
        const byRequest = path.match(/^\/api\/ai\/chat\/sessions\/([^/]+)\/turns\/by-request\/([^/]+)$/);
        if (byRequest && method === 'GET') { const q = query(['accountId']); return json(response, 200, aiChat.byRequest(aiId(q.accountId), decode(byRequest[1]), decode(byRequest[2]))); }
        const turn = path.match(/^\/api\/ai\/chat\/turns\/([^/]+)(?:\/(events|cancel))?$/);
        if (turn && method === 'GET' && turn[2] !== 'cancel') { const q = query(['accountId', 'sessionId', ...(turn[2] === 'events' ? ['afterSeq', 'limit'] : [])]); return json(response, 200, turn[2] === 'events' ? aiChat.events(aiId(q.accountId), aiId(q.sessionId), decode(turn[1]), aiInteger(q.afterSeq, 0, Number.MAX_SAFE_INTEGER), aiInteger(q.limit, 100, 200)) : aiChat.turn(aiId(q.accountId), aiId(q.sessionId), decode(turn[1]))); }
        if (turn && turn[2] === 'cancel' && method === 'POST') { const input = aiObject(await body(request, 3000), ['accountId', 'sessionId']); return json(response, 200, aiChat.cancel(aiId(input.accountId), aiId(input.sessionId), decode(turn[1]))); }
        const source = path.match(/^\/api\/ai\/chat\/sources\/([^/]+)$/);
        if (source && method === 'GET') { const q = query(['accountId', 'sessionId', 'turnId']); return json(response, 200, aiChat.source(aiId(q.accountId), aiId(q.sessionId), aiId(q.turnId), decode(source[1]))); }
        throw new HttpError(404, 'Chat route not found', 'ai_chat_not_found');
      }
      if(path==='/api/delivery-accelerations'&&method==='POST'){const result=deliveryControl.accelerate(await body(request,5000));if(result.created){const op=result.response.snapshot.operation!;if(result.response.source==='artifact')void aiSend.execute(op.id,deliver).catch(()=>{});else void draftSend.execute(op.id,deliverComposer).catch(()=>{});}return json(response,result.created?201:200,result.response);}
      const acceleration=path.match(/^\/api\/delivery-accelerations\/by-request\/([^/]+)$/);
      if(acceleration&&method==='GET'){const keys=['source','accountId','operationId','sessionId','turnId'];if([...url.searchParams.keys()].some(key=>!keys.includes(key)||url.searchParams.getAll(key).length!==1))aiInvalid();let key:string;try{key=aiId(decodeURIComponent(acceleration[1]))}catch{return aiInvalid()}return json(response,200,deliveryControl.byRequest(Object.fromEntries(url.searchParams),key));}
      if (path.startsWith('/api/draft-send-') || /^\/api\/drafts\/[^/]+\/send-operations$/.test(path)) {
        const decode = (value:string) => { try { return aiId(decodeURIComponent(value)); } catch { return aiInvalid(); } };
        const query = (keys:string[]) => { if ([...url.searchParams.keys()].some(key => !keys.includes(key) || url.searchParams.getAll(key).length !== 1)) aiInvalid(); return Object.fromEntries(url.searchParams); };
        const intent = path.match(/^\/api\/drafts\/([^/]+)\/send-operations$/);
        if (intent && method === 'GET') { const q=query(['accountId']); return json(response,200,draftSend.current(aiId(q.accountId),decode(intent[1]))); }
        if (intent && method === 'POST') { const result=draftSend.submit(decode(intent[1]),await body(request,5000)); if(result.accepted) void draftSend.execute(result.snapshot.operation!.id,deliverComposer).catch(()=>{}); return json(response,result.accepted?202:200,result.snapshot); }
        const byKey = path.match(/^\/api\/draft-send-operations\/by-request\/([^/]+)$/);
        if(byKey && method==='GET'){const q=query(['accountId','draftId']);return json(response,200,draftSend.byRequest(aiId(q.accountId),aiId(q.draftId),decode(byKey[1])));}
        const action = path.match(/^\/api\/draft-send-operations\/([^/]+)\/(cancel|reconcile)$/);
        if(action && method==='POST') { if(action[2]==='cancel') return json(response,200,draftSend.cancel(decode(action[1]),await body(request,5000))); const input=aiObject(await body(request,5000),['accountId']); const accountId=aiId(input.accountId),op=draftSend.operation(accountId,decode(action[1])); if(op.state!=='outcome_unknown') throw new HttpError(409,'No unknown delivery to reconcile','draft_send_conflict'); const reconciliation=await reconcileDraft(op.draftId); return json(response,200,{...draftSend.byRequest(accountId,op.draftId,op.clientRequestId),reconciliation}); }
        const cancellation = path.match(/^\/api\/draft-send-cancellations\/by-request\/([^/]+)$/);
        if(cancellation && method==='GET'){const q=query(['accountId','operationId']);return json(response,200,draftSend.byCancelRequest(aiId(q.accountId),aiId(q.operationId),decode(cancellation[1])));}
        throw new HttpError(404,'Draft delivery route not found','draft_send_not_found');
      }
      if (path === '/api/health' && method === 'GET') return json(response, 200, { ok: true, persistence: 'sqlite', mode: 'local-development' });
      if (path === '/api/provider/status' && method === 'GET') return json(response, 200, { google: google.status(), calendar: calendar.status(store.preferences().activeAccountId), microsoft: { configured: false, implemented: false }, ai: ai.status() });
      if (path === '/api/bootstrap' && method === 'GET') {
        void wakeSnoozes().catch(() => {}); const preferences = store.preferences();
        return json(response, 200, { accounts: store.list<Account>('account'), activeAccountId: preferences.activeAccountId, threads: url.searchParams.get('includeThreads') === 'false' ? [] : store.threads(preferences.activeAccountId, 'inbox'), labels: store.list<Label>('label'), drafts: store.list<Draft>('draft').filter(d => d.status !== 'sent'), preferences, providerStatus: { google: google.status(), calendar: calendar.status(preferences.activeAccountId), microsoft: { configured: false, implemented: false }, ai: ai.status() }, demo: store.required<Account>('account', preferences.activeAccountId).provider === 'demo' });
      }
      if (path === '/api/accounts' && method === 'GET') return json(response, 200, { accounts: store.list<Account>('account') });
      if (path === '/api/contacts/suggestions' && method === 'GET') return json(response, 200, store.recipientSuggestions({ accountId: url.searchParams.get('accountId') ?? store.preferences().activeAccountId, q: url.searchParams.get('q') ?? '', limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined }));
      if (path === '/api/contacts/context' && method === 'GET') {
        if (['accountId', 'email', 'excludeThreadId'].some(key => url.searchParams.getAll(key).length > 1)) throw new HttpError(400, 'Invalid contact context query', 'invalid_contact_context');
        return json(response, 200, store.contactContext({ accountId: url.searchParams.get('accountId') ?? store.preferences().activeAccountId, email: url.searchParams.get('email') ?? '', excludeThreadId: url.searchParams.get('excludeThreadId') ?? undefined }));
      }
      if (path === '/api/threads' && method === 'GET') { void wakeSnoozes().catch(() => {}); return json(response, 200, { threads: store.threads(url.searchParams.get('accountId') ?? store.preferences().activeAccountId, url.searchParams.get('folder') ?? 'inbox', url.searchParams.get('q') ?? '') }); }
      if (path === '/api/thread-summaries' && method === 'GET') {
        void wakeSnoozes().catch(() => {});
        return json(response, 200, store.threadSummaries({ accountId: url.searchParams.get('accountId') ?? store.preferences().activeAccountId, folder: url.searchParams.get('folder') ?? 'inbox', q: url.searchParams.get('q') ?? '', split: (url.searchParams.get('split') ?? 'all') as ThreadListOptions['split'], limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined, cursor: url.searchParams.get('cursor') }));
      }
      const actionMatch = path.match(/^\/api\/threads\/([^/]+)\/actions$/);
      if (actionMatch && method === 'POST') {
        const input = await body(request); const id = decodeURIComponent(actionMatch[1]); const accountId = store.required<Thread>('thread', id).accountId;
        return json(response, 200, await operations.run(accountId, async () => { const { before, thread } = store.prepareAction(id, string(input.action), { until: input.until === undefined ? undefined : date(input.until), labelId: input.labelId === undefined ? undefined : string(input.labelId) }); if (store.required<Account>('account', before.accountId).provider === 'google') await google.updateThread(before, thread); return store.commitAction(before, thread); }));
      }
      const threadMatch = path.match(/^\/api\/threads\/([^/]+)$/);
      if (threadMatch && method === 'GET') return json(response, 200, { thread: trackingReads.annotate(store.required<Thread>('thread', decodeURIComponent(threadMatch[1]))) });
      const replyMatch = path.match(/^\/api\/threads\/([^/]+)\/reply$/);
      if (replyMatch && method === 'POST') { const input = await body(request); const mode = string(input.mode, 'reply'); if (!['reply', 'replyAll', 'forward'].includes(mode)) throw new HttpError(400, 'Invalid reply mode'); const draft=store.replyDraft(decodeURIComponent(replyMatch[1]), mode as 'reply' | 'replyAll' | 'forward'); return json(response,201,{draft,providerDraft:providerDrafts.status(draft.accountId,draft.id)}); }
      if (path === '/api/undo' && method === 'POST') {
        const input = await body(request); const undoId = string(input.undoId); const accountId = store.pendingUndo(undoId).accountId;
        return json(response, 200, await operations.run(accountId, async () => { const previous = store.pendingUndo(undoId); const current = store.required<Thread>('thread', previous.id); if (store.required<Account>('account', previous.accountId).provider === 'google') await google.updateThread(current, previous); return { thread: store.commitUndo(undoId, previous) }; }));
      }
      if (path === '/api/labels' && method === 'GET') return json(response, 200, { labels: store.list<Label>('label').filter(l => !url.searchParams.get('accountId') || l.accountId === url.searchParams.get('accountId')) });
      if (path === '/api/labels' && method === 'POST') { const input = await body(request); const accountId = string(input.accountId, store.preferences().activeAccountId); const account = store.required<Account>('account', accountId); const name = string(input.name).trim(); if (!name || name.length > 100) throw new HttpError(400, 'Label name must be 1–100 characters'); let providerId: string | undefined; if (account.provider === 'google') { const label = await google.request(accountId, 'labels', { method: 'POST', body: JSON.stringify({ name }) }) as { id: string }; providerId = label.id; } const label: Label = { id: providerId ? `${accountId}:${providerId}` : randomUUID(), accountId, name, color: string(input.color, '#8c85df'), providerId }; return json(response, 201, { label: store.put('label', label.id, label) }); }
      if (path === '/api/preferences' && method === 'GET') return json(response, 200, { preferences: store.preferences() });
      if (path === '/api/preferences' && method === 'PATCH') { const input = await body(request); if (input.activeAccountId !== undefined) store.required<Account>('account', string(input.activeAccountId)); const booleans = ['Auto Advance', 'Hide Empty Split Inboxes', 'Backtick as Escape', 'Show Sender Full Names']; for (const key of booleans) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new HttpError(400, `${key} must be a boolean`); const allowed = ['theme', 'activeAccountId', 'signature', 'defaultRemind', 'splitInbox', 'snippets', ...booleans]; const values = Object.fromEntries(Object.entries(input).filter(([key]) => allowed.includes(key))); return json(response, 200, { preferences: store.updatePreferences(values) }); }
      if (path === '/api/drafts' && method === 'GET') return json(response, 200, { drafts: store.list<Draft>('draft').filter(d => d.status !== 'sent' && (!url.searchParams.get('accountId') || d.accountId === url.searchParams.get('accountId'))) });
      const uploadMatch = path.match(/^\/api\/drafts\/([^/]+)\/attachments(?:\/([^/]+))?$/);
      if (uploadMatch) {
        const draftId = decodeURIComponent(uploadMatch[1]); const attachmentId = uploadMatch[2] ? decodeURIComponent(uploadMatch[2]) : undefined;
        if (inFlightSends.has(draftId)) throw new HttpError(409, 'Delivery is already in progress');
        if (method === 'POST' && !attachmentId) { const input = await body(request, 14_100_000); const result=store.addAttachment(draftId,{name:string(input.name),mimeType:string(input.mimeType,'application/octet-stream'),data:string(input.data)});return json(response,201,{...result,providerDraft:providerDrafts.status(result.draft.accountId,draftId)}); }
        if (method === 'DELETE' && attachmentId) {const draft=store.removeAttachment(draftId,attachmentId);return json(response,200,{draft,providerDraft:providerDrafts.status(draft.accountId,draftId)});}
        if (method === 'GET' && attachmentId) { const draft = store.required<Draft>('draft', draftId); const metadata = draft.attachments?.find(item => item.id === attachmentId); if (!metadata) throw new HttpError(404, 'Attachment not found'); response.writeHead(200, { 'content-type': metadata.mimeType, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(metadata.name)}`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(store.attachmentBytes(draftId, attachmentId)); return; }
      }
      const providerDraftPath = path.match(/^\/api\/drafts\/([^/]+)\/provider(?:\/(reconcile))?$/);
      if (providerDraftPath) {
        const id = decodeURIComponent(providerDraftPath[1]);
        if (method === 'GET' && !providerDraftPath[2]) { if([...url.searchParams.keys()].some(key=>key!=='accountId')||url.searchParams.getAll('accountId').length!==1)throw new HttpError(400,'Choose one cloud draft account','provider_draft_invalid_request');return json(response,200,{providerDraft:providerDrafts.status(url.searchParams.get('accountId')!,id)}); }
        if (method === 'POST' && providerDraftPath[2]) { if(url.search)throw new HttpError(400,'Unexpected cloud draft query','provider_draft_invalid_request');const input=await body(request,5000);if(Object.keys(input).some(key=>!['accountId','expectedSyncRevision'].includes(key)))throw new HttpError(400,'Invalid cloud draft check','provider_draft_invalid_request');return json(response,200,await providerDrafts.reconcile(string(input.accountId),id,input.expectedSyncRevision as number)); }
        throw new HttpError(405,'Use a scoped cloud draft status or check route','method_not_allowed');
      }
      const cloudDiscard=path.match(/^\/api\/drafts\/([^/]+)\/discard-operations$/);
      if(cloudDiscard&&method==='POST'){if(url.search)throw new HttpError(400,'Unexpected discard query','provider_draft_invalid_request');const id=decodeURIComponent(cloudDiscard[1]);if(inFlightSends.has(id))throw new HttpError(409,'Delivery owns this draft','provider_draft_locked');const result=providerDrafts.discard(id,await body(request,5000));if(result.accepted&&result.response.resolution==='pending')void providerDrafts.flush(result.response.receipt.accountId,id).catch(()=>{});return json(response,result.accepted?202:200,result.response);}
      const cloudDiscardKey=path.match(/^\/api\/draft-discard-operations\/by-request\/([^/]+)$/);
      if(cloudDiscardKey&&method==='GET'){if([...url.searchParams.keys()].some(key=>!['accountId','draftId'].includes(key)||url.searchParams.getAll(key).length!==1)||!url.searchParams.has('accountId')||!url.searchParams.has('draftId'))throw new HttpError(400,'Invalid discard receipt query','provider_draft_invalid_request');return json(response,200,providerDrafts.discardByRequest(url.searchParams.get('accountId')!,url.searchParams.get('draftId')!,decodeURIComponent(cloudDiscardKey[1])));}
      const draftSyncMatch = path.match(/^\/api\/drafts\/([^/]+)\/sync$/);
      if (draftSyncMatch && method === 'POST') { const id = decodeURIComponent(draftSyncMatch[1]); const draft = store.required<Draft>('draft', id); if (store.hasProviderDraftLink(id)) { if(inFlightSends.has(id))throw new HttpError(409,'Delivery owns this draft','provider_draft_locked'); await providerDrafts.flush(draft.accountId,id); return json(response,200,{draft:store.required<Draft>('draft',id),providerDraft:providerDrafts.status(draft.accountId,id)}); } if (['sending', 'delivery_unknown', 'sent'].includes(draft.status)) throw new HttpError(409, 'Delivery must be reconciled before editing this draft'); if (inFlightSends.has(id)) throw new HttpError(409, 'Draft sync or delivery is already in progress'); inFlightSends.add(id); try { return json(response, 200, await operations.run(draft.accountId, async () => ({ draft: await google.syncDraft(store.required<Draft>('draft', id)) }))); } finally { inFlightSends.delete(id); } }
      const reconcileMatch = path.match(/^\/api\/drafts\/([^/]+)\/reconcile$/);
      if (reconcileMatch && method === 'POST') return json(response, 200, await reconcileDraft(decodeURIComponent(reconcileMatch[1])));
      const draftMatch = path.match(/^\/api\/drafts\/([^/]+)(?:\/(send|schedule|cancel))?$/);
      if (draftMatch && !draftMatch[2] && method === 'GET') { const id = decodeURIComponent(draftMatch[1]); return json(response, 200, { draft: store.required<Draft>('draft', id), deliveryPending: inFlightSends.has(id), providerDraft: providerDrafts.status(store.required<Draft>('draft',id).accountId,id) }); }
      if ((path === '/api/drafts' && method === 'POST') || (draftMatch && !draftMatch[2] && method === 'PATCH')) {
        const input = await body(request); const values: Partial<Draft> = {};
        for (const key of ['accountId', 'threadId', 'to', 'cc', 'bcc', 'subject', 'body', 'html'] as const) if (input[key] !== undefined) values[key] = string(input[key]);
        const id = draftMatch ? decodeURIComponent(draftMatch[1]) : undefined;
        if (id && inFlightSends.has(id)) throw new HttpError(409, 'Delivery is already in progress');
        if (id) store.required<Draft>('draft', id);
        const existing = id ? store.get<Draft>('draft', id) : undefined;
        const threadId = values.threadId ?? existing?.threadId;
        if (threadId && store.required<Thread>('thread', threadId).accountId !== (values.accountId ?? existing?.accountId ?? store.preferences().activeAccountId)) throw new HttpError(400, 'Reply thread belongs to a different account');
        const saved = store.saveDraft({ ...values, ...(id ? { id } : {}) }, id ? undefined : 'composer'); return json(response, id ? 200 : 201, { draft: saved, providerDraft: providerDrafts.status(saved.accountId,saved.id) });
      }
      if (draftMatch && !draftMatch[2] && method === 'DELETE') { const id = decodeURIComponent(draftMatch[1]); const draft = store.required<Draft>('draft', id); if (['sent', 'sending', 'delivery_unknown'].includes(draft.status) || inFlightSends.has(id)) throw new HttpError(409, 'Cannot delete a sent, sending, or unresolved delivery'); if (store.hasProviderDraftLink(id)) throw new HttpError(409, 'Use the keyed managed draft discard action', 'provider_draft_deletion_requires_action'); if (draft.providerDraftId) throw new HttpError(409, 'Provider-synced drafts must be managed in Gmail; local deletion will not silently delete a provider draft', 'provider_draft_deletion_requires_action'); store.deleteDraft(id); return json(response, 200, { deleted: true }); }
      if (draftMatch && draftMatch[2] === 'send' && method === 'POST') return json(response, 200, await deliver(decodeURIComponent(draftMatch[1])));
      if (draftMatch && draftMatch[2] === 'schedule' && method === 'POST') { const input = await body(request); const id = decodeURIComponent(draftMatch[1]); if (inFlightSends.has(id)) throw new HttpError(409, 'Delivery is queued or already in progress', 'delivery_in_progress'); const draft = store.required<Draft>('draft', id); if (store.cancelledDeliveryHistory(id)) throw new HttpError(409, 'A fresh explicit keyed Send intent is required after Undo', 'send_intent_required'); if (draft.status === 'sent') throw new HttpError(409, 'Already sent'); google.validateDelivery(draft); if (store.required<Account>('account', draft.accountId).provider !== 'google') throw new HttpError(409, 'Demo accounts cannot schedule delivery', 'demo_delivery_disabled'); const scheduledAt = date(input.scheduledAt); if (Date.parse(scheduledAt) <= Date.now()) throw new HttpError(400, 'Choose a future time'); return json(response, 200, { draft: store.saveDraft({ id, scheduledAt, status: 'scheduled' }) }); }
      if (draftMatch && draftMatch[2] === 'cancel' && method === 'POST') { const id = decodeURIComponent(draftMatch[1]); if (inFlightSends.has(id)) throw new HttpError(409, 'Delivery is already in progress'); store.required<Draft>('draft', id); return json(response, 200, { draft: store.saveDraft({ id, status: 'draft', scheduledAt: undefined }) }); }
      if (path === '/api/auth/google/start' && method === 'GET') { const auth = google.startAuth({ service: (url.searchParams.get('service') ?? 'mail') as GoogleService, accountId: url.searchParams.get('accountId') ?? undefined }); response.writeHead(302, { location: auth.url, 'set-cookie': `rea_oauth_state=${auth.state}; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=600`, 'cache-control': 'no-store' }); response.end(); return; }
      if (path === '/api/auth/google/callback' && method === 'GET') {
        const cookie = (request.headers.cookie ?? '').split(';').map(x => x.trim()).find(x => x.startsWith('rea_oauth_state='))?.slice(16) ?? ''; const state = url.searchParams.get('state') ?? ''; const service = google.authService(state);
        if (url.searchParams.has('error')) { google.declineAuth(state, cookie); if (service !== 'calendar') throw new HttpError(400, 'Google authorization was declined', 'oauth_declined'); }
        const accountId = url.searchParams.has('error') ? undefined : await google.finishAuth(state, cookie, url.searchParams.get('code') ?? '');
        response.writeHead(302, { location: frontendOrigin, 'set-cookie': 'rea_oauth_state=; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=0', 'cache-control': 'no-store' }); response.end(); if (accountId) { if (service === 'calendar') { if (calendar.capabilities(accountId).list) void calendar.syncCalendarList(accountId).catch(() => {}); } else void requestSync(accountId).catch(() => {}); } return;
      }
      if (path === '/api/calendar/status' && method === 'GET') { const accountId = url.searchParams.get('accountId') ?? store.preferences().activeAccountId; store.required<Account>('account', accountId); return json(response, 200, { calendar: calendar.status(accountId) }); }
      if (path === '/api/calendar/calendars' && method === 'GET') { const accountId = url.searchParams.get('accountId') ?? store.preferences().activeAccountId; store.required<Account>('account', accountId); return json(response, 200, { calendars: calendar.repository.calendars(accountId), sync: calendar.syncStatus(accountId), providerStatus: calendar.status(accountId) }); }
      if (path === '/api/calendar/calendars/sync' && method === 'POST') { const input = await body(request); return json(response, 200, await calendar.syncCalendarList(string(input.accountId, store.preferences().activeAccountId))); }
      if (path === '/api/calendar/sync' && method === 'GET') { const accountId = url.searchParams.get('accountId') ?? store.preferences().activeAccountId; store.required<Account>('account', accountId); return json(response, 200, { sync: calendar.syncStatus(accountId, url.searchParams.get('calendarId') ?? '*') }); }
      if (path === '/api/calendar/sync' && method === 'POST') { const input = await body(request); return json(response, 200, await calendar.syncEvents(string(input.accountId, store.preferences().activeAccountId), string(input.calendarId))); }
      if (path === '/api/calendar/events' && method === 'GET') return json(response, 200, await calendar.visibleRange(url.searchParams.get('accountId') ?? store.preferences().activeAccountId, url.searchParams.get('calendarId') ?? '', { timeMin: url.searchParams.get('timeMin'), timeMax: url.searchParams.get('timeMax'), timeZone: url.searchParams.get('timeZone') ?? undefined }, url.searchParams.get('refresh') === 'true'));
      const calendarEventMatch = path.match(/^\/api\/calendar\/events\/([^/]+)$/);
      if (calendarEventMatch && method === 'GET') return json(response, 200, { event: await calendar.getEvent(url.searchParams.get('accountId') ?? store.preferences().activeAccountId, url.searchParams.get('calendarId') ?? '', decodeURIComponent(calendarEventMatch[1])) });
      if (path === '/api/calendar/freebusy' && method === 'POST') { const input = await body(request); return json(response, 200, await calendar.freeBusy(string(input.accountId, store.preferences().activeAccountId), { timeMin: input.timeMin, timeMax: input.timeMax, timeZone: input.timeZone, items: input.items })); }
      if (path === '/api/calendar/operations' && method === 'POST') { const input = await body(request); return json(response, 201, { operation: calendar.prepareOperation({ accountId: string(input.accountId, store.preferences().activeAccountId), calendarId: string(input.calendarId), kind: input.kind, eventId: input.eventId, etag: input.etag, event: input.event }) }); }
      const calendarOperation = path.match(/^\/api\/calendar\/operations\/([^/]+)(?:\/(execute|reconcile))?$/);
      if (calendarOperation && method === 'GET' && !calendarOperation[2]) return json(response, 200, { operation: calendar.operation(decodeURIComponent(calendarOperation[1])) });
      if (calendarOperation && method === 'POST' && calendarOperation[2] === 'execute') return json(response, 200, { operation: await calendar.executeOperation(decodeURIComponent(calendarOperation[1])) });
      if (calendarOperation && method === 'POST' && calendarOperation[2] === 'reconcile') return json(response, 200, await calendar.reconcileOperation(decodeURIComponent(calendarOperation[1])));
      const syncMatch = path.match(/^\/api\/accounts\/([^/]+)\/sync$/);
      if (syncMatch && method === 'GET') return json(response, 200, { sync: syncStatus(decodeURIComponent(syncMatch[1])) });
      if (syncMatch && method === 'POST') { const accountId = decodeURIComponent(syncMatch[1]); store.required<Account>('account', accountId); return json(response, 200, await requestSync(accountId)); }
      const attachmentMatch = path.match(/^\/api\/accounts\/([^/]+)\/messages\/([^/]+)\/attachments\/([^/]+)$/);
      if (attachmentMatch && method === 'GET') { const [accountId, messageId, attachmentId] = attachmentMatch.slice(1).map(decodeURIComponent); const account = store.required<Account>('account', accountId); if (account.provider !== 'google') throw new HttpError(404, 'Demo attachment bytes are not available'); const data = await google.attachment(accountId, messageId, attachmentId); const filename = data.name ? encodeURIComponent(data.name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`) : undefined; response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': filename ? `attachment; filename*=UTF-8''${filename}` : 'attachment', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(Buffer.from(data.data, 'base64url')); return; }
      if (path === '/api/ai' && method === 'POST') { const input = await body(request); const mode = string(input.mode, 'ask'); if (!['ask', 'write', 'summarize'].includes(mode)) throw new HttpError(400, 'Unknown AI mode'); return json(response, 200, await ai.generate({ prompt: string(input.prompt), mode: mode as 'ask' | 'write' | 'summarize', threadId: input.threadId === undefined ? undefined : string(input.threadId), accountId: input.accountId === undefined ? undefined : string(input.accountId) })); }
      throw new HttpError(404, 'Route not found', 'not_found');
    } catch (error) { const status = error instanceof HttpError ? error.status : 500; json(response, status, { error: { code: error instanceof HttpError ? error.code : 'internal_error', message: error instanceof HttpError ? error.message : 'Unexpected server error' } }); }
  });
  let closePromise: Promise<void> | undefined;
  const close = () => {
    if (closePromise) return closePromise;
    closing = true;autoDraftGeneration?.close();trackingReads.close();trackingDelivery.close();
    closePromise = (async () => { trackingCollector?.close(); syncTimer?.cancel(); jobTimer?.cancel(); calendarTimer?.cancel(); await Promise.all([aiChat.close(), aiSend.close(), draftSend.close(), knowledge.close(), Promise.resolve().then(()=>automation.close()), providerDrafts.close()]); if (server.listening) await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())); await Promise.allSettled([...syncs.values(), ...(jobsPromise ? [jobsPromise] : []), ...(pendingWake ? [pendingWake] : [])]); await waitAutoDraftIdle();await Promise.allSettled([...operations.tails.values()]); await Promise.allSettled([...deliveryMetadataJobs,...trackingConfirmationJobs]);await trackingDelivery.waitForIdle();await trackingReads.waitForIdle();trackingReads.dispose(); await calendar.close(); store.close(); })();
    return closePromise;
  };
  return { server, store, google, calendar, aiChat, aiSend, draftSend, deliveryControl, knowledge, automation, autoDrafts, autoDraftGeneration, initializeAutoDrafts, runAutoDraftJobs, waitAutoDraftIdle, providerDrafts, splitInboxes, tracking, trackingCollector,trackingDelivery,trackingReads, close, runJobs, deliver, deliverComposer, wakeSnoozes, runSyncJobs, requestSync, syncStatus };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const collectorConfiguration = loadTrackingRuntimeConfiguration(process.env);
  let app: ReturnType<typeof createApp>;let automaticConfiguration:ReturnType<typeof loadAutoDraftRuntimeConfiguration>|undefined;
  try { automaticConfiguration=loadAutoDraftRuntimeConfiguration(process.env);app = createApp({ trackingCollector: collectorConfiguration,autoDraftGeneration:automaticConfiguration.generation }); }
  finally { collectorConfiguration?.key.fill(0);automaticConfiguration?.clear(); }
  const port = Number(process.env.PORT || 3001);
  app.server.listen(port, '127.0.0.1', () => console.log(`Superhuman reconstruction API: http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
