import {projectStoredMessages} from './reminder-message-projection.ts';
import type {Message,Thread} from './types.ts';
import{createHash}from'node:crypto';import{Store}from'./store.ts';import{validOutgoingRecipientEmail}from'./outgoing-recipients.ts';import{stable}from'./auto-drafts-contract.ts';
export type CorrespondenceScope={accountId:string;accountVersion:string;accountEpoch:number;ingressEpoch:number;identityVersion:string;eligibleFrom:string[]};
export type SentRelationship={accountId:string;accountVersion:string;accountEpoch:number;ingressEpoch:number;identityVersion:string;version:string;observedAt:string;coverage:'partial-local-cache';source:'verified-sent-recipient-role';threadId:string;messageId:string;messagePosition:number;sender:string;recipient:string;sentAt:string};
export type CorrespondenceResult={availability:'positive';relationship:SentRelationship}|{availability:'unavailable';reason:'no-positive-evidence'|'evidence-changed'|'bounded-cache-limit'};
export type CorrespondenceResolver=(scope:CorrespondenceScope,recipient:string,before:string,expected?:SentRelationship)=>CorrespondenceResult;
const hash=(v:unknown)=>createHash('sha256').update(stable(v)).digest('hex');
/** A bounded positive-only local metadata projection. It never interprets a
 * partial cache miss as proof that this account never emailed the recipient.
 * A production provider can inject the same server-only resolver contract.
 * No message body, participant union, contacts, foreign account or guessed
 * dot/plus alias is used as prior-outbound authority. */
export function localSentCorrespondence(store:Store,now:()=>number):CorrespondenceResolver{
 return(scope,recipient,before,expected)=>{
  if(!validOutgoingRecipientEmail(recipient)||!Number.isFinite(Date.parse(before)))return{availability:'unavailable',reason:'no-positive-evidence'};
  const rows=store.db.prepare(`SELECT t.id AS thread_id,json_extract(t.data,'$.id') AS embedded_thread_id,json_extract(t.data,'$.accountId') AS account_id,m.key AS position,m.value AS message_json,json_extract(t.data,'$.providerId') AS provider_thread_id,json_extract(m.value,'$.id') AS message_id,json_extract(m.value,'$.sender.email') AS sender,json_extract(m.value,'$.date') AS sent_at,
    json_extract(m.value,'$.to') AS to_json,json_extract(m.value,'$.cc') AS cc_json
   FROM records t,json_each(t.data,'$.messages') m
   WHERE t.kind='thread' AND json_extract(t.data,'$.accountId')=?
    AND EXISTS(SELECT 1 FROM json_each(m.value,'$.providerLabels') l WHERE l.value='SENT')
    AND (EXISTS(SELECT 1 FROM json_each(m.value,'$.to') p WHERE lower(json_extract(p.value,'$.email'))=?) OR EXISTS(SELECT 1 FROM json_each(m.value,'$.cc') p WHERE lower(json_extract(p.value,'$.email'))=?))
    AND (? IS NULL OR (t.id=? AND m.key=?))
   ORDER BY t.id,m.key LIMIT 1001`).all(scope.accountId,recipient.toLowerCase(),recipient.toLowerCase(),expected?.threadId??null,expected?.threadId??null,expected?.messagePosition??null);
  if(rows.length>1000)return{availability:'unavailable',reason:'bounded-cache-limit'};
  for(const row of rows){if(row.thread_id!==row.embedded_thread_id||row.account_id!==scope.accountId||typeof row.message_id!=='string'||typeof row.sender!=='string'||!validOutgoingRecipientEmail(row.sender)||!scope.eligibleFrom.includes(row.sender.toLowerCase())||typeof row.sent_at!=='string'||!Number.isFinite(Date.parse(row.sent_at))||Date.parse(row.sent_at)>=Date.parse(before))continue;
   // A SENT role does not turn incomplete legacy headers or a system carrier
   // into positive relationship authority. This is a read-only, bounded probe
   // of this exact candidate under the shared current account incarnation.
   let message:Message;try{message=JSON.parse(String(row.message_json))}catch{continue}if(typeof row.provider_thread_id!=='string')continue;const candidate:Thread={id:String(row.thread_id),accountId:scope.accountId,providerId:row.provider_thread_id,subject:'',snippet:'',sender:message.sender,participants:[],lastMessageAt:message.date,unread:false,starred:false,important:false,folder:'sent',labels:[],messages:[message]},projection=projectStoredMessages(store,candidate),hint=projection.hints.get(message.id);if(projection.scope?.accountVersion!==scope.accountVersion||hint?.coverage!=='full'||hint.kind!=='ordinary')continue;
   const basis={accountId:scope.accountId,accountVersion:scope.accountVersion,accountEpoch:scope.accountEpoch,ingressEpoch:scope.ingressEpoch,identityVersion:scope.identityVersion,coverage:'partial-local-cache' as const,source:'verified-sent-recipient-role' as const,threadId:String(row.thread_id),messageId:row.message_id,messagePosition:Number(row.position),sender:row.sender.toLowerCase(),recipient:recipient.toLowerCase(),sentAt:new Date(row.sent_at).toISOString()},version=hash(basis),stamp=now();if(!Number.isSafeInteger(stamp)||stamp<0)throw Error('Correspondence clock unavailable');
   if(expected&&expected.version!==version)continue;return{availability:'positive',relationship:{...basis,version,observedAt:new Date(stamp).toISOString()}};
  }
  return{availability:'unavailable',reason:expected?'evidence-changed':'no-positive-evidence'};
 };
}
