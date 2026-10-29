import type { GoogleProvider } from './google.ts';
import { HttpError, type Account } from './types.ts';
export type GmailDraftResource = { id: string; message: { id: string; threadId: string; labelIds?: string[]; raw?: string } };
export type GmailDraftListing = { drafts: { id: string; message: { id: string; threadId?: string } }[]; nextPageToken?: string };
export type GmailDraftMetadata = { id: string; labelIds: string[]; payload: { headers: { name: string; value: string }[] } };
export type ProviderDraftTransport = {
  ready(account: Account): void;
  profile(account: Account, signal: AbortSignal): Promise<string>;
  create(account: Account, message: { raw: string; threadId?: string }, signal: AbortSignal): Promise<GmailDraftResource>;
  update(account: Account, id: string, message: { raw: string; threadId?: string }, signal: AbortSignal): Promise<GmailDraftResource>;
  get(account: Account, id: string, raw: boolean, signal: AbortSignal): Promise<GmailDraftResource | undefined>;
  list(account: Account, pageToken: string | undefined, signal: AbortSignal): Promise<GmailDraftListing>;
  metadata(account: Account, messageId: string, signal: AbortSignal): Promise<GmailDraftMetadata>;
  delete(account: Account, id: string, signal: AbortSignal): Promise<void>;
};
export const providerDraftProviderId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
export function validGmailDraft(value: unknown, requireRaw = false): value is GmailDraftResource {
  const draft = value as GmailDraftResource | null;
  return !!draft && providerDraftProviderId(draft.id) && !!draft.message && providerDraftProviderId(draft.message.id) && providerDraftProviderId(draft.message.threadId) && (draft.message.labelIds === undefined || Array.isArray(draft.message.labelIds) && draft.message.labelIds.every(value => typeof value === 'string') && draft.message.labelIds.includes('DRAFT')) && (!requireRaw || typeof draft.message.raw === 'string' && draft.message.raw.length > 0 && /^[A-Za-z0-9_-]+={0,2}$/.test(draft.message.raw));
}
export function googleDraftTransport(google: GoogleProvider): ProviderDraftTransport {
  const request = (account: Account, path: string, init: RequestInit = {}) => google.request(account.id,path,init);
  return {
    ready(account) {
      if (account.provider !== 'google') throw new HttpError(409,'Demo drafts do not synchronize with Gmail','provider_draft_unmanaged');
      if (!google.status().configured) throw new HttpError(503,'Configure Google before cloud draft autosave','provider_draft_not_configured');
      if (!google.grant(account.id,'mail')?.grantedScopes.some(scope=>['https://www.googleapis.com/auth/gmail.modify','https://www.googleapis.com/auth/gmail.compose','https://mail.google.com/'].includes(scope))) throw new HttpError(403,'Reconnect Gmail with a recorded draft-write grant','provider_draft_scope_required');
    },
    async profile(account,signal) { const value=await request(account,'profile',{signal}) as {emailAddress?:unknown};if(!value||typeof value.emailAddress!=='string')throw new HttpError(502,'Gmail identity could not be verified','provider_draft_identity_unverified');return value.emailAddress; },
    async create(account,message,signal) { return await request(account,'drafts',{method:'POST',body:JSON.stringify({message}),signal}) as GmailDraftResource; },
    async update(account,id,message,signal) { return await request(account,'drafts/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({id,message}),signal}) as GmailDraftResource; },
    async get(account,id,raw,signal) { try {return await request(account,'drafts/'+encodeURIComponent(id)+'?format='+(raw?'raw':'minimal'),{signal}) as GmailDraftResource;}catch(error){if(error instanceof HttpError&&error.code==='google_not_found')return;throw error;} },
    async list(account,pageToken,signal) { const params=new URLSearchParams({maxResults:'25'});if(pageToken)params.set('pageToken',pageToken);return await request(account,'drafts?'+params,{signal}) as GmailDraftListing; },
    async metadata(account,messageId,signal) { const params=new URLSearchParams({format:'metadata'});for(const name of ['From','X-Reconstruction-Draft-Owner','X-Reconstruction-Draft-Operation','X-Reconstruction-Draft-Revision','X-Reconstruction-Draft-Content-SHA256'])params.append('metadataHeaders',name);return await request(account,'messages/'+encodeURIComponent(messageId)+'?'+params,{signal}) as GmailDraftMetadata; },
    async delete(account,id,signal) { await request(account,'drafts/'+encodeURIComponent(id),{method:'DELETE',signal}); },
  };
}
