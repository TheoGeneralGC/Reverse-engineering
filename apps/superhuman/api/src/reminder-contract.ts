// Canonical browser-safe reminder foundation contract. Pure parsers; no IO.
// Schedule is local intent only; native wake/return and Follow-ups remain unavailable.
import type {Ref,Hash,Iso} from './auto-drafts-generation-contract.ts';
export type {Ref,Hash,Iso};
export const REMINDER_POLICY='durable-thread-reminder-v1' as const;
export const REMINDER_REQUEST_PROTOCOL='reminder-action-v1' as const;
export const ROUTES={
 view:{method:'GET',path:'/api/threads/:threadId/reminder',query:['accountId'],response:'ReminderView'},
 action:{method:'POST',path:'/api/reminder-actions',query:[],request:'ReminderRequest',response:'ReminderActionResponse'},
 recovery:{method:'GET',path:'/api/reminder-actions/by-request/:key',query:['accountId','accountVersion'],response:'ReminderActionResponse'},
} as const;
// All numbers safe nonnegative integers; reminder refs/keys UUIDv4; hashes hex64;
// ISO values canonical UTC. Existing authorized account/thread/message IDs keep
// their bounded Mail grammar. Provider IDs, aliases, body and credentials stay private.
// Wire 'always' is displayed as the observed label 'regardless'.
export type ReminderCondition='if-no-reply'|'always';
export const SPECIAL_TIMES={someday:'2096-10-02T07:06:40.000Z',never:'2128-06-11T08:53:20.000Z'} as const;
export type ReminderTriggerKind='at'|'someday'|'never';
export type ReminderReason='account-unavailable'|'account-changed'|'thread-unavailable'|'source-incomplete'|'identity-unavailable'|'provider-unavailable'|'external-reply-observed'|'newer-reminder'|'explicit-cancel'|'legacy-action'|'thread-deleted'|'worker-closed'|'clock-unavailable';
export type ReminderAnchor={ref:Ref;version:Hash;sourceMessageId:string};
export type WakeView={attemptRef:Ref;outcome:'not-issued'|'issued-unconfirmed'|'provider-inbox-observed'};
export type ReturnedSummary={ref:Ref;ordinal:number;returnedAt:Iso;proof:'provider-inbox-observed'|'provider-insert-observed'|'demo-local';occurrenceHash:Hash};
type ReminderBase={ref:Ref;generation:number;createdAt:Iso;triggerAt:Iso;triggerKind:ReminderTriggerKind;condition:ReminderCondition;origin:'manual-keyed'|'undo-keyed';anchor:ReminderAnchor};
export type ReminderInstance=ReminderBase & (
 {phase:'scheduled';reason:null;wake:null;returned:null;endedAt:null}|
 {phase:'blocked';reason:ReminderReason;wake:WakeView|null;returned:null;endedAt:null}|
 {phase:'waking';reason:null;wake:WakeView;returned:null;endedAt:null}|
 {phase:'wake-unknown';reason:'provider-unavailable';wake:WakeView;returned:null;endedAt:null}|
 {phase:'returned';reason:null;wake:WakeView;returned:ReturnedSummary;endedAt:Iso}|
 {phase:'cancelled'|'superseded'|'suppressed';reason:ReminderReason;wake:WakeView|null;returned:null;endedAt:Iso}
);
export type ReminderSnapshot={version:1;policy:typeof REMINDER_POLICY;accountId:string;threadId:string;accountVersion:Hash;revision:number;generation:number;persisted:boolean;current:ReminderInstance|null};
// Context is computed from independently committed facts; GET allocates no ref.
// anchorVersion covers source/provider tuple and the complete captured message
// set, excludes harmless read/star/sync metadata, and is not supplied by a model.
export type ReminderContext=
 {availability:'available';version:Hash;sourceMessageId:string;anchorVersion:Hash;conditionalReady:boolean}|
 {availability:'unavailable';version:null;sourceMessageId:null;anchorVersion:null;conditionalReady:false;reason:ReminderReason};
