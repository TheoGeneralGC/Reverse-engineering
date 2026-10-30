import {captureCredentialMaintenance,assertCredentialMaintenance,initializeCredentialMaintenance,credentialGrantMutationEpoch} from './google-credential-maintenance.ts';
import {AccountIncarnationAuthority,currentAccountIncarnation} from './account-incarnation.ts';
import {captureFullHeaderFacts,presentationThread,projectStoredMessages,threadSourceVersion,mailHeaderGrant} from './reminder-message-projection.ts';
import {prepareGoogleReminderCommand,type GoogleReminderCommand,type GoogleReminderGuard} from './google-reminder-command.ts';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Store } from './store.ts';
import type { Account, Attachment, Draft, Label, Message, Person, Thread, DeliveryAttempt, DeliveryReconciliation } from './types.ts';
import { HttpError } from './types.ts';
import { buildMime } from './mime.ts';
import { gmailSnippetToText } from './gmail-snippet.ts';
import { parseOutgoingRecipientHeaders } from './outgoing-recipients.ts';
import { setTimeout as sleep, setImmediate as yieldEventLoop } from 'node:timers/promises';
import { calendarCapabilities, CALENDAR_REQUEST_SCOPES, GMAIL_SCOPE, type GoogleService, type GoogleServiceGrant, type GoogleAuthContext } from './google-scopes.ts';

import { migrateLegacyMailGrantMetadata } from './legacy-mail-grants.ts';
import type { GoogleIngressAdapter, GoogleReadLease, GooglePageProof, GoogleReplyMetadata } from './google-ingress.ts';

type Tokens = { access_token: string; refresh_token?: string; expires_at: number; grantedScopes?: string[] };
type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
type GmailPart = { partId?: string; mimeType?: string; filename?: string; body?: { data?: string; attachmentId?: string; size?: number }; parts?: GmailPart[]; headers?: { name: string; value: string }[] };
type GmailMessage = { id: string; threadId: string; snippet: string; labelIds?: string[]; internalDate: string; payload: GmailPart };
type PendingSyncPage = { ids: string[]; provenance?: GooglePageProof; nextPageToken?: string; historyId?: string; resultSizeEstimate?: number };
type InitialCatchup = { historyId: string; pageToken?: string; pending?: PendingSyncPage; lastCompletedAt?: string };
type SyncState = { phase: 'initial' | 'history'; pageToken?: string; historyId: string; generation: string; partial: boolean; resultSizeEstimate?: number; lastCompletedAt?: string; pending?: PendingSyncPage; catchup?: InitialCatchup; lastResetReason?: 'history_expired' };
export type SyncLimits = { maxPages?: number; pageSize?: number; maxThreadReads?: number; catchupDuringInitial?: boolean };
type HistoryPage = { historyId: string; nextPageToken?: string; history?: { messages?: { id: string; threadId: string }[]; messagesAdded?: { message: { id: string; threadId: string } }[]; messagesDeleted?: { message: { id: string; threadId: string } }[]; labelsAdded?: { message: { id: string; threadId: string } }[]; labelsRemoved?: { message: { id: string; threadId: string } }[] }[] };
export type ProviderStatus = { provider: string; configured: boolean; missing: string[]; redirectUri: string; deliveryEnabled: boolean; approvedTestRecipients: string[]; approvedTestSenders: string[]; capabilities: string[]; limitations: string[] };
export interface MailProvider { status(): ProviderStatus; sync(accountId: string, limits?: SyncLimits): Promise<unknown>; updateThread(before: Thread, after: Thread): Promise<void>; send(draft: Draft): Promise<unknown> }

const hexHeaderVersion=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function person(raw = ''): Person { const m = raw.match(/^(.*?)\s*<([^>]+)>$/); return m ? { name: m[1].replaceAll('"', '').trim() || m[2], email: m[2].trim() } : { name: raw.trim(), email: raw.trim() }; }
function decode(raw = '') { return Buffer.from(raw, 'base64url').toString('utf8'); }
function header(payload: GmailPart, name: string) { return payload.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''; }
function parseRecipients(raw: string): Person[] { return raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).filter(Boolean).map(p => person(p.trim())); }
type AttachmentRecord = { accountId: string; messageId: string; attachment: Attachment; data?: string };
export type GoogleTiming = { now: () => number; sleep: (milliseconds: number) => Promise<void>; random: () => number; yieldSync: () => Promise<void> };
/** Trusted read-only identity lease fence; not the mapped-Send native permit. */
export type GoogleReadGuard = { signal: AbortSignal; beforeIssue: () => void };
export type GoogleFailureDiagnostic = { pathFamily: string; httpStatus: number; status?: string; reasons: string[]; retryAfterSeconds?: number };
export class GoogleRequestError extends HttpError {
  diagnostic: GoogleFailureDiagnostic;
  constructor(status: number, message: string, code: string, diagnostic: GoogleFailureDiagnostic) { super(status, message, code); this.diagnostic = diagnostic; }
}
function readCost(path: string) {
  const url = new URL(path, 'https://gmail.invalid/'); const segments = url.pathname.split('/').filter(Boolean); const format = url.searchParams.get('format');
  if (segments[0] === 'profile') return { units: 1, family: 'profile.get' };
  if (segments[0] === 'labels') return { units: 1, family: segments.length > 1 ? 'labels.get' : 'labels.list' };
  if (segments[0] === 'history') return { units: 2, family: 'history.list' };
  if (segments[0] === 'threads') return segments.length === 1 ? { units: 10, family: 'threads.list' } : { units: !format || format === 'full' ? 120 : 40, family: !format || format === 'full' ? 'threads.get.full' : 'threads.get.metadata' };
  if (segments[0] === 'messages' && segments[2] === 'attachments') return { units: 20, family: 'messages.attachments.get' };
  if (segments[0] === 'messages') return segments.length === 1 ? { units: 5, family: 'messages.list' } : { units: !format || ['full', 'raw', 'html'].includes(format) ? 60 : 20, family: 'messages.get' };
  if (segments[0] === 'drafts') return segments.length === 1 ? { units: 5, family: 'drafts.list' } : { units: !format || ['full', 'raw', 'html'].includes(format) ? 60 : 20, family: 'drafts.get' };
  return { units: 20, family: 'other' };
}
function pathFamily(path: string, method: string) {
  if (method === 'GET') return readCost(path).family;
  const parts = new URL(path, 'https://gmail.invalid/').pathname.split('/').filter(Boolean);
  if (parts[0] === 'messages' && parts[1] === 'send') return 'messages.send';
  if (parts[0] === 'drafts' && parts[1] === 'send') return 'drafts.send';
  if (parts[0] === 'drafts') return method === 'POST' ? 'drafts.create' : 'drafts.update';
  if (parts[0] === 'threads' && parts[2] === 'modify') return 'threads.modify';
  if (parts[0] === 'labels') return 'labels.write';
  return 'other.write';
}
const safeGoogleReasons = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'quotaExceeded', 'backendError', 'badRequest', 'invalidArgument', 'notFound', 'authError', 'insufficientPermissions', 'accessNotConfigured', 'domainPolicy', 'forbidden', 'failedPrecondition']);
const safeGoogleStatuses = new Set(['PERMISSION_DENIED', 'RESOURCE_EXHAUSTED', 'UNAUTHENTICATED', 'INVALID_ARGUMENT', 'NOT_FOUND', 'UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED', 'FAILED_PRECONDITION', 'UNKNOWN']);
function changedThreadIds(page: HistoryPage) {
  const ids = new Set<string>();
  for (const entry of page.history ?? []) {
    for (const message of entry.messages ?? []) if (message.threadId) ids.add(message.threadId);
    for (const kind of [entry.messagesAdded, entry.messagesDeleted, entry.labelsAdded, entry.labelsRemoved]) for (const item of kind ?? []) if (item.message?.threadId) ids.add(item.message.threadId);
  }
  return [...ids];
}
function attachmentRecordId(accountId: string, messageId: string, attachmentId: string) { return createHash('sha256').update(JSON.stringify([accountId, messageId, attachmentId])).digest('hex'); }
function parts(payload: GmailPart, messageId: string) {
  const texts: string[] = []; const html: string[] = []; const attachmentParts: { attachment: Attachment; data?: string }[] = [];
  function walk(p: GmailPart, treePath: string) {
    const disposition = header(p, 'content-disposition'); const contentId = header(p, 'content-id');
    const isAttachment = !!p.filename || /^attachment(?:\s|;|$)/i.test(disposition) || (!!contentId && p.mimeType !== 'text/plain' && p.mimeType !== 'text/html') || (!!p.body?.attachmentId && p.mimeType !== 'text/plain' && p.mimeType !== 'text/html');
    if (isAttachment) {
      const partId = p.partId ?? treePath;
      const embedded = !p.body?.attachmentId && typeof p.body?.data === 'string';
      const bytes = embedded ? Buffer.from(p.body!.data!, 'base64url') : undefined;
      const attachment: Attachment = { id: p.body?.attachmentId ?? `embedded-${createHash('sha256').update(JSON.stringify([messageId, partId])).digest('hex')}`, name: p.filename || `attachment-${partId || 'root'}`, mimeType: p.mimeType ?? 'application/octet-stream', size: bytes?.length ?? p.body?.size ?? 0, messageId, partId, source: p.body?.attachmentId ? 'provider' : embedded ? 'embedded' : 'unavailable', ...(contentId ? { contentId } : {}) };
      attachmentParts.push({ attachment, ...(bytes ? { data: bytes.toString('base64url') } : {}) });
      // A named text part (or attached message container) is never body text.
      return;
    }
    if (p.body?.data && p.mimeType === 'text/plain') texts.push(decode(p.body.data));
    else if (p.body?.data && p.mimeType === 'text/html') html.push(decode(p.body.data));
    p.parts?.forEach((part, index) => walk(part, `${treePath}.${index}`));
  }
  walk(payload, '0');
  return { text: texts.join('\n'), html: html.join('\n') || undefined, attachmentParts };
}

