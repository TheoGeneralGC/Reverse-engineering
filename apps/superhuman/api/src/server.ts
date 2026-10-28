import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './store.ts';
import { GoogleProvider } from './google.ts';
import { AiProvider } from './ai.ts';
import { AiChatService } from './ai-chat.ts';
import { AiDraftSendService } from './ai-draft-send.ts';
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

export function createApp(options: { databasePath?: string; env?: NodeJS.ProcessEnv; seed?: boolean; runJobs?: boolean; scheduler?: AppScheduler; aiFetch?: typeof fetch; undoWindowMs?: number } = {}) {
  const unknownOptions = Object.keys(options).filter(key => !['databasePath', 'env', 'seed', 'runJobs', 'scheduler', 'aiFetch', 'undoWindowMs'].includes(key));
  if (unknownOptions.length) throw new TypeError('Unknown application configuration option');
  const env = options.env ?? process.env;
  const configuredDatabase = resolveApplicationDatabasePath(options.databasePath, env.DATABASE_PATH, !!process.env.NODE_TEST_CONTEXT);
  const scheduler = options.scheduler ?? systemScheduler;
  if(options.undoWindowMs!==undefined)deliveryDeadline(scheduler.now(),options.undoWindowMs);
  const syncPollMs = 30_000; const syncContinuationMs = 1_500;
  let closing = false;
  const store = new Store(configuredDatabase ?? resolve(rootPath, '.local/superhuman/mail.sqlite'), options.seed ?? true);
  store.recoverInterruptedDeliveries();
  const google = new GoogleProvider(store, env);
  const ai = new AiProvider(store, env, options.aiFetch);
  const calendar = new GoogleCalendarProvider(store, google, env, google.fetcher, { now: scheduler.now });
  const inFlightSends = new Set<string>();
  const aiChat = new AiChatService(store, env, options.aiFetch, { now: scheduler.now, isDraftLocked: id => inFlightSends.has(id) });
  const aiSend = new AiDraftSendService(store, aiChat.drafts, google, scheduler.now, undefined, { windowMs: options.undoWindowMs ?? 10000, schedule: (callback,ms)=>scheduler.schedule(callback,ms) });
  if (options.runJobs !== false) aiChat.startIndexing();
  let jobsPromise: Promise<void> | undefined;
  const deliveryMetadataJobs = new Set<Promise<void>>();
  const syncs = new Map<string, Promise<unknown>>();
  const operations = new OperationQueue();
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
        const result = await google.sync(accountId, { maxPages: 1, pageSize: 5, catchupDuringInitial: true });
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
    syncs.set(accountId, promise); return promise;
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
      if (store.list<Draft>('draft').some(draft => draft.accountId === account.id && draft.status === 'scheduled' && draft.scheduledAt && Date.parse(draft.scheduledAt) <= now + 15_000)) continue;
      launched++; void requestSync(account.id).catch(() => {});
    }
    return launched;
  }

  async function deliver(id: string, artifactOperationId?: string) {
    const selected = store.required<Draft>('draft', id);
    if ((selected.artifactSendId || artifactOperationId || store.artifactDeliveryId(id)) && (selected.artifactSendId !== artifactOperationId || store.artifactDeliveryId(id) !== artifactOperationId)) throw new HttpError(409, 'Use the original artifact Send operation; generic Send cannot redispatch it', 'artifact_delivery_locked');
    if (inFlightSends.has(id)) throw new HttpError(409, 'Message delivery is already in progress', 'delivery_in_progress');
    const accountId = store.required<Draft>('draft', id).accountId;
    inFlightSends.add(id);
    try { return await operations.run(accountId, () => dispatchDelivery(id, artifactOperationId)); }
    finally { inFlightSends.delete(id); }
  }
  async function dispatchDelivery(id: string, artifactOperationId?: string) {
    const draft = store.required<Draft>('draft', id);
    if ((draft.artifactSendId || artifactOperationId || store.artifactDeliveryId(id)) && (draft.artifactSendId !== artifactOperationId || store.artifactDeliveryId(id) !== artifactOperationId)) throw new HttpError(409, 'The artifact operation owns this delivery', 'artifact_delivery_locked');
    const deliveryContext = { artifactOperationId };
    if (draft.status === 'sent') throw new HttpError(409, 'Message was already sent', 'already_sent');
    if (draft.status === 'sending' || draft.status === 'delivery_unknown') throw new HttpError(409, 'Delivery outcome must be reconciled; this message will not be resent automatically', 'delivery_requires_reconciliation');
    // Validate all recipients before any external operation or state transition.
    google.validateDelivery(draft);
    if (store.required<Account>('account', draft.accountId).provider !== 'google') throw new HttpError(409, 'Demo accounts cannot deliver email', 'demo_delivery_disabled');
    let attemptStarted = false;
    try {
      const pending = store.beginDelivery(id, deliveryContext); attemptStarted = true;
      const result = await google.send(pending) as { id?: string };
      if (!result || typeof result.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(result.id)) throw new HttpError(502, 'Gmail returned an invalid delivery acknowledgment', 'invalid_google_send_response');
      store.completeDelivery(id, result.id, undefined, undefined, deliveryContext);
      // The ACK is already durable. A best-effort read can enrich its final
      // provider header, but failure must never downgrade or repeat the send.
      const providerMessageId = result.id;
      const metadataJob = operations.run(pending.accountId, async () => {
        try { const current = store.required<Draft>('draft', id); if (current.status !== 'sent' || current.deliveryAttemptId !== pending.deliveryAttemptId || current.providerMessageId !== providerMessageId) return; const metadata = await google.acknowledgedDeliveryMetadata(current, providerMessageId); if (metadata) store.recordDeliveryMetadata(id, pending.deliveryAttemptId!, providerMessageId, metadata.providerInternetMessageId, metadata.markerVerified); } catch { /* An acknowledged send remains sent; no write retry or auth flow. */ }
      });
      deliveryMetadataJobs.add(metadataJob); void metadataJob.finally(() => deliveryMetadataJobs.delete(metadataJob));
      return { sent: true, result };
    } catch (error) {
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
      return { resolved: result.found, matches: result.matches, scanComplete: result.scanComplete, scannedCandidates: result.scannedCandidates, reason: result.reason, draft: result.found ? store.completeDelivery(id, result.providerMessageId, result.providerInternetMessageId, true, aiSend.deliveryContext(current, true)) : store.required<Draft>('draft', id), ...(!result.found ? { message } : {}) };
    });
  }
  function runJobs() {
    if (jobsPromise) return jobsPromise;
    if (closing) return Promise.resolve();
    jobsPromise = (async () => {
      const waking = wakeSnoozes(); const groups = new Map<string, string[]>();
      for (const draft of store.list<Draft>('draft').filter(draft => draft.status === 'scheduled')) groups.set(draft.accountId, [...(groups.get(draft.accountId) ?? []), draft.id]);
      await Promise.all([waking, ...[...groups.values()].map(async ids => { for (const id of ids) {
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
  if (options.runJobs !== false) { scheduleSyncTick(0); scheduleJobTick(); if (calendar.status().configured) scheduleCalendarTick(0); }
  const frontendOrigin = env.WEB_ORIGIN || 'http://127.0.0.1:5173';
  const allowedOrigins = new Set([frontendOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000']);
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin) && origin !== `http://${request.headers.host}`) return json(response, 403, { error: { code: 'origin_not_allowed', message: 'Origin is not allowed' } });
    if (origin) { response.setHeader('access-control-allow-origin', origin); response.setHeader('vary', 'Origin'); response.setHeader('access-control-allow-headers', 'Content-Type'); response.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS'); }
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    // Loopback-only development service; reject DNS-rebinding Host names.
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(request.headers.host ?? '')) return json(response, 403, { error: { code: 'invalid_host', message: 'Loopback Host required' } });
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const path = url.pathname; const method = request.method;
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
      if (threadMatch && method === 'GET') return json(response, 200, { thread: store.required<Thread>('thread', decodeURIComponent(threadMatch[1])) });
      const replyMatch = path.match(/^\/api\/threads\/([^/]+)\/reply$/);
      if (replyMatch && method === 'POST') { const input = await body(request); const mode = string(input.mode, 'reply'); if (!['reply', 'replyAll', 'forward'].includes(mode)) throw new HttpError(400, 'Invalid reply mode'); return json(response, 201, { draft: store.replyDraft(decodeURIComponent(replyMatch[1]), mode as 'reply' | 'replyAll' | 'forward') }); }
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
        if (method === 'POST' && !attachmentId) { const input = await body(request, 14_100_000); return json(response, 201, store.addAttachment(draftId, { name: string(input.name), mimeType: string(input.mimeType, 'application/octet-stream'), data: string(input.data) })); }
        if (method === 'DELETE' && attachmentId) return json(response, 200, { draft: store.removeAttachment(draftId, attachmentId) });
        if (method === 'GET' && attachmentId) { const draft = store.required<Draft>('draft', draftId); const metadata = draft.attachments?.find(item => item.id === attachmentId); if (!metadata) throw new HttpError(404, 'Attachment not found'); response.writeHead(200, { 'content-type': metadata.mimeType, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(metadata.name)}`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(store.attachmentBytes(draftId, attachmentId)); return; }
      }
      const draftSyncMatch = path.match(/^\/api\/drafts\/([^/]+)\/sync$/);
      if (draftSyncMatch && method === 'POST') { const id = decodeURIComponent(draftSyncMatch[1]); const draft = store.required<Draft>('draft', id); if (['sending', 'delivery_unknown', 'sent'].includes(draft.status)) throw new HttpError(409, 'Delivery must be reconciled before editing this draft'); if (inFlightSends.has(id)) throw new HttpError(409, 'Draft sync or delivery is already in progress'); inFlightSends.add(id); try { return json(response, 200, await operations.run(draft.accountId, async () => ({ draft: await google.syncDraft(store.required<Draft>('draft', id)) }))); } finally { inFlightSends.delete(id); } }
      const reconcileMatch = path.match(/^\/api\/drafts\/([^/]+)\/reconcile$/);
      if (reconcileMatch && method === 'POST') return json(response, 200, await reconcileDraft(decodeURIComponent(reconcileMatch[1])));
      const draftMatch = path.match(/^\/api\/drafts\/([^/]+)(?:\/(send|schedule|cancel))?$/);
      if (draftMatch && !draftMatch[2] && method === 'GET') { const id = decodeURIComponent(draftMatch[1]); return json(response, 200, { draft: store.required<Draft>('draft', id), deliveryPending: inFlightSends.has(id) }); }
      if ((path === '/api/drafts' && method === 'POST') || (draftMatch && !draftMatch[2] && method === 'PATCH')) {
        const input = await body(request); const values: Partial<Draft> = {};
        for (const key of ['accountId', 'threadId', 'to', 'cc', 'bcc', 'subject', 'body', 'html'] as const) if (input[key] !== undefined) values[key] = string(input[key]);
        const id = draftMatch ? decodeURIComponent(draftMatch[1]) : undefined;
        if (id && inFlightSends.has(id)) throw new HttpError(409, 'Delivery is already in progress');
        if (id) store.required<Draft>('draft', id);
        const existing = id ? store.get<Draft>('draft', id) : undefined;
        const threadId = values.threadId ?? existing?.threadId;
        if (threadId && store.required<Thread>('thread', threadId).accountId !== (values.accountId ?? existing?.accountId ?? store.preferences().activeAccountId)) throw new HttpError(400, 'Reply thread belongs to a different account');
        return json(response, id ? 200 : 201, { draft: store.saveDraft({ ...values, ...(id ? { id } : {}) }) });
      }
      if (draftMatch && !draftMatch[2] && method === 'DELETE') { const id = decodeURIComponent(draftMatch[1]); const draft = store.required<Draft>('draft', id); if (['sent', 'sending', 'delivery_unknown'].includes(draft.status) || inFlightSends.has(id)) throw new HttpError(409, 'Cannot delete a sent, sending, or unresolved delivery'); if (draft.providerDraftId) throw new HttpError(409, 'Provider-synced drafts must be managed in Gmail; local deletion will not silently delete a provider draft', 'provider_draft_deletion_requires_action'); store.deleteDraft(id); return json(response, 200, { deleted: true }); }
      if (draftMatch && draftMatch[2] === 'send' && method === 'POST') return json(response, 200, await deliver(decodeURIComponent(draftMatch[1])));
      if (draftMatch && draftMatch[2] === 'schedule' && method === 'POST') { const input = await body(request); const id = decodeURIComponent(draftMatch[1]); if (inFlightSends.has(id)) throw new HttpError(409, 'Delivery is queued or already in progress', 'delivery_in_progress'); const draft = store.required<Draft>('draft', id); if (draft.status === 'sent') throw new HttpError(409, 'Already sent'); google.validateDelivery(draft); if (store.required<Account>('account', draft.accountId).provider !== 'google') throw new HttpError(409, 'Demo accounts cannot schedule delivery', 'demo_delivery_disabled'); const scheduledAt = date(input.scheduledAt); if (Date.parse(scheduledAt) <= Date.now()) throw new HttpError(400, 'Choose a future time'); return json(response, 200, { draft: store.saveDraft({ id, scheduledAt, status: 'scheduled' }) }); }
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
    closing = true;
    closePromise = (async () => { syncTimer?.cancel(); jobTimer?.cancel(); calendarTimer?.cancel(); await aiChat.close(); await aiSend.close(); if (server.listening) await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())); await Promise.allSettled([...syncs.values(), ...(jobsPromise ? [jobsPromise] : []), ...(pendingWake ? [pendingWake] : [])]); await Promise.allSettled([...operations.tails.values()]); await Promise.allSettled([...deliveryMetadataJobs]); await calendar.close(); store.close(); })();
    return closePromise;
  };
  return { server, store, google, calendar, aiChat, aiSend, close, runJobs, deliver, wakeSnoozes, runSyncJobs, requestSync, syncStatus };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp(); const port = Number(process.env.PORT || 3001);
  app.server.listen(port, '127.0.0.1', () => console.log(`Superhuman reconstruction API: http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