export type ReminderView={snapshot:ReminderSnapshot;context:ReminderContext;legacy:{triggerAt:Iso}|null;serverNow:Iso;capabilities:{schedule:boolean;conditional:boolean;draftReminder:false;returnedOccurrences:boolean;followUpGeneration:false}};
type RequestBase={accountId:string;threadId:string;accountVersion:Hash;clientRequestId:Ref;expectedRevision:number;expectedReminderRef:Ref|null};
export type ReminderRequest=RequestBase & (
 {action:'schedule';expectedContextVersion:Hash;expectedAnchorVersion:Hash;triggerAt:Iso;triggerKind:ReminderTriggerKind;condition:ReminderCondition}|
 {action:'cancel'}|
 {action:'undo';undoToken:Ref}|
 {action:'check-return';expectedReminderRef:Ref;expectedWakeAttemptRef:Ref}
);
export type ReminderReceipt={id:Ref;accountId:string;threadId:string;accountVersion:Hash;clientRequestId:Ref;protocol:typeof REMINDER_REQUEST_PROTOCOL;request:ReminderRequest;requestFingerprint:Hash;priorRevision:number;acceptedRevision:number;changed:boolean;acceptedAt:Iso;snapshotFingerprint:Hash;undo:{token:Ref;expiresAt:Iso}|null};
export type ReminderCheckResult={finishedAt:Iso;outcome:'returned'|'still-unknown'|'superseded'|'unavailable';publishedRevision:number|null;returnedRef:Ref|null};
// Schedule/cancel/undo are completed local acceptance. Only check-return can be
// accepted with pending read-only provider work, then gain one immutable result.
export type ReminderActionResponse={receipt:ReminderReceipt;acceptedSnapshot:ReminderSnapshot;historical:boolean} & (
 {state:'completed';result:{kind:'intent-accepted'}}|
 {state:'accepted';result:null}|
 {state:'completed';result:{kind:'return-check';value:ReminderCheckResult}}
);
export type ReminderErrorCode='reminder_unavailable'|'reminder_invalid_request'|'reminder_not_found'|'reminder_account_changed'|'reminder_revision_conflict'|'reminder_request_conflict'|'reminder_source_changed'|'reminder_source_unavailable'|'reminder_undo_expired'|'reminder_undo_conflict'|'reminder_not_checkable'|'reminder_corrupt'|'reminder_stopping';
export type ReminderError={error:{code:ReminderErrorCode;message:string}};

// SERVER-ONLY producer contract. Never place these objects in a browser response.
// No competing FrozenInput/ModelDecision type; a future H7 successor must accept
// a reminder source explicitly, never relabel it google-live-history-message-added.
export type PrivateAnchor={ref:Ref;version:Hash;accountId:string;accountVersion:Hash;threadId:string;providerThreadId:string;sourceMessageId:string;sourceProviderMessageId:string;capturedMessageIds:readonly string[];messageSetHash:Hash;sourceFactsHash:Hash;baselineVersion:Hash;identityVersion:Hash|null;capturedAt:Iso};
export type ReplyAssessment={kind:'clear'|'external-observed'|'indeterminate';factsHash:Hash;observedAt:Iso};
export type WakeLease={attemptRef:Ref;ownerEpoch:Ref;leaseId:Ref;leaseUntil:Iso;accountId:string;accountVersion:Hash;grantEpoch:number;threadId:string;reminderRef:Ref;generation:number;slotRevision:number;anchorVersion:Hash};
export type ProviderReturnProof={version:1;kind:'already-inbox-observed'|'modify-and-observed'|'observed-after-unknown'|'insert-and-observed';accountId:string;accountVersion:Hash;reminderRef:Ref;generation:number;attemptRef:Ref;providerThreadId:string;readLeaseRef:Ref;readStartedAt:Iso;observedAt:Iso;writeIssuedAt:Iso|null;completeThread:true;inboxPresent:true;observationHash:Hash;reply:ReplyAssessment};
export type ReturnedOccurrence={version:1;id:Ref;accountId:string;accountVersion:Hash;ordinal:number;reminderRef:Ref;generation:number;threadId:string;anchorRef:Ref;anchorVersion:Hash;triggerAt:Iso;returnedAt:Iso;origin:'manual-keyed'|'undo-keyed';proofKind:ProviderReturnProof['kind']|'demo-local';wakeAttemptRef:Ref;observationHash:Hash;occurrenceHash:Hash};
export type ReturnedOutbox={occurrenceRef:Ref;occurrenceHash:Hash;accountId:string;accountVersion:Hash;state:'pending'|'consumed'|'suppressed';consumerVersion:string|null;dispositionRef:Ref|null};