export class GoogleProvider implements MailProvider {
  store: Store;
  env: NodeJS.ProcessEnv;
  fetcher: typeof fetch;
  timing: GoogleTiming;
  readStarts = new Map<string, number>();
  readTails = new Map<string, Promise<void>>();
  refreshes = new Map<string, Promise<Tokens>>();
  readonly ingress?:GoogleIngressAdapter;
  constructor(store: Store, env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch, timing: Partial<GoogleTiming> = {}, ingress?:GoogleIngressAdapter) { this.ingress=ingress;this.store = store; initializeCredentialMaintenance(store); this.env = env; this.fetcher = fetcher; this.timing = { now: Date.now, sleep, random: Math.random, yieldSync: yieldEventLoop, ...timing }; }
  private headerBasis(accountId:string){
   const account=this.store.required<Account>('account',accountId);if(account.provider!=='google'||!mailHeaderGrant(this.store,accountId))return null;const grant=this.store.required<any>('googleGrant','mail:'+accountId);let version:string|null=null;try{version=currentAccountIncarnation(this.store,accountId)}catch{}
   const registry=this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='auto_draft_ready_accounts'").get(),authority=registry?this.store.db.prepare('SELECT incarnation,epoch,facts,present FROM auto_draft_ready_accounts WHERE account_id=?').get(accountId)??null:null,grantRegistry=this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='auto_draft_ready_grants'").get(),grantEpoch=grantRegistry?this.store.db.prepare('SELECT epoch,present,facts FROM auto_draft_ready_grants WHERE account_id=?').get(accountId)??null:null;
   // Same-scope native refresh metadata is harmless. Existing durable semantic
   // grant epochs still fence real scope changes, including ABA when available.
   return{accountId,identity:JSON.stringify({id:account.id,provider:account.provider,email:account.email.toLowerCase()}),grant:JSON.stringify({accountId:grant.accountId,service:grant.service,outcomeValid:['granted','partial'].includes(grant.outcome),sourceValid:['response','requested','token-cache'].includes(grant.scopeSource),scopes:[...new Set(grant.grantedScopes)].sort()}),grantEpoch:JSON.stringify(grantEpoch),credentialGrant:credentialGrantMutationEpoch(this.store,'mail:'+accountId),authorityStamp:JSON.stringify(authority),version};
  }
  private assertHeaderBasis(basis:NonNullable<ReturnType<GoogleProvider['headerBasis']>>){const current=this.headerBasis(basis.accountId);if(!current||current.identity!==basis.identity||current.grant!==basis.grant||current.grantEpoch!==basis.grantEpoch||current.credentialGrant!==basis.credentialGrant||current.authorityStamp!==basis.authorityStamp||current.version!==basis.version)throw new HttpError(409,'The message source account changed','message_source_changed')}
  normalizeFullMessage(accountId:string,accountVersion:string|null,raw:GmailMessage,staged?:{id:string;record:AttachmentRecord}[]):Message{const message=this.normalizeMessage(raw,accountId,staged);return{...message,reminderHeaderFacts:captureFullHeaderFacts({accountId,accountVersion,providerThreadId:raw.threadId},raw,message)}}
  private headerRead(accountId:string,path:string,guard:GoogleReadGuard){const signal=AbortSignal.any([guard.signal,AbortSignal.timeout(25000)]);signal.throwIfAborted();const pending=this.guardedRead(accountId,path,{redirect:'error'}, {signal,beforeIssue:guard.beforeIssue},4194304);return new Promise<unknown>((resolve,reject)=>{const stop=()=>{cleanup();reject(signal.reason)},cleanup=()=>signal.removeEventListener('abort',stop);pending.then(value=>{cleanup();signal.aborted?reject(signal.reason):resolve(value)},error=>{cleanup();reject(error)});if(signal.aborted){stop();return}signal.addEventListener('abort',stop,{once:true})})}
  /** Explicit exact-thread read intent. It is not live-history ingress, does not
   * reset a barrier or dispatch a model, and cannot use cached rows as proof. */
  async hydrateThread(accountId:string,threadId:string,expectedVersion:string,guard:GoogleReadGuard){
   if(!guard||!(guard.signal instanceof AbortSignal)||typeof guard.beforeIssue!=='function'||!hexHeaderVersion(expectedVersion))throw new HttpError(400,'Invalid conversation refresh','message_source_invalid');
   const before=this.store.required<Thread>('thread',threadId),account=this.store.required<Account>('account',accountId);if(before.accountId!==accountId||account.provider!=='google'||!before.providerId||!/^[A-Za-z0-9_-]{1,256}$/.test(before.providerId)||!mailHeaderGrant(this.store,accountId))throw new HttpError(409,'Conversation source is unavailable','reply_source_unavailable');const authority=new AccountIncarnationAuthority(this.store),basis=this.headerBasis(accountId)!;if(projectStoredMessages(this.store,before).presentation.versionHash!==expectedVersion)throw new HttpError(409,'Conversation changed before refresh','message_source_changed');
   const sourceVersion=threadSourceVersion(before),check=()=>{guard.signal.throwIfAborted();guard.beforeIssue();this.assertHeaderBasis(basis);const current=this.store.required<Thread>('thread',threadId);if(current.accountId!==accountId||current.providerId!==before.providerId||threadSourceVersion(current)!==sourceVersion)throw new HttpError(409,'Conversation changed during refresh','message_source_changed')};check();
   const profile=await this.headerRead(accountId,'profile',{signal:guard.signal,beforeIssue:check})as{emailAddress?:unknown};check();if(typeof profile.emailAddress!=='string'||profile.emailAddress.toLowerCase()!==account.email.toLowerCase())throw new HttpError(409,'Google identity did not match this account','message_source_changed');if(basis.version===null){authority.adoptAccount(accountId);const adopted=this.headerBasis(accountId)!;if(adopted.identity!==basis.identity||adopted.grant!==basis.grant||adopted.grantEpoch!==basis.grantEpoch)throw new HttpError(409,'The message source account changed','message_source_changed');basis.version=adopted.version;basis.authorityStamp=adopted.authorityStamp}check();
   const data=await this.headerRead(accountId,`threads/${encodeURIComponent(before.providerId)}?format=full`,{signal:guard.signal,beforeIssue:check})as{id:string;messages?:GmailMessage[]};check();if(data.id!==before.providerId||!Array.isArray(data.messages)||data.messages.length===0||data.messages.some(m=>m.threadId!==before.providerId))throw new HttpError(502,'Google returned another conversation','invalid_google_thread');
   const staged:{id:string;record:AttachmentRecord}[]=[],raw=[...data.messages].sort((a,b)=>Number(a.internalDate)-Number(b.internalDate)),messages=raw.map(m=>this.normalizeFullMessage(accountId,basis.version,m,staged)),latest=messages.at(-1)!,lastRaw=raw.at(-1)!,labels=[...new Set(raw.flatMap(m=>m.labelIds??[]))];
   return this.syncUnit(undefined,()=>{check();const current=this.store.required<Thread>('thread',threadId),next=presentationThread(this.store,{...current,subject:header(lastRaw.payload,'subject')||'(no subject)',snippet:gmailSnippetToText(typeof lastRaw.snippet==='string'?lastRaw.snippet:''),sender:latest.sender,lastMessageAt:latest.date,messages,participants:[...new Map(messages.flatMap(m=>[m.sender,...m.to,...m.cc??[]]).map(p=>[p.email,p])).values()],providerLabels:labels,unread:current.unread,starred:current.starred});for(const item of staged)this.store.put('messageAttachment',item.id,item.record);return this.store.publishProviderThread(next)});
  }
  get redirectUri() { return this.env.GOOGLE_REDIRECT_URI || 'http://127.0.0.1:3001/api/auth/google/callback'; }
  status(): ProviderStatus {
    const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TOKEN_ENCRYPTION_KEY'].filter(k => !this.env[k]);
    if (this.env.TOKEN_ENCRYPTION_KEY && !/^[a-f\d]{64}$/i.test(this.env.TOKEN_ENCRYPTION_KEY)) missing.push('TOKEN_ENCRYPTION_KEY must be 64 hex characters');
    return { provider: 'google', configured: missing.length === 0, missing, redirectUri: this.redirectUri, deliveryEnabled: missing.length === 0 && this.approved().length > 0 && this.approvedSenders().length > 0, approvedTestRecipients: this.approved(), approvedTestSenders: this.approvedSenders(), capabilities: ['oauth', 'resumable-paginated-sync', 'history-sync', 'background-sync', 'initial-import-live-updates', 'quota-paced-reads', 'labels', 'thread-actions', 'multipart-send', 'attachments', 'explicit-draft-sync', 'new-owned-draft-autosave', 'service-scoped-consent'], limitations: ['Mailbox imports continue automatically. Updates use polling; push notifications are not configured.', 'Newly replica-owned Gmail drafts autosave. Legacy/imported drafts remain unmanaged; ambiguous cloud writes require an explicit check.', 'Calendar requires separate setup and service consent. Contacts and Microsoft Outlook are not implemented.', 'Delivery requires explicitly approved authenticated sender and recipient addresses.'] };
  }
  approved() { return (this.env.APPROVED_TEST_RECIPIENTS ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean); }
  approvedSenders() { return (this.env.APPROVED_TEST_SENDERS ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean); }
  private key() { if (!this.status().configured) throw new HttpError(503, 'Google integration requires credentials', 'provider_not_configured'); return Buffer.from(this.env.TOKEN_ENCRYPTION_KEY!, 'hex'); }
  seal(tokens: Tokens) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key(), iv); const bytes = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]); return [iv, cipher.getAuthTag(), bytes].map(b => b.toString('base64url')).join('.'); }
  unseal(value: string): Tokens { const [iv, tag, data] = value.split('.').map(x => Buffer.from(x, 'base64url')); const cipher = createDecipheriv('aes-256-gcm', this.key(), iv); cipher.setAuthTag(tag); return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8')); }
  private tokenKey(accountId: string, service: GoogleService) { return service === 'mail' ? accountId : `calendar:${accountId}`; }
  grant(accountId: string, service: GoogleService) { return this.store.get<GoogleServiceGrant>('googleGrant', `${service}:${accountId}`); }
  migrateLegacyMailGrants() {
    if (!this.status().configured) return { adopted: 0 };
    return migrateLegacyMailGrantMetadata(this.store, value => this.unseal(value), this.timing.now);
  }
  saveTokens(accountId: string, tokens: Tokens, service: GoogleService = 'mail') { this.store.db.prepare('INSERT INTO secrets VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET value=excluded.value').run(this.tokenKey(accountId, service), this.seal(tokens)); }
  private tokenSlot(accountId:string,service:GoogleService){const row=this.store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(this.tokenKey(accountId,service));if(!row)throw new HttpError(401,'Reconnect this Google service','reconnect_required');return String(row.value)}
  private readTokens(accountId: string, service: GoogleService = 'mail') {return this.unseal(this.tokenSlot(accountId,service))}
  async tokens(accountId: string, service: GoogleService = 'mail'): Promise<Tokens> {
    const sealed=this.tokenSlot(accountId,service),current=this.unseal(sealed); if (current.expires_at > Date.now() + 60_000) return current;
    const key = this.tokenKey(accountId, service); const existing = this.refreshes.get(key); if (existing) return existing;
    const refresh = (async () => {
      if (!current.refresh_token) throw new HttpError(401, 'Reconnect this Google service', 'reconnect_required');
      const basis=captureCredentialMaintenance(this.store,accountId,service,sealed);
      const result = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: current.refresh_token }, service);
      const next = { ...current, access_token: result.access_token, refresh_token: result.refresh_token ?? current.refresh_token, expires_at: Date.now() + result.expires_in * 1000, ...(result.scope !== undefined ? { grantedScopes: result.scope.split(/\s+/).filter(Boolean) } : {}) };
      this.store.db.exec('BEGIN IMMEDIATE'); try { assertCredentialMaintenance(this.store,basis); this.saveTokens(accountId, next, service); const grant = this.grant(accountId, service); if (grant && result.scope !== undefined) this.persistGrant(accountId, { service, requestedScopes: grant.requestedScopes }, result); this.store.db.exec('COMMIT'); } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
      return next;
    })();
    this.refreshes.set(key, refresh); try { return await refresh; } finally { this.refreshes.delete(key); }
  }
  /** Application shutdown first stops owned issue, then drains shared refreshes. */
  async waitForTokenIdle(){for(;;){const work=[...this.refreshes.values()];if(work.length){await Promise.allSettled(work);continue}await Promise.resolve();if(this.refreshes.size===0)return}}
  private async tokenRequest(values: Record<string, string>, service: GoogleService = 'mail'): Promise<TokenResponse> {
    if (!this.status().configured) throw new HttpError(503, 'Google integration is not configured', 'provider_not_configured');
    const result = await this.fetcher('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(20_000), headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.env.GOOGLE_CLIENT_ID!, client_secret: this.env.GOOGLE_CLIENT_SECRET!, ...values }) });
    if (!result.ok) throw new HttpError(result.status === 400 ? 401 : 502, 'Google authorization failed; reconnect the account', 'google_authorization_failed');
    let data: Record<string, unknown>; try { data = await result.json() as Record<string, unknown>; } catch { throw new HttpError(502, 'Google returned an invalid authorization response', 'invalid_google_token_response'); }
    if (!data || typeof data.access_token !== 'string' || !data.access_token || /\s/.test(data.access_token) || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0 || (data.token_type !== undefined && (typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer')) || (data.refresh_token !== undefined && (typeof data.refresh_token !== 'string' || !data.refresh_token))) throw new HttpError(502, 'Google returned an invalid authorization response', 'invalid_google_token_response');
    // OAuth permits an omitted scope when the grant equals the requested scope.
    // A present, narrower grant must never be treated as Gmail write access.
    if (data.scope !== undefined && typeof data.scope !== 'string') throw new HttpError(502, 'Google returned invalid grant scopes', 'invalid_google_token_response');
    if (service === 'mail' && typeof data.scope === 'string' && !data.scope.split(/\s+/).some(scope => scope === GMAIL_SCOPE || scope === 'https://mail.google.com/')) throw new HttpError(403, 'Grant Gmail read and write permission to connect this account', 'insufficient_google_scope');
    return { access_token: data.access_token, refresh_token: data.refresh_token as string | undefined, expires_in: Number(data.expires_in), scope: data.scope as string | undefined };
  }
  startAuth(options: { service?: GoogleService; accountId?: string } = {}) {
    if (!this.status().configured) throw new HttpError(503, `Missing configuration: ${this.status().missing.join(', ')}`, 'provider_not_configured');
    const service = options.service ?? 'mail'; if (!['mail', 'calendar'].includes(service)) throw new HttpError(400, 'Unknown Google service', 'invalid_google_service'); let account: Account | undefined;
    if (service === 'calendar') { if (this.env.GOOGLE_CALENDAR_ENABLED !== 'true') throw new HttpError(503, 'Calendar integration requires explicit setup and authorization', 'calendar_not_enabled'); account = this.store.required<Account>('account', options.accountId ?? this.store.preferences().activeAccountId); if (account.provider !== 'google') throw new HttpError(400, 'Connect Gmail before granting Calendar access', 'calendar_account_required'); }
    const context: GoogleAuthContext = { service, accountId: account?.id, requestedScopes: service === 'calendar' ? [...CALENDAR_REQUEST_SCOPES] : [GMAIL_SCOPE] };
    const state = randomBytes(32).toString('base64url'); const verifier = randomBytes(32).toString('base64url');
    this.store.db.prepare('DELETE FROM oauth_states WHERE expires<?').run(Date.now());
    this.store.db.prepare('INSERT INTO oauth_states(state,verifier,expires,context) VALUES(?,?,?,?)').run(state, verifier, Date.now() + 10 * 60_000, JSON.stringify(context));
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: this.env.GOOGLE_CLIENT_ID!, redirect_uri: this.redirectUri, response_type: 'code', scope: context.requestedScopes.join(' '), access_type: 'offline', prompt: 'consent', ...(service === 'calendar' ? { include_granted_scopes: 'true', login_hint: account!.email } : {}), state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
    return { state, url: url.toString() };
  }
  authService(state: string): GoogleService { const row = this.store.db.prepare('SELECT context FROM oauth_states WHERE state=?').get(state); return row?.context ? (JSON.parse(String(row.context)) as GoogleAuthContext).service : 'mail'; }
  declineAuth(state: string, cookieState: string) {
    const a = Buffer.from(state); const b = Buffer.from(cookieState); if (!state || a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(400, 'Invalid authorization state', 'invalid_oauth_state');
    const row = this.store.db.prepare('SELECT context,expires FROM oauth_states WHERE state=?').get(state); this.store.db.prepare('DELETE FROM oauth_states WHERE state=?').run(state); if (!row || Number(row.expires) < Date.now()) throw new HttpError(400, 'Authorization expired; try again', 'invalid_oauth_state');
    const context: GoogleAuthContext = row.context ? JSON.parse(String(row.context)) : { service: 'mail', requestedScopes: [GMAIL_SCOPE] };
    if (context.accountId) this.store.put('googleOAuthAttempt', `${context.service}:${context.accountId}`, { service: context.service, accountId: context.accountId, requestedScopes: context.requestedScopes, outcome: 'declined', updatedAt: new Date().toISOString() }); return context.service;
  }
  private persistGrant(accountId: string, context: GoogleAuthContext, token: TokenResponse) {
    const grantedScopes = [...new Set((token.scope === undefined ? context.requestedScopes : token.scope.split(/\s+/)).filter(Boolean))];
    const capabilities = calendarCapabilities(grantedScopes); const complete = context.service === 'mail' ? grantedScopes.some(scope => [GMAIL_SCOPE, 'https://mail.google.com/'].includes(scope)) : capabilities.list && capabilities.read && capabilities.writeOwned && capabilities.freebusy;
    const grant: GoogleServiceGrant = { accountId, service: context.service, requestedScopes: context.requestedScopes, grantedScopes, scopeSource: token.scope === undefined ? 'requested' : 'response', updatedAt: new Date().toISOString(), outcome: complete ? 'granted' : 'partial' };
    this.store.put('googleGrant', `${context.service}:${accountId}`, grant); this.store.put('googleOAuthAttempt', `${context.service}:${accountId}`, { service: context.service, accountId, requestedScopes: context.requestedScopes, outcome: grant.outcome, updatedAt: grant.updatedAt }); return grant;
  }
  async finishAuth(state: string, cookieState: string, code: string) {
    const a = Buffer.from(state); const b = Buffer.from(cookieState);
    if (!state || a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(400, 'Invalid authorization state', 'invalid_oauth_state');
    const row = this.store.db.prepare('SELECT verifier,expires,context FROM oauth_states WHERE state=?').get(state);
    this.store.db.prepare('DELETE FROM oauth_states WHERE state=?').run(state);
    if (!row || Number(row.expires) < Date.now()) throw new HttpError(400, 'Authorization expired; try again', 'invalid_oauth_state');
    if (!code) throw new HttpError(400, 'Google did not return an authorization code', 'missing_oauth_code');
    const context: GoogleAuthContext = row.context ? JSON.parse(String(row.context)) : { service: 'mail', requestedScopes: [GMAIL_SCOPE] };
    const token = await this.tokenRequest({ grant_type: 'authorization_code', code, code_verifier: String(row.verifier), redirect_uri: this.redirectUri }, context.service);
    if (context.service === 'calendar') {
      if (this.env.GOOGLE_CALENDAR_ENABLED !== 'true') throw new HttpError(503, 'Calendar integration is disabled', 'calendar_not_enabled');
      const account = this.store.required<Account>('account', context.accountId!);
      const identityResponse = await this.fetcher('https://openidconnect.googleapis.com/v1/userinfo', { signal: AbortSignal.timeout(20_000), headers: { authorization: `Bearer ${token.access_token}` } });
      if (!identityResponse.ok) throw new HttpError(403, 'Could not verify Calendar account identity', 'calendar_identity_unverified');
      const identity = await identityResponse.json() as { email?: unknown; email_verified?: unknown; sub?: unknown };
      if (typeof identity.email !== 'string' || identity.email.toLowerCase() !== account.email.toLowerCase() || identity.email_verified !== true || typeof identity.sub !== 'string' || !identity.sub) throw new HttpError(403, 'Calendar consent must use the selected Gmail account', 'calendar_account_mismatch');
      let old: Tokens | undefined; try { old = this.readTokens(account.id, 'calendar'); } catch { /* first Calendar grant */ }
      const refreshToken = token.refresh_token ?? old?.refresh_token; if (!refreshToken) throw new HttpError(401, 'Offline Calendar access was not granted; existing Gmail access is unchanged', 'offline_access_not_granted');
      this.store.db.exec('BEGIN IMMEDIATE'); try { const grant = this.persistGrant(account.id, context, token); this.saveTokens(account.id, { access_token: token.access_token, refresh_token: refreshToken, expires_at: Date.now() + token.expires_in * 1000, grantedScopes: grant.grantedScopes }, 'calendar'); this.store.db.exec('COMMIT'); return account.id; } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    }
    const profileResponse = await this.fetcher('https://gmail.googleapis.com/gmail/v1/users/me/profile', { signal: AbortSignal.timeout(20_000), headers: { authorization: `Bearer ${token.access_token}` } });
    if (!profileResponse.ok) throw new HttpError(profileResponse.status === 403 ? 403 : 502, profileResponse.status === 403 ? 'Gmail access was denied. Enable the Gmail API and grant Gmail permissions.' : 'Could not retrieve Google profile', 'google_profile_unavailable');
    const profile = await profileResponse.json() as { emailAddress: string };
    if (!profile || typeof profile.emailAddress !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.emailAddress)) throw new HttpError(502, 'Google returned an invalid mailbox identity', 'invalid_google_profile');
    const accountId = `google:${profile.emailAddress.toLowerCase()}`;
    let old: Tokens | undefined; try { old = this.readTokens(accountId); } catch { /* new account */ }
    const refreshToken = token.refresh_token ?? old?.refresh_token;
    if (!refreshToken) throw new HttpError(401, 'Offline access was not granted. Reconnect and grant consent so this account can remain synchronized.', 'offline_access_not_granted');
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const grant = this.persistGrant(accountId, context, token);
      this.saveTokens(accountId, { access_token: token.access_token, refresh_token: refreshToken, expires_at: Date.now() + token.expires_in * 1000, grantedScopes: grant.grantedScopes });
      const existing = this.store.get<Account>('account', accountId);
      this.store.put<Account>('account', accountId, { ...existing, id: accountId, email: profile.emailAddress, name: existing?.name ?? profile.emailAddress.split('@')[0], provider: 'google', color: existing?.color ?? '#6e65cc' });
      this.store.updatePreferences({ activeAccountId: accountId }); this.store.db.exec('COMMIT'); return accountId;
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
  }
  async request(accountId: string, path: string, options: RequestInit = {}, nativeGate?:()=>void, readGuard?:GoogleReadGuard, syncLease?:GoogleReadLease) {
    // Internal producer capability: preserve request DI and default reads while
    // leased sync rechecks ownership immediately before each native issue.
    if(syncLease!==undefined){if(!this.ingress||syncLease.accountId!==accountId||nativeGate!==undefined||readGuard!==undefined||(options.method??'GET').toUpperCase()!=='GET'||options.body!=null||!(/^(?:labels|profile)$/.test(path)||/^threads(?:\?|\/)/.test(path)||/^history\?/.test(path)))throw new HttpError(400,'Invalid owned sync read','invalid_google_read_guard');return this.guardedRead(accountId,path,options,{signal:AbortSignal.timeout(this.ingress.leaseMs),beforeIssue:()=>{this.ingress!.assert(syncLease)}})}
    if (readGuard !== undefined) return this.guardedSendAsRead(accountId,path,options,nativeGate,readGuard);
    const token = await this.tokens(accountId);
    const method = (options.method ?? 'GET').toUpperCase(); const isRead = method === 'GET';
    const attempts = isRead ? 4 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (isRead) await this.paceRead(accountId, readCost(path).units);
      if(nativeGate){if(method!=='POST'||path!=='drafts/send')throw new HttpError(409,'Tracked native gate requires mapped draft Send','tracking_delivery_conflict');nativeGate()}
      let response: Response;
      try { response = await this.fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { ...options, signal: AbortSignal.timeout(25_000), headers: { 'content-type': 'application/json', ...options.headers, authorization: `Bearer ${token.access_token}` } }); }
      catch {
        if (isRead && attempt < attempts - 1) { await this.timing.sleep(1000 * 2 ** attempt + Math.floor(this.timing.random() * 1000)); continue; }
        throw new GoogleRequestError(502, 'Google transport failed; the operation could not be confirmed', 'google_request_failed', { pathFamily: pathFamily(path, method), httpStatus: 0, reasons: [] });
      }
      if (response.ok) return response.status === 204 ? {} : response.json();
      const failure = await this.failure(response, path, method);
      const retryable = failure.code === 'google_rate_limited' || [500, 502, 503, 504].includes(response.status);
      const delay = Math.max(1000 * 2 ** attempt + Math.floor(this.timing.random() * 1000), (failure.diagnostic.retryAfterSeconds ?? 0) * 1000);
      if (isRead && retryable && attempt < attempts - 1 && delay <= 30_000) { await this.timing.sleep(delay); continue; }
      throw failure;
    }
    throw new HttpError(502, 'Google read attempts exhausted');
  }
  /** Dedicated reminder capability. Existing fourth Send/fifth SendAs/sync gates
   * are unchanged. Every command is captured before await and issued at most once. */
  async reminderRequest(accountId:string,command:GoogleReminderCommand,guard:GoogleReminderGuard){
    const prepared=prepareGoogleReminderCommand(command);
    if(!guard||!(guard.signal instanceof AbortSignal)||typeof guard.assertLive!=='function'||typeof guard.beforeIssue!=='function')throw new HttpError(400,'Invalid reminder native guard','reminder_native_invalid');
    const signal=AbortSignal.any([guard.signal,AbortSignal.timeout(20000)]),assertLive=guard.assertLive,beforeIssue=guard.beforeIssue;
    const bounded=<T>(promise:Promise<T>)=>new Promise<T>((resolve,reject)=>{if(signal.aborted){reject(signal.reason);return}const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))});
    const check=()=>{signal.throwIfAborted();assertLive()};check();const token=await this.tokens(accountId);check();
    if(prepared.method==='GET'){await this.paceRead(accountId,readCost(prepared.path).units);check()}
    let response:Response;
    check();beforeIssue();signal.throwIfAborted();try{response=await bounded(this.fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/${prepared.path}`,{method:prepared.method,body:prepared.body,redirect:'error',signal,headers:{'content-type':'application/json',authorization:`Bearer ${token.access_token}`}}))}catch{throw new HttpError(502,'Reminder native result is unconfirmed','reminder_native_unknown')}
    // A received write ACK may still be recorded after cancellation/Stop; it is
    // never permission to publish a return for a replacement generation.
    if(prepared.method==='GET')check();
    if(!response.ok)throw new HttpError(502,'Reminder native result is unconfirmed','reminder_native_unknown');
    const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>4194304))throw new HttpError(502,'Reminder response exceeds its bound','reminder_native_unknown');
    const reader=response.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
    try{if(reader)for(;;){signal.throwIfAborted();const part=await bounded(reader.read());if(part.done)break;size+=part.value.byteLength;if(size>4194304)throw Error('bounded response');chunks.push(part.value)}}catch{throw new HttpError(502,'Reminder response is unconfirmed','reminder_native_unknown')}finally{if(reader)await bounded(reader.cancel()).catch(()=>{})}
    let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))||'{}')}catch{throw new HttpError(502,'Reminder response is invalid','reminder_native_unknown')}
    if(prepared.method==='GET')check();return value;
  }
  private async guardedSendAsRead(accountId:string,path:string,options:RequestInit,nativeGate:(()=>void)|undefined,readGuard:GoogleReadGuard) {
    if (nativeGate !== undefined || (options.method??'GET').toUpperCase()!=='GET' || path!=='settings/sendAs?fields=sendAs(sendAsEmail,isPrimary,verificationStatus)' || options.body!=null || !readGuard || !(readGuard.signal instanceof AbortSignal) || typeof readGuard.beforeIssue!=='function') throw new HttpError(400,'Identity read guard requires the fixed SendAs GET','invalid_google_read_guard');
    return this.guardedRead(accountId,path,options,readGuard);
  }
  /** Internal read path shared by fixed SendAs and a producer-owned sync lease.
   * Public fifth-argument guard remains restricted to the fixed SendAs GET. */
  private async guardedRead(accountId:string,path:string,options:RequestInit,readGuard:GoogleReadGuard,maxResponseBytes?:number) {
    // Capture the trusted guard before any await. Default request families and
    // the fourth-argument tracked Send permit keep their existing path above.
    const caller=readGuard.signal,beforeIssue=readGuard.beforeIssue;
    // Cache DI may forward its beforeIssue property with RequestInit. It is a
    // local capability, never a fetch option. Capture caller options once.
    const {beforeIssue:_localGuard,...requestOptions}=options as RequestInit&{beforeIssue?:unknown};
    const optionSignal=requestOptions.signal;
    const check=()=>{caller.throwIfAborted();optionSignal?.throwIfAborted();beforeIssue()};
    check();const token=await this.tokens(accountId);check();
    for(let attempt=0;attempt<4;attempt++) {
      await this.paceRead(accountId,readCost(path).units);check();
      const signal=AbortSignal.any([caller,...(optionSignal?[optionSignal]:[]),AbortSignal.timeout(25_000)]);
      let response:Response;
      try { check();signal.throwIfAborted();response=await this.fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`,{...requestOptions,method:'GET',signal,headers:{'content-type':'application/json',...requestOptions.headers,authorization:`Bearer ${token.access_token}`}}); }
      catch { check();signal.throwIfAborted();if(attempt<3){await this.timing.sleep(1000*2**attempt+Math.floor(this.timing.random()*1000));check();continue}throw new GoogleRequestError(502,'Google transport failed; the operation could not be confirmed','google_request_failed',{pathFamily:pathFamily(path,'GET'),httpStatus:0,reasons:[]}) }
      check();signal.throwIfAborted();
      if(maxResponseBytes!==undefined&&response.status!==204){const bytes=await this.headerResponseBytes(response,signal,check,maxResponseBytes);response=new Response(bytes,{status:response.status,headers:response.headers})}
      if(response.ok){const value=response.status===204?{}:await response.json();check();signal.throwIfAborted();return value}
      const failure=await this.failure(response,path,'GET');check();signal.throwIfAborted();
      const retryable=failure.code==='google_rate_limited'||[500,502,503,504].includes(response.status),delay=Math.max(1000*2**attempt+Math.floor(this.timing.random()*1000),(failure.diagnostic.retryAfterSeconds??0)*1000);
      if(retryable&&attempt<3&&delay<=30_000){await this.timing.sleep(delay);check();continue}throw failure;
    }
    throw new HttpError(502,'Google read attempts exhausted');
  }
  private async headerResponseBytes(response:Response,signal:AbortSignal,check:()=>void,max:number){const declared=response.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>max)){void response.body?.cancel().catch(()=>{});throw new HttpError(502,'Conversation is too large to refresh','message_source_limit')}const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;const cancel=()=>{if(reader)void reader.cancel().catch(()=>{})};signal.addEventListener('abort',cancel,{once:true});try{if(reader)for(;;){check();signal.throwIfAborted();const part=await reader.read();check();signal.throwIfAborted();if(part.done)break;size+=part.value.byteLength;if(size>max)throw new HttpError(502,'Conversation is too large to refresh','message_source_limit');chunks.push(part.value)}return Buffer.concat(chunks)}finally{signal.removeEventListener('abort',cancel);cancel()}}
  private paceRead(accountId: string, units: number) {
    const previous = this.readTails.get(accountId) ?? Promise.resolve();
    const turn = previous.then(async () => {
      const delay = Math.max(0, (this.readStarts.get(accountId) ?? 0) - this.timing.now()); if (delay) await this.timing.sleep(delay);
      const configured = Number(this.env.GMAIL_READ_QUOTA_UNITS_PER_MINUTE ?? 4800); const budget = Number.isFinite(configured) && configured > 0 && configured <= 6000 ? configured : 4800;
      this.readStarts.set(accountId, this.timing.now() + units * 60_000 / budget);
    });
    const tail = turn.catch(() => {}); this.readTails.set(accountId, tail); void tail.then(() => { if (this.readTails.get(accountId) === tail) this.readTails.delete(accountId); }); return turn;
  }
  private async failure(response: Response, path: string, method: string) {
    let data: { error?: { status?: unknown; errors?: { reason?: unknown }[] } } = {}; try { data = await response.json(); } catch { /* Only whitelisted structured codes are retained. */ }
    const reasons = Array.isArray(data?.error?.errors) ? [...new Set(data.error.errors.map(item => item?.reason).filter((reason): reason is string => typeof reason === 'string' && safeGoogleReasons.has(reason)))] : [];
    const status = typeof data?.error?.status === 'string' && safeGoogleStatuses.has(data.error.status) ? data.error.status : undefined;
    const retryHeader = response.headers.get('retry-after'); const retrySeconds = retryHeader ? /^\d+$/.test(retryHeader) ? Number(retryHeader) : Math.ceil((Date.parse(retryHeader) - this.timing.now()) / 1000) : undefined;
    const retryAfterSeconds = retrySeconds !== undefined && Number.isFinite(retrySeconds) && retrySeconds >= 0 ? retrySeconds : undefined;
    const diagnostic: GoogleFailureDiagnostic = { pathFamily: pathFamily(path, method), httpStatus: response.status, status, reasons, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) };
    if (reasons.includes('dailyLimitExceeded')) return new GoogleRequestError(429, 'Google daily quota reached; retry after quota resets', 'google_daily_quota_exceeded', diagnostic);
    if (response.status === 429 || reasons.some(reason => ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded'].includes(reason))) return new GoogleRequestError(429, 'Google rate limit reached; mailbox sync will resume after backoff', 'google_rate_limited', diagnostic);
    if (response.status === 401) return new GoogleRequestError(401, 'Reconnect this Google account', 'reconnect_required', diagnostic);
    if (response.status === 404) return new GoogleRequestError(404, 'Google resource was not found', 'google_not_found', diagnostic);
    if (response.status === 403) return new GoogleRequestError(403, 'Google denied this operation; check granted permissions and API policy', 'google_permission_denied', diagnostic);
    return new GoogleRequestError(502, 'Google request failed; retry sync later', 'google_request_failed', diagnostic);
  }
  private syncUnit<T>(lease:GoogleReadLease|undefined,work:()=>T):T {
    if(lease)return this.ingress!.unit(lease,work);
    this.store.db.exec('SAVEPOINT google_sync_publication');try{const result=work();this.store.db.exec('RELEASE google_sync_publication');return result}catch(e){this.store.db.exec('ROLLBACK TO google_sync_publication;RELEASE google_sync_publication');throw e}
  }
  /** Only between committed producer units. Admitted sync still drains on
   * graceful shutdown; owner/ingress revocation remains a terminal refusal. */
  private async yieldSync(lease:GoogleReadLease|undefined){
    if(this.store.db.isTransaction)throw Error('Sync yield cannot hold a SQL transaction');
    await this.timing.yieldSync();
    if(lease)this.ingress!.assert(lease);
  }
  private async syncRead(accountId:string,path:string,lease?:GoogleReadLease){if(lease)this.ingress!.assert(lease);const result=await this.request(accountId,path,{},undefined,undefined,lease);if(lease)this.ingress!.assert(lease);return result}
  async sync(accountId:string,limits:SyncLimits={}){const lease=this.ingress?.begin(accountId);let success=false;try{const result=await this.syncOwned(accountId,limits,lease);success=true;return result}finally{if(lease)this.ingress!.finish(lease,success)}}
  private async syncOwned(accountId:string,limits:SyncLimits,lease?:GoogleReadLease){
    const account = this.store.required<Account>('account', accountId);
    if (account.provider !== 'google') throw new HttpError(400, 'This account is a demo account');
    const labelsResponse = await this.syncRead(accountId,'labels',lease) as { labels?: { id: string; name: string; type: string; color?: { backgroundColor: string } }[] };
    for (const label of labelsResponse.labels ?? []) if (label.type === 'user') { this.syncUnit(lease,()=>this.store.put<Label>('label', `${accountId}:${label.id}`, { id: `${accountId}:${label.id}`, accountId, name: label.name, color: label.color?.backgroundColor, providerId: label.id })); await this.yieldSync(lease); }
    let state = this.store.get<SyncState>('sync', accountId) ?? await this.beginInitialSync(accountId,lease);
    let imported = 0; let pages = 0; let threadReads = 0;
    const configuredPages = Number(this.env.GMAIL_SYNC_PAGES_PER_RUN ?? 2);
    const selectedPages = limits.maxPages ?? configuredPages;
    const maxPages = Number.isInteger(selectedPages) && selectedPages >= 1 && selectedPages <= 10 ? selectedPages : 2;
    const pageSize = Number.isInteger(limits.pageSize) && limits.pageSize! >= 1 && limits.pageSize! <= 100 ? limits.pageSize! : 100;
    const selectedReads = limits.maxThreadReads ?? limits.pageSize ?? 1000;
    const maxThreadReads = Number.isInteger(selectedReads) && selectedReads >= 1 && selectedReads <= 1000 ? selectedReads : 1000;
    if (state.phase === 'initial' && limits.catchupDuringInitial) {
      const caughtUp = await this.catchupInitial(account, state, pageSize, maxThreadReads,lease);
      state = caughtUp.state; imported += caughtUp.threadReads; threadReads += caughtUp.threadReads;
    }
    for (; pages < maxPages; pages++) {
      if (!state.pending) {
        if (state.phase === 'initial') {
          const query = new URLSearchParams({ maxResults: String(pageSize), includeSpamTrash: 'true', ...(state.pageToken ? { pageToken: state.pageToken } : {}) });
          const listing = await this.syncRead(accountId, `threads?${query}`,lease) as { threads?: { id: string }[]; nextPageToken?: string; resultSizeEstimate?: number };
          state = { ...state, partial: true, pending: { ids: [...new Set((listing.threads ?? []).map(item => item.id))], nextPageToken: listing.nextPageToken, resultSizeEstimate: listing.resultSizeEstimate } };
        } else {
          let page: HistoryPage;
          try { page = await this.syncRead(accountId, `history?${new URLSearchParams({ startHistoryId: state.historyId, maxResults: String(pageSize), ...(state.pageToken ? { pageToken: state.pageToken } : {}) })}`,lease) as HistoryPage; }
          catch (error) { if (error instanceof HttpError && error.code === 'google_not_found') { state = await this.beginInitialSync(accountId,lease); continue; } throw error; }
          if (!page.historyId) throw new HttpError(502, 'Google history response omitted its cursor', 'invalid_google_history');
          state = { ...state, partial: true, pending: { ids: changedThreadIds(page), nextPageToken: page.nextPageToken, historyId: page.historyId,...(lease?{provenance:this.ingress!.page(lease,state.historyId,page,'live')}:{}) } };
        }
        this.syncUnit(lease,()=>this.store.put('sync', accountId, state));
      }
      // Each completed thread is checkpointed before the next read. Initial
      // retry skips already imported generation members; history does not skip
      // them, because those records specifically represent subsequent changes.
      for (const id of [...state.pending!.ids]) {
        const alreadyImported = state.phase === 'initial' && this.store.get<Thread>('thread', `${accountId}:${id}`)?.syncGeneration === state.generation;
        if (!alreadyImported) { if (threadReads >= maxThreadReads) break; await this.syncThread(account,id,state.generation,lease,state.pending!.provenance,state.phase==='initial'?'initial':'repair'); imported++; threadReads++; }
        state = { ...state, pending: { ...state.pending!, ids: state.pending!.ids.filter(item => item !== id) } }; this.syncUnit(lease,()=>this.store.put('sync', accountId, state)); await this.yieldSync(lease);
      }
      if (state.pending!.ids.length) { pages++; break; }
      const completed = state.pending!;
      if (state.phase === 'initial') {
        if (completed.nextPageToken) state = { ...state, pending: undefined, pageToken: completed.nextPageToken, resultSizeEstimate: completed.resultSizeEstimate, partial: true };
        else {
          // Reconcile deletions only after every initial page completed. A failed
          // or interrupted page never advances the durable cursor.
          this.syncUnit(lease,()=>{for (const thread of this.store.list<Thread>('thread')) if (thread.accountId === accountId && thread.syncGeneration !== state.generation) this.store.remove('thread', thread.id)});
          state = { ...state, phase: 'history', pending: state.catchup?.pending, pageToken: state.catchup?.pageToken, historyId: state.catchup?.historyId ?? state.historyId, catchup: undefined, resultSizeEstimate: completed.resultSizeEstimate, partial: true };
        }
      } else {
        state = { ...state, pending: undefined, pageToken: completed.nextPageToken, historyId: completed.nextPageToken ? state.historyId : completed.historyId!, partial: !!completed.nextPageToken, ...(!completed.nextPageToken ? { lastCompletedAt: new Date().toISOString() } : {}) };
      }
      this.syncUnit(lease,()=>this.store.put('sync', accountId, state));
      if (!state.partial) { pages++; break; }
      if (threadReads >= maxThreadReads) { pages++; break; }
    }
    if (!state.partial) this.syncUnit(lease,()=>this.store.put('account', accountId, { ...account, lastSyncedAt: state.lastCompletedAt }));
    return { imported, pages, partial: state.partial, phase: state.phase, resultSizeEstimate: state.resultSizeEstimate, scope: 'durable paginated all-folder thread scan followed by history changes; call again while partial is true' };
  }
  private async catchupInitial(account: Account, state: SyncState, pageSize: number, maxThreadReads: number,lease?:GoogleReadLease) {
    let catchup: InitialCatchup = state.catchup ?? { historyId: state.historyId };
    if (!catchup.pending) {
      let page: HistoryPage;
      try { page = await this.syncRead(account.id, `history?${new URLSearchParams({ startHistoryId: catchup.historyId, maxResults: String(pageSize), ...(catchup.pageToken ? { pageToken: catchup.pageToken } : {}) })}`,lease) as HistoryPage; }
      catch (error) {
        if (error instanceof HttpError && error.code === 'google_not_found') {
          // An expired change log cannot prove deletions. Restart the full scan
          // under a new generation, retaining old rows until that scan completes.
          const fresh = { ...await this.beginInitialSync(account.id,lease), lastResetReason: 'history_expired' as const };
          this.syncUnit(lease,()=>this.store.put('sync', account.id, fresh)); return { state: fresh, threadReads: 0 };
        }
        throw error;
      }
      if (!page.historyId) throw new HttpError(502, 'Google history response omitted its cursor', 'invalid_google_history');
      catchup = { ...catchup, pending: { ids: changedThreadIds(page), nextPageToken: page.nextPageToken, historyId: page.historyId,...(lease?{provenance:this.ingress!.page(lease,catchup.historyId,page,'catchup')}:{}) } };
      state = { ...state, catchup }; this.syncUnit(lease,()=>this.store.put('sync', account.id, state));
    }
    let threadReads = 0;
    for (const id of [...catchup.pending!.ids]) {
      if (threadReads >= maxThreadReads) break;
      await this.syncThread(account,id,state.generation,lease,catchup.pending!.provenance); threadReads++;
      catchup = { ...catchup, pending: { ...catchup.pending!, ids: catchup.pending!.ids.filter(item => item !== id) } }; state = { ...state, catchup }; this.syncUnit(lease,()=>this.store.put('sync', account.id, state)); await this.yieldSync(lease);
    }
    if (!catchup.pending!.ids.length) {
      const completed = catchup.pending!;
      catchup = { ...catchup, pending: undefined, pageToken: completed.nextPageToken, historyId: completed.nextPageToken ? catchup.historyId : completed.historyId!, ...(!completed.nextPageToken ? { lastCompletedAt: new Date().toISOString() } : {}) };
      state = { ...state, catchup }; this.syncUnit(lease,()=>this.store.put('sync', account.id, state));
    }
    return { state, threadReads };
  }
  private async beginInitialSync(accountId:string,lease?:GoogleReadLease):Promise<SyncState>{if(lease)this.ingress!.invalidate(lease);const preBasis=this.headerBasis(accountId);if(preBasis&&preBasis.version===null)new AccountIncarnationAuthority(this.store);const basis=this.headerBasis(accountId),profile=await this.syncRead(accountId,'profile',lease) as {historyId:string;emailAddress?:string};if(basis){this.assertHeaderBasis(basis);const account=this.store.required<Account>('account',accountId);if(profile.emailAddress?.toLowerCase()===account.email.toLowerCase()&&basis.version===null)new AccountIncarnationAuthority(this.store).adoptAccount(accountId)}if(!profile.historyId)throw new HttpError(502,'Google profile omitted history cursor');const state:SyncState={phase:'initial',historyId:profile.historyId,generation:randomBytes(16).toString('hex'),partial:true};return this.syncUnit(lease,()=>this.store.put('sync',accountId,state))}
  syncStatus(accountId: string) { this.store.required<Account>('account', accountId); const state = this.store.get<SyncState>('sync', accountId); const health = this.store.get<{ status: 'queued' | 'running' | 'ready' | 'error'; error?: string; code?: string; updatedAt?: string }>('syncHealth', accountId); return { ...(state ? { phase: state.phase, partial: state.partial, lastCompletedAt: state.lastCompletedAt, resultSizeEstimate: state.resultSizeEstimate } : { phase: 'not-started', partial: true }), catchupAt: state?.catchup?.lastCompletedAt, catchupPending: state?.catchup?.pending?.ids.length, lastResetReason: state?.lastResetReason, status: health?.status ?? 'idle', error: health?.error, code: health?.code, updatedAt: health?.updatedAt }; }
  private async syncThread(account: Account, threadId: string, generation: string,lease?:GoogleReadLease,provenance?:GooglePageProof,origin:'initial'|'repair'='repair') {
    const basis=this.headerBasis(account.id);
    let data: { id: string; messages?: GmailMessage[] };
    try { data = await this.syncRead(account.id, `threads/${encodeURIComponent(threadId)}?format=full`,lease) as typeof data; }
    catch (error) { if (error instanceof HttpError && error.code === 'google_not_found') { this.syncUnit(lease,()=>this.store.remove('thread', `${account.id}:${threadId}`)); return; } throw error; }
    if(basis)this.assertHeaderBasis(basis);
    if(data.id!==threadId||(data.messages??[]).some(message=>message.threadId!==threadId))throw new HttpError(502,'Google returned another thread','invalid_google_thread');
    const staged:{id:string;record:AttachmentRecord}[]=[];
    const raw = [...(data.messages ?? [])].sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
    const messages = raw.map(message => this.normalizeFullMessage(account.id,basis?.version??null,message,staged)); if (!messages.length) { this.syncUnit(lease,()=>this.store.remove('thread', `${account.id}:${threadId}`)); return; }
    const latest = messages.at(-1)!; const lastRaw = raw.at(-1)!; const labels = [...new Set(raw.flatMap(message => message.labelIds ?? []))];
    const id = `${account.id}:${data.id}`; const existing = this.store.get<Thread>('thread', id);
    const folder = labels.includes('INBOX') ? 'inbox' : raw.every(message => message.labelIds?.includes('TRASH')) ? 'trash' : raw.every(message => message.labelIds?.includes('SPAM')) ? 'spam' : raw.every(message => message.labelIds?.includes('DRAFT')) ? 'drafts' : labels.includes('SENT') ? 'sent' : 'done';
    const thread:Thread={ id, accountId: account.id, providerId: data.id, subject: header(lastRaw.payload, 'subject') || '(no subject)', snippet: gmailSnippetToText(lastRaw.snippet), sender: latest.sender, participants: [...new Map(messages.flatMap(message => [message.sender, ...message.to, ...(message.cc ?? [])]).map(p => [p.email, p])).values()], lastMessageAt: latest.date, unread: labels.includes('UNREAD'), starred: labels.includes('STARRED'), important: labels.includes('IMPORTANT'), folder, labels: labels.filter(label => !/^[A-Z_]+$/.test(label)).map(label => `${account.id}:${label}`), messages, snoozedUntil: existing?.snoozedUntil, snoozeRetryAt: existing?.snoozeRetryAt, snoozeError: existing?.snoozeError, muted: existing?.muted, syncGeneration: generation, providerLabels: labels };
    this.syncUnit(lease,()=>{for(const entry of staged)this.store.put('messageAttachment',entry.id,entry.record);this.store.publishProviderThread(presentationThread(this.store,thread));if(lease)this.ingress!.publish(lease,this.store.required<Thread>('thread',id),provenance,origin,new Map(raw.map(m=>[m.id,this.replyMetadata(m.payload)])))});
  }
  private replyMetadata(payload:GmailPart):GoogleReplyMetadata{
    const headers=payload.headers;if(!Array.isArray(headers)||headers.length>1000||headers.some(h=>typeof h.name!=='string'||typeof h.value!=='string'||h.name.length>256||Buffer.byteLength(h.value)>16384||/[\r\n\0]/.test(h.name+h.value)))return{headersComplete:false,replyTo:null};
    const relevant=headers.filter(h=>['from','to','cc','reply-to','message-id','references'].includes(h.name.toLowerCase()));
    if(new Set(relevant.map(h=>h.name.toLowerCase())).size!==relevant.length)return{headersComplete:false,replyTo:null};
    return{headersComplete:true,replyTo:headers.find(h=>h.name.toLowerCase()==='reply-to')?.value??null};
  }
  normalizeMessage(raw: GmailMessage, accountId?: string,staged?:{id:string;record:AttachmentRecord}[]): Message {
    const parsed = parts(raw.payload, raw.id);
    if(accountId)for(const part of parsed.attachmentParts){const entry={id:attachmentRecordId(accountId,raw.id,part.attachment.id),record:{accountId,messageId:raw.id,attachment:part.attachment,...(part.data!==undefined?{data:part.data}:{})}};if(staged)staged.push(entry);else this.store.put<AttachmentRecord>('messageAttachment',entry.id,entry.record)}
    return { id: raw.id, sender: person(header(raw.payload, 'from')), to: parseRecipients(header(raw.payload, 'to')), cc: parseRecipients(header(raw.payload, 'cc')), date: new Date(Number(raw.internalDate)).toISOString(), internetMessageId: header(raw.payload, 'message-id') || undefined, references: header(raw.payload, 'references') || undefined, providerLabels: raw.labelIds ?? [], text: parsed.text, html: parsed.html, attachments: parsed.attachmentParts.map(part => part.attachment) };
  }
  async updateThread(before: Thread, after: Thread) {
    if (!before.providerId) return;
    const beforeLabels = this.providerLabels(before); const afterLabels = this.providerLabels(after);
    const addLabelIds = afterLabels.filter(l => !beforeLabels.includes(l)); const removeLabelIds = beforeLabels.filter(l => !afterLabels.includes(l));
    if (addLabelIds.length || removeLabelIds.length) await this.request(before.accountId, `threads/${encodeURIComponent(before.providerId)}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds, removeLabelIds }) });
  }
  providerLabels(thread: Thread) { return thread.providerLabels ?? [...(thread.folder === 'inbox' ? ['INBOX'] : thread.folder === 'trash' ? ['TRASH'] : thread.folder === 'spam' ? ['SPAM'] : []), ...(thread.unread ? ['UNREAD'] : []), ...(thread.starred ? ['STARRED'] : []), ...thread.labels.map(id => this.store.get<Label>('label', id)?.providerId).filter((x): x is string => !!x)]; }
  validateDelivery(draft: Draft) {
    this.store.assertProviderDraftDeliveryReady(draft);
    const recipients = parseOutgoingRecipientHeaders(draft).recipients.map(person => person.email.toLowerCase());
    if ([draft.to, draft.cc, draft.bcc, draft.subject].some(x => /[\r\n]/.test(x))) throw new HttpError(400, 'Email headers cannot contain line breaks');
    if (recipients.some(x => !this.approved().includes(x))) throw new HttpError(403, 'Delivery is limited to explicitly approved test recipients. Configure APPROVED_TEST_RECIPIENTS after receiving authorization.', 'recipient_not_approved');
    const account = this.store.required<Account>('account', draft.accountId);
    if (!this.approvedSenders().includes(account.email.toLowerCase())) throw new HttpError(403, 'This authenticated sender is not approved for test delivery. Configure APPROVED_TEST_SENDERS after receiving authorization.', 'sender_not_approved');
  }
  mime(draft: Draft) {
    const account = this.store.required<Account>('account', draft.accountId);
    const thread = draft.threadId ? this.store.get<Thread>('thread', draft.threadId) : undefined;
    const raw = Buffer.from(buildMime(draft, account, draft.deliveryReplyContext ?? (thread?this.store.replySource(thread.id):undefined), (draft.attachments ?? []).map(metadata => ({ metadata, bytes: this.store.attachmentBytes(draft.id, metadata.id) })))).toString('base64url');
    const providerThreadId = draft.deliveryReplyContext ? draft.deliveryReplyContext.providerThreadId : thread?.providerId;
    return { raw, ...(providerThreadId ? { threadId: providerThreadId } : {}) };
  }
  async syncDraft(draft: Draft) {
    if (draft.composerSendId || this.store.composerDeliveryId(draft.id)) throw new HttpError(409, 'Composer deliveries cannot synchronize an editable provider draft', 'composer_delivery_locked');
    if (draft.artifactSendId || this.store.artifactDeliveryId(draft.id)) throw new HttpError(409, 'Artifact deliveries cannot synchronize an editable provider draft', 'artifact_delivery_locked');
    if (this.store.hasProviderDraftLink(draft.id)) throw new HttpError(409, 'Use the owned cloud draft ledger', 'provider_draft_owned_requires_ledger');
    if (this.store.required<Account>('account', draft.accountId).provider !== 'google') throw new HttpError(409, 'Demo drafts cannot sync to Google');
    const message = this.mime(draft);
    const result = await this.request(draft.accountId, draft.providerDraftId ? `drafts/${encodeURIComponent(draft.providerDraftId)}` : 'drafts', { method: draft.providerDraftId ? 'PUT' : 'POST', body: JSON.stringify({ ...(draft.providerDraftId ? { id: draft.providerDraftId } : {}), message }) }) as { id: string };
    return this.store.saveDraft({ id: draft.id, providerDraftId: result.id, providerDraftSyncedAt: new Date().toISOString() });
  }
  async send(draft: Draft) {
    this.store.assertUntrackedNativeSend(draft);
    const linked = this.store.artifactDeliveryId(draft.id);
    if (linked) {
      const pending = this.store.required<Draft>('draft', draft.id);
      if (draft.artifactSendId !== linked || pending.artifactSendId !== linked || pending.status !== 'sending' || draft.status !== 'sending' || !draft.deliveryAttemptId || pending.deliveryAttemptId !== draft.deliveryAttemptId || pending.deliveryMarker !== draft.deliveryMarker) throw new HttpError(409, 'Artifact Send requires its durable claimed attempt', 'artifact_delivery_locked');
    }
    const composer = this.store.composerDeliveryId(draft.id);
    if (composer || draft.composerSendId) {
      const pending = this.store.required<Draft>('draft', draft.id);
      if (draft.composerSendId !== composer || pending.composerSendId !== composer || pending.status !== 'sending' || draft.status !== 'sending' || !draft.deliveryAttemptId || pending.deliveryAttemptId !== draft.deliveryAttemptId || pending.deliveryMarker !== draft.deliveryMarker) throw new HttpError(409, 'Composer Send requires its durable claimed attempt', 'composer_delivery_locked');
    }
    if (!composer && !linked && this.store.cancelledDeliveryHistory(draft.id)) throw new HttpError(409, 'A fresh explicit keyed Send intent is required after Undo', 'send_intent_required');
    this.store.assertProviderDraftNativeSend(draft);
    this.validateDelivery(draft);
    const account = this.store.required<Account>('account', draft.accountId);
    if (account.provider !== 'google') throw new HttpError(409, 'Demo accounts cannot deliver email', 'demo_delivery_disabled');
    const message = this.mime(draft);
    return this.request(draft.accountId, draft.providerDraftId ? 'drafts/send' : 'messages/send', { method: 'POST', body: JSON.stringify(draft.providerDraftId ? { id: draft.providerDraftId, message } : message) });
  }
  // Internal persisted-wire path. No MIME rebuild and no messages.send fallback.
  async sendPersistedWire(draft:Draft,wire:{providerDraftId:string;raw:string;threadId?:string},authorize:()=>void){
    const validate=()=>{
      const current=this.store.required<Draft>('draft',draft.id),operationId=draft.composerSendId??draft.artifactSendId;
      if(!operationId||current.status!=='sending'||draft.status!=='sending'||current.accountId!==draft.accountId||current.deliveryAttemptId!==draft.deliveryAttemptId||!draft.deliveryAttemptId||current.deliveryMarker!==draft.deliveryMarker||current.composerSendId!==draft.composerSendId||current.artifactSendId!==draft.artifactSendId||!draft.providerDraftId||wire.providerDraftId!==draft.providerDraftId||current.providerDraftId!==wire.providerDraftId)throw new HttpError(409,'Tracked Send requires its exact mapped claim','tracking_delivery_conflict');
      if(this.store.required<Account>('account',draft.accountId).provider!=='google')throw new HttpError(409,'Demo accounts cannot send email','demo_delivery_disabled');
      if(typeof wire.raw!=='string'||wire.raw.length>48*1024*1024||!wire.raw||Buffer.from(wire.raw,'base64url').toString('base64url')!==wire.raw||wire.threadId!==undefined&&(typeof wire.threadId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(wire.threadId)))throw new HttpError(409,'Tracked wire is unavailable','tracking_delivery_corrupt');
      this.store.assertProviderDraftNativeSend(current);this.validateDelivery(current);
    };
    validate();const message={raw:wire.raw,...(wire.threadId?{threadId:wire.threadId}:{})},body=JSON.stringify({id:wire.providerDraftId,message});
    return this.request(draft.accountId,'drafts/send',{method:'POST',body},()=>{validate();authorize()});
  }
  private deliveryMetadataPath(id: string) { const query = new URLSearchParams({ format: 'metadata' }); for (const name of ['X-Reconstruction-Delivery-ID', 'Message-ID', 'From']) query.append('metadataHeaders', name); return `messages/${encodeURIComponent(id)}?${query}`; }
  private inspectDeliveryMetadata(account: Account, id: string, value: unknown, marker: string) {
    const data = value as { id?: unknown; labelIds?: unknown; payload?: { headers?: unknown } } | null;
    if (!data || data.id !== id || !Array.isArray(data.labelIds) || !data.labelIds.every(label => typeof label === 'string') || !Array.isArray(data.payload?.headers)) throw new HttpError(502, 'Gmail returned invalid Sent metadata', 'invalid_google_message_metadata');
    const headers = data.payload.headers as { name?: unknown; value?: unknown }[];
    if (headers.some(header => !header || typeof header.name !== 'string' || typeof header.value !== 'string')) throw new HttpError(502, 'Gmail returned invalid Sent headers', 'invalid_google_message_metadata');
    const values = (name: string) => headers.filter(header => String(header.name).toLowerCase() === name).map(header => String(header.value).replace(/\r\n[ \t]+/g, ' ').trim());
    const from = values('from'); const senders = from.length === 1 ? parseRecipients(from[0]) : [];
    const identityValid = data.labelIds.includes('SENT') && senders.length === 1 && senders[0].email.toLowerCase() === account.email.toLowerCase();
    const markers = values('x-reconstruction-delivery-id'); const markerMatches = markers.length === 1 && markers[0] === marker; const markerPresent = markers.includes(marker);
    const messageIds = values('message-id'); const providerInternetMessageId = messageIds.length === 1 && /^<[^<>\s]+@[^<>\s]+>$/.test(messageIds[0]) ? messageIds[0] : undefined;
    return { identityValid, markerMatches, markerPresent, providerInternetMessageId };
  }
  async acknowledgedDeliveryMetadata(draft: Draft, providerMessageId: string) {
    if (!draft.deliveryMarker || !/^[A-Za-z0-9_-]{32}$/.test(draft.deliveryMarker)) return undefined;
    const account = this.store.required<Account>('account', draft.accountId); const value = await this.request(draft.accountId, this.deliveryMetadataPath(providerMessageId)); const metadata = this.inspectDeliveryMetadata(account, providerMessageId, value, draft.deliveryMarker);
    if (!metadata.identityValid) throw new HttpError(409, 'Sent metadata does not match the acknowledged account', 'delivery_identity_conflict');
    return { providerInternetMessageId: metadata.providerInternetMessageId, markerVerified: metadata.markerMatches };
  }
  async reconcileDelivery(draft: Draft): Promise<DeliveryReconciliation> {
    let scannedCandidates = 0; const matches: { id: string; internetMessageId?: string }[] = [];
    const unresolved = (reason: DeliveryReconciliation['reason'], scanComplete = false): DeliveryReconciliation => ({ found: false, matches: matches.length, scanComplete, scannedCandidates, reason });
    if (!draft.deliveryMarker || !/^[A-Za-z0-9_-]{32}$/.test(draft.deliveryMarker)) return unresolved('legacy_attempt_unverifiable');
    const attempt = draft.deliveryAttemptId ? this.store.get<DeliveryAttempt>('delivery', draft.deliveryAttemptId) : undefined;
    if (!attempt || attempt.draftId !== draft.id || attempt.marker !== draft.deliveryMarker || attempt.messageId !== draft.deliveryMessageId || !['unknown', 'dispatching'].includes(attempt.status) || !Number.isFinite(Date.parse(attempt.startedAt))) return unresolved('attempt_identity_unverified');
    const account = this.store.required<Account>('account', draft.accountId); if (account.provider !== 'google') return unresolved('account_identity_unverified');
    try {
      const profile = await this.request(draft.accountId, 'profile') as { emailAddress?: unknown };
      if (!profile || typeof profile.emailAddress !== 'string' || profile.emailAddress.toLowerCase() !== account.email.toLowerCase()) return unresolved('account_identity_unverified');
      // Gmail may replace the requested RFC Message-ID. Search only a bounded
      // recent Sent window, then prove identity using the opaque header value.
      const after = Math.max(0, Math.floor(Date.parse(attempt.startedAt) / 1000) - 120); const seen = new Set<string>(); let pageToken: string | undefined;
      for (let page = 0; page < 2; page++) {
        const query = new URLSearchParams({ q: `after:${after}`, labelIds: 'SENT', includeSpamTrash: 'true', maxResults: '25', ...(pageToken ? { pageToken } : {}) });
        const result = await this.request(draft.accountId, `messages?${query}`) as { messages?: { id?: unknown }[]; nextPageToken?: unknown };
        if (!result || (result.messages !== undefined && !Array.isArray(result.messages)) || (result.messages?.length ?? 0) > 25 || (result.nextPageToken !== undefined && (typeof result.nextPageToken !== 'string' || !result.nextPageToken))) return unresolved('invalid_candidate');
        for (const candidate of result.messages ?? []) {
          if (typeof candidate?.id !== 'string' || !candidate.id || candidate.id.length > 200) return unresolved('invalid_candidate'); if (seen.has(candidate.id)) continue; seen.add(candidate.id);
          const raw = await this.request(draft.accountId, this.deliveryMetadataPath(candidate.id)); scannedCandidates++;
          const metadata = this.inspectDeliveryMetadata(account, candidate.id, raw, draft.deliveryMarker);
          if (metadata.markerPresent && (!metadata.markerMatches || !metadata.identityValid)) return unresolved('invalid_candidate');
          if (metadata.markerMatches && metadata.identityValid) { matches.push({ id: candidate.id, internetMessageId: metadata.providerInternetMessageId }); if (matches.length > 1) return unresolved('multiple_marker_matches'); }
        }
        pageToken = result.nextPageToken as string | undefined;
        if (!pageToken) return matches.length === 1 ? { found: true, matches: 1, scanComplete: true, scannedCandidates, reason: 'verified', providerMessageId: matches[0].id, providerInternetMessageId: matches[0].internetMessageId } : unresolved('no_marker_match', true);
      }
      return unresolved('scan_limit_reached');
    } catch { return unresolved('provider_read_failed'); }
  }
  async attachment(accountId: string, messageId: string, attachmentId: string) {
    const cached = this.store.get<AttachmentRecord>('messageAttachment', attachmentRecordId(accountId, messageId, attachmentId));
    if (cached?.data !== undefined) return { data: cached.data, size: cached.attachment.size, name: cached.attachment.name };
    if (cached?.attachment.source === 'unavailable' || attachmentId.startsWith('embedded-')) throw new HttpError(404, 'Attachment bytes were not available in the captured message', 'attachment_not_available');
    const result = await this.request(accountId, `messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`) as { data: string; size: number };
    return { ...result, name: cached?.attachment.name };
  }
}
