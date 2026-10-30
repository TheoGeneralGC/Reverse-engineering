// Explicit synthetic evidence for legacy unit fixtures. This is never a native
// observation helper and is not imported by production code.
import type{Store}from'../src/store.ts';
import type{Thread}from'../src/types.ts';
import{AccountIncarnationAuthority,currentAccountIncarnation}from'../src/account-incarnation.ts';
import{GMAIL_SCOPE}from'../src/google-scopes.ts';
import{captureFullHeaderFacts}from'../src/reminder-message-projection.ts';
export function adoptSyntheticMailSource(store:Store,accountId:string){new AccountIncarnationAuthority(store).adoptAccount(accountId);store.put('googleGrant','mail:'+accountId,{...store.get<object>('googleGrant','mail:'+accountId),accountId,service:'mail',requestedScopes:[GMAIL_SCOPE],grantedScopes:[GMAIL_SCOPE],scopeSource:'response',outcome:'granted',updatedAt:'2026-10-29T00:00:00.000Z'});return currentAccountIncarnation(store,accountId)}
export function syntheticFullThread(store:Store,thread:Thread){const accountVersion=adoptSyntheticMailSource(store,thread.accountId);for(const message of thread.messages)message.reminderHeaderFacts=captureFullHeaderFacts({accountId:thread.accountId,accountVersion,providerThreadId:thread.providerId!},{id:message.id,payload:{headers:[{name:'From',value:message.sender.email},{name:'To',value:message.to.map(p=>p.email).join(', ')},{name:'Subject',value:thread.subject},...(message.internetMessageId?[{name:'Message-ID',value:message.internetMessageId}]:[])]}},message);return thread}