import {stable} from './auto-drafts-contract.ts';
export {stable};
export type ReminderDigest=(utf8:string)=>Promise<string>;
export class ReminderSchemaError extends Error{constructor(){super('Reminder payload could not be verified')}}
const fail=():never=>{throw new ReminderSchemaError()};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const own=(v:unknown,k:string[])=>obj(v)&&Object.keys(v).sort().join(',')===[...k].sort().join(',')?v:fail();
const copy=<T>(v:T):T=>{try{return structuredClone(v)}catch{return fail()}};
const identity=(v:unknown)=>typeof v==='string'&&v.length>0&&new TextEncoder().encode(v).length<=1024&&!/[\s\p{Cc}\p{Cf}\p{Surrogate}]/u.test(v)?v:fail();
const ref=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v)?v:fail();
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:fail();
const number=(v:unknown,min=0)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min?v:fail();
const bool=(v:unknown)=>typeof v==='boolean'?v:fail();
const iso=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v?v:fail();
const choice=<T extends string>(v:unknown,values:readonly T[]):T=>typeof v==='string'&&values.includes(v as T)?v as T:fail();
const nullableRef=(v:unknown)=>v===null?null:ref(v);
const same=(a:unknown,b:unknown)=>stable(a)===stable(b);
const reasons:ReminderReason[]=['account-unavailable','account-changed','thread-unavailable','source-incomplete','identity-unavailable','provider-unavailable','external-reply-observed','newer-reminder','explicit-cancel','legacy-action','thread-deleted','worker-closed','clock-unavailable'];
export function parseTrigger(v:unknown,kind:unknown):{triggerAt:Iso;triggerKind:ReminderTriggerKind}{const triggerAt=iso(v),triggerKind=choice(kind,['at','someday','never']);if(triggerKind==='at'?Object.values(SPECIAL_TIMES).includes(triggerAt as typeof SPECIAL_TIMES.someday):triggerAt!==SPECIAL_TIMES[triggerKind])return fail();return{triggerAt,triggerKind}}
export function parseReminderRequest(value:unknown):ReminderRequest{
 const v=copy(value);if(!obj(v))return fail();const common=['accountId','threadId','accountVersion','clientRequestId','expectedRevision','expectedReminderRef'],action=choice(v.action,['schedule','cancel','undo','check-return']);
 const fields=action==='schedule'?['expectedContextVersion','expectedAnchorVersion','triggerAt','triggerKind','condition']:action==='undo'?['undoToken']:action==='check-return'?['expectedWakeAttemptRef']:[];const o=own(v,[...common,'action',...fields]);
 const base={accountId:identity(o.accountId),threadId:identity(o.threadId),accountVersion:hash(o.accountVersion),clientRequestId:ref(o.clientRequestId),expectedRevision:number(o.expectedRevision),expectedReminderRef:nullableRef(o.expectedReminderRef)};
 if(action==='schedule')return{...base,action,expectedContextVersion:hash(o.expectedContextVersion),expectedAnchorVersion:hash(o.expectedAnchorVersion),...parseTrigger(o.triggerAt,o.triggerKind),condition:choice(o.condition,['if-no-reply','always'])};
 if(action==='cancel')return{...base,action};if(action==='undo')return{...base,action,undoToken:ref(o.undoToken)};
 return{...base,expectedReminderRef:ref(o.expectedReminderRef),action,expectedWakeAttemptRef:ref(o.expectedWakeAttemptRef)};
}
export function reminderIntentText(value:ReminderRequest):string{const r=parseReminderRequest(value),{clientRequestId:_key,...request}=r;return stable({protocol:REMINDER_REQUEST_PROTOCOL,request})}
function instance(value:unknown):ReminderInstance{
 if(!obj(value))return fail();const o=own(value,['ref','generation','createdAt','triggerAt','triggerKind','condition','origin','anchor','phase','reason','wake','returned','endedAt']),a=own(o.anchor,['ref','version','sourceMessageId']),base={ref:ref(o.ref),generation:number(o.generation,1),createdAt:iso(o.createdAt),...parseTrigger(o.triggerAt,o.triggerKind),condition:choice(o.condition,['if-no-reply','always']),origin:choice(o.origin,['manual-keyed','undo-keyed']),anchor:{ref:ref(a.ref),version:hash(a.version),sourceMessageId:identity(a.sourceMessageId)}};
 const phase=choice(o.phase,['scheduled','blocked','waking','wake-unknown','returned','cancelled','superseded','suppressed']),reason=o.reason===null?null:choice(o.reason,reasons),endedAt=o.endedAt===null?null:iso(o.endedAt);let wake:WakeView|null=null;if(o.wake!==null){const w=own(o.wake,['attemptRef','outcome']);wake={attemptRef:ref(w.attemptRef),outcome:choice(w.outcome,['not-issued','issued-unconfirmed','provider-inbox-observed'])}}
 let returned:ReturnedSummary|null=null;if(o.returned!==null){const r=own(o.returned,['ref','ordinal','returnedAt','proof','occurrenceHash']);returned={ref:ref(r.ref),ordinal:number(r.ordinal,1),returnedAt:iso(r.returnedAt),proof:choice(r.proof,['provider-inbox-observed','provider-insert-observed','demo-local']),occurrenceHash:hash(r.occurrenceHash)}}
 if(endedAt!==null&&Date.parse(endedAt)<Date.parse(base.createdAt))return fail();
 if(phase==='scheduled'){if(reason!==null||wake!==null||returned!==null||endedAt!==null)return fail();return{...base,phase,reason:null,wake:null,returned:null,endedAt:null}}
 if(phase==='blocked'){if(reason===null||returned!==null||endedAt!==null)return fail();return{...base,phase,reason,wake,returned:null,endedAt:null}}
 if(phase==='waking'){if(reason!==null||!wake||returned!==null||endedAt!==null)return fail();return{...base,phase,reason:null,wake,returned:null,endedAt:null}}
 if(phase==='wake-unknown'){if(reason!=='provider-unavailable'||!wake||wake.outcome!=='issued-unconfirmed'||returned!==null||endedAt!==null)return fail();return{...base,phase,reason,wake,returned:null,endedAt:null}}
 if(phase==='returned'){if(reason!==null||!wake||wake.outcome!=='provider-inbox-observed'||!returned||endedAt!==returned.returnedAt||Date.parse(endedAt)<Date.parse(base.triggerAt))return fail();return{...base,phase,reason:null,wake,returned,endedAt}}
 if(reason===null||returned!==null||endedAt===null)return fail();return{...base,phase,reason,wake,returned:null,endedAt};
}
export function parseReminderSnapshot(value:unknown,expected?:{accountId:string;threadId:string;accountVersion:string}):ReminderSnapshot{
 const o=own(copy(value),['version','policy','accountId','threadId','accountVersion','revision','generation','persisted','current']);if(o.version!==1||o.policy!==REMINDER_POLICY)return fail();const s:ReminderSnapshot={version:1,policy:REMINDER_POLICY,accountId:identity(o.accountId),threadId:identity(o.threadId),accountVersion:hash(o.accountVersion),revision:number(o.revision),generation:number(o.generation),persisted:bool(o.persisted),current:o.current===null?null:instance(o.current)};
 if(expected&&(s.accountId!==expected.accountId||s.threadId!==expected.threadId||s.accountVersion!==expected.accountVersion))return fail();if(s.persisted?(s.revision<1||s.generation<1||!s.current||s.current.generation!==s.generation):s.revision!==0||s.generation!==0||s.current!==null)return fail();return s;
}
export function parseReminderView(value:unknown,expected:{accountId:string;threadId:string}):ReminderView{
 const o=own(copy(value),['snapshot','context','legacy','serverNow','capabilities']),snapshot=parseReminderSnapshot(o.snapshot);if(snapshot.accountId!==expected.accountId||snapshot.threadId!==expected.threadId)return fail();let context:ReminderContext;
 if(obj(o.context)&&o.context.availability==='available'){const c=own(o.context,['availability','version','sourceMessageId','anchorVersion','conditionalReady']);context={availability:'available',version:hash(c.version),sourceMessageId:identity(c.sourceMessageId),anchorVersion:hash(c.anchorVersion),conditionalReady:bool(c.conditionalReady)}}else{const c=own(o.context,['availability','version','sourceMessageId','anchorVersion','conditionalReady','reason']);if(c.availability!=='unavailable'||c.version!==null||c.sourceMessageId!==null||c.anchorVersion!==null||c.conditionalReady!==false)return fail();context={availability:'unavailable',version:null,sourceMessageId:null,anchorVersion:null,conditionalReady:false,reason:choice(c.reason,reasons)}}
 const c=own(o.capabilities,['schedule','conditional','draftReminder','returnedOccurrences','followUpGeneration']);if(c.draftReminder!==false||c.followUpGeneration!==false)return fail();const capabilities={schedule:bool(c.schedule),conditional:bool(c.conditional),draftReminder:false as const,returnedOccurrences:bool(c.returnedOccurrences),followUpGeneration:false as const};if(capabilities.conditional&&!capabilities.schedule||capabilities.schedule&&context.availability!=='available'||capabilities.conditional&&!context.conditionalReady)return fail();let legacy:null|{triggerAt:Iso}=null;if(o.legacy!==null){const l=own(o.legacy,['triggerAt']);legacy={triggerAt:iso(l.triggerAt)}}return{snapshot,context,legacy,serverNow:iso(o.serverNow),capabilities};
}
export async function parseReminderResponse(value:unknown,expected:{request:ReminderRequest;prior:ReminderSnapshot;undo?:{receipt:ReminderReceipt;prior:ReminderSnapshot}},digest:ReminderDigest):Promise<ReminderActionResponse>{
 const captured=copy(value),want=copy(expected),request=parseReminderRequest(want.request),prior=parseReminderSnapshot(want.prior,{accountId:request.accountId,threadId:request.threadId,accountVersion:request.accountVersion}),o=own(captured,['receipt','acceptedSnapshot','historical','state','result']),r=own(o.receipt,['id','accountId','threadId','accountVersion','clientRequestId','protocol','request','requestFingerprint','priorRevision','acceptedRevision','changed','acceptedAt','snapshotFingerprint','undo']);
 const acceptedSnapshot=parseReminderSnapshot(o.acceptedSnapshot,{accountId:request.accountId,threadId:request.threadId,accountVersion:request.accountVersion});if(r.protocol!==REMINDER_REQUEST_PROTOCOL||!same(parseReminderRequest(r.request),request)||r.accountId!==request.accountId||r.threadId!==request.threadId||r.accountVersion!==request.accountVersion||r.clientRequestId!==request.clientRequestId)return fail();
 const changed=bool(r.changed),priorRevision=number(r.priorRevision),acceptedRevision=number(r.acceptedRevision),acceptedAt=iso(r.acceptedAt);if(priorRevision!==prior.revision||priorRevision!==request.expectedRevision||prior.current?.ref!==request.expectedReminderRef&&!(prior.current===null&&request.expectedReminderRef===null)||acceptedRevision!==priorRevision+(changed?1:0)||acceptedSnapshot.revision!==acceptedRevision)return fail();
 const expectedRequestHash=hash(await digest(reminderIntentText(request))),expectedSnapshotHash=hash(await digest(stable(acceptedSnapshot)));if(hash(r.requestFingerprint)!==expectedRequestHash||hash(r.snapshotFingerprint)!==expectedSnapshotHash)return fail();
 let undo:ReminderReceipt['undo']=null;if(r.undo!==null){const u=own(r.undo,['token','expiresAt']);undo={token:ref(u.token),expiresAt:iso(u.expiresAt)};if(Date.parse(undo.expiresAt)!==Date.parse(acceptedAt)+300000)return fail()}
 const receipt:ReminderReceipt={id:ref(r.id),accountId:request.accountId,threadId:request.threadId,accountVersion:request.accountVersion,clientRequestId:request.clientRequestId,protocol:REMINDER_REQUEST_PROTOCOL,request,requestFingerprint:expectedRequestHash,priorRevision,acceptedRevision,changed,acceptedAt,snapshotFingerprint:expectedSnapshotHash,undo};const historical=bool(o.historical);
 if(request.action!=='check-return'){
  if(o.state!=='completed'||!changed||!undo||!same(o.result,{kind:'intent-accepted'})||acceptedSnapshot.generation<prior.generation||!acceptedSnapshot.current)return fail();const current=acceptedSnapshot.current;
  if(current.createdAt>acceptedAt||request.action==='schedule'&&(current.phase!=='scheduled'||current.ref===prior.current?.ref||current.generation!==prior.generation+1||current.origin!=='manual-keyed'||current.createdAt!==acceptedAt||current.anchor.version!==request.expectedAnchorVersion||current.condition!==request.condition||current.triggerAt!==request.triggerAt||current.triggerKind!==request.triggerKind)||request.action==='cancel'&&(current.ref!==prior.current?.ref||current.phase!=='cancelled'||current.generation!==prior.generation||!same(current,{...prior.current,phase:'cancelled',reason:'explicit-cancel',returned:null,endedAt:acceptedAt})))return fail();if(request.action==='undo'){if(!want.undo)return fail();const u=want.undo.receipt,before=parseReminderSnapshot(want.undo.prior,{accountId:request.accountId,threadId:request.threadId,accountVersion:request.accountVersion});if(u.undo?.token!==request.undoToken||u.accountId!==request.accountId||u.threadId!==request.threadId||u.accountVersion!==request.accountVersion||u.acceptedRevision!==prior.revision)return fail();const restore=before.current&&['scheduled','blocked','waking','wake-unknown'].includes(before.current.phase)?before.current:null;if(restore){if(current.phase!=='scheduled'||current.origin!=='undo-keyed'||current.createdAt!==acceptedAt||current.ref===restore.ref||current.ref===prior.current?.ref||current.generation!==prior.generation+1||current.triggerAt!==restore.triggerAt||current.triggerKind!==restore.triggerKind||current.condition!==restore.condition||!same(current.anchor,restore.anchor))return fail()}else if(!same(current,{...prior.current,phase:'cancelled',reason:'explicit-cancel',returned:null,endedAt:acceptedAt}))return fail();}return{receipt,acceptedSnapshot,historical,state:'completed',result:{kind:'intent-accepted'}};
 }
 if(changed||undo!==null||!same(acceptedSnapshot,prior))return fail();if(o.state==='accepted'){if(o.result!==null)return fail();return{receipt,acceptedSnapshot,historical,state:'accepted',result:null}}
 const result=own(o.result,['kind','value']),v=own(result.value,['finishedAt','outcome','publishedRevision','returnedRef']);if(o.state!=='completed'||result.kind!=='return-check')return fail();const finishedAt=iso(v.finishedAt),outcome=choice(v.outcome,['returned','still-unknown','superseded','unavailable']),publishedRevision=v.publishedRevision===null?null:number(v.publishedRevision,1),returnedRef=nullableRef(v.returnedRef);if(Date.parse(finishedAt)<Date.parse(acceptedAt)||(outcome==='returned'?(publishedRevision===null||returnedRef===null):(publishedRevision!==null||returnedRef!==null)))return fail();return{receipt,acceptedSnapshot,historical,state:'completed',result:{kind:'return-check',value:{finishedAt,outcome,publishedRevision,returnedRef}}};
}

export function parseReminderError(value:unknown):ReminderError{
 const o=own(copy(value),['error']),e=own(o.error,['code','message']);
 const code=choice(e.code,['reminder_unavailable','reminder_invalid_request','reminder_not_found','reminder_account_changed','reminder_revision_conflict','reminder_request_conflict','reminder_source_changed','reminder_source_unavailable','reminder_undo_expired','reminder_undo_conflict','reminder_not_checkable','reminder_corrupt','reminder_stopping']);
 if(typeof e.message!=='string'||e.message.length===0||new TextEncoder().encode(e.message).length>4096)return fail();
 return{error:{code,message:e.message}};
}
