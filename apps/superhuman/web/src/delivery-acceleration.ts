import { Temporal } from '@js-temporal/polyfill';
import { ApiError } from './api.ts';
import type { AiDraftRequest,AiDraftStorage } from './ai-draft.ts';
import type { DeliveryControlScope,DeliveryAccelerationRequest,DeliveryAccelerationReceipt } from '../../api/src/delivery-control-types.ts';
import type { AiDraftSendSnapshot } from '../../api/src/ai-draft-send-types.ts';
import type { DraftSendSnapshot } from '../../api/src/draft-send-types.ts';
export type DeliverySnapshot=AiDraftSendSnapshot|DraftSendSnapshot;
export type DeliveryOperation=NonNullable<DeliverySnapshot['operation']>;
export type AccelerationState={sending:boolean;checking:boolean;unknown:boolean;error:string;receipt:DeliveryAccelerationReceipt|null};
type Journal={version:1;identity:string;originalDeadline:string;request:DeliveryAccelerationRequest};
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const key=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
export const deliveryInstant=(v:unknown):v is string=>{if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(v))return false;try{Temporal.Instant.from(v);return true}catch{return false}};
type DeadlineOperation={revision:number;cancellableUntil:string;accelerationId?:string;acceleratedAt?:string;originalCancellableUntil?:string;mode?:'immediate'|'scheduled'};
/** An authoritative operation may shorten its original window once, with an acceleration receipt identity. */
export function validDeliveryDeadline(op:unknown,serverNow:string){
 if(!object(op)||!integer(op.revision)||!deliveryInstant(op.cancellableUntil)||!deliveryInstant(serverNow))return false;
 const fields=[op.accelerationId,op.acceleratedAt,op.originalCancellableUntil];if(fields.every(value=>value===undefined))return true;
 return op.mode!=='scheduled'&&id(op.accelerationId)&&deliveryInstant(op.acceleratedAt)&&deliveryInstant(op.originalCancellableUntil)&&deliveryInstant(op.cancellableUntil)&&deliveryInstant(serverNow)&&op.acceleratedAt===op.cancellableUntil&&Date.parse(op.cancellableUntil)<Date.parse(op.originalCancellableUntil)&&Date.parse(op.cancellableUntil)<=Date.parse(serverNow)&&op.revision>0;
}
export function validDeliveryDeadlineTransition(old:DeadlineOperation,next:DeadlineOperation,serverNow:string){
 if(!validDeliveryDeadline(next,serverNow))return false;
 if(old.accelerationId)return old.accelerationId===next.accelerationId&&old.acceleratedAt===next.acceleratedAt&&old.originalCancellableUntil===next.originalCancellableUntil&&old.cancellableUntil===next.cancellableUntil;
 if(next.accelerationId)return next.revision>old.revision&&next.originalCancellableUntil===old.cancellableUntil;
 return old.cancellableUntil===next.cancellableUntil;
}
export const deliveryOperationIdentity=(operation:DeliveryOperation)=>{const o=operation as DeliveryOperation&Record<string,unknown>;return JSON.stringify([o.id,o.accountId,o.draftId,o.generation,o.clientRequestId,o.payloadHash??null,o.contentHash??null,o.draftRevision??null,o.previewId??null,o.creationId??null,o.sessionId??null,o.turnId??null,o.mode??'immediate',o.scheduledAt??null])};
export function createDeliveryAcceleration(options:{scope:DeliveryControlScope;operation:DeliveryOperation;request:AiDraftRequest;storage:AiDraftStorage;uuid?:()=>string;isCurrent?:()=>boolean;canAccelerate?:()=>boolean}){
 const scope=structuredClone(options.scope),identity=deliveryOperationIdentity(options.operation),originalDeadline=options.operation.originalCancellableUntil??options.operation.cancellableUntil;
 if(!['artifact','composer'].includes(scope.source)||!id(scope.accountId)||!id(scope.operationId)||scope.operationId!==options.operation.id||scope.accountId!==options.operation.accountId||scope.source==='artifact'&&(!id(scope.sessionId)||!id(scope.turnId)||!('sessionId'in options.operation)||scope.sessionId!==options.operation.sessionId||scope.turnId!==options.operation.turnId))throw Error('Invalid queued delivery identity.');
 const storageKey='reconstruction.delivery-acceleration.v1:'+JSON.stringify([scope.source,scope.accountId,scope.operationId,scope.source==='artifact'?scope.sessionId:null,scope.source==='artifact'?scope.turnId:null]);
 let state:AccelerationState={sending:false,checking:false,unknown:false,error:'',receipt:null},journal:Journal|null=null,corrupt=false,active=false,disposed=false,revision=0;
 const listeners=new Set<()=>void>(),controllers=new Set<AbortController>(),emit=(patch:Partial<AccelerationState>)=>{state={...state,...patch};for(const listener of listeners)listener()};
 const usable=()=>active&&!disposed&&(options.isCurrent?.()??true),current=(token:number)=>usable()&&token===revision;
 const stored=():Journal|null=>{const raw=options.storage.getItem(storageKey);if(!raw)return null;if(raw.length>16384)throw Error('Invalid acceleration recovery');const v=JSON.parse(raw);if(!object(v)||v.version!==1||v.identity!==identity||v.originalDeadline!==originalDeadline||!object(v.request)||!key(v.request.clientRequestId)||!integer(v.request.expectedRevision)||JSON.stringify(Object.fromEntries(Object.entries(v.request).filter(([key])=>!['clientRequestId','expectedRevision'].includes(key))))!==JSON.stringify(scope))throw Error('Invalid acceleration recovery');return v as Journal};
 try{journal=stored();if(journal)state={...state,unknown:true}}catch{corrupt=true;state={...state,unknown:true,error:'An earlier Instant Send action could not be verified. No new action will be sent.'}}
 const read=async(path:string,body?:unknown)=>{const controller=new AbortController();controllers.add(controller);try{return await options.request(path,body,body===undefined?'GET':'POST',{signal:controller.signal})}finally{controllers.delete(controller)}};
 const clear=(pending:Journal)=>{if(journal?.request.clientRequestId!==pending.request.clientRequestId)return;const saved=stored();if(!saved||saved.request.clientRequestId===pending.request.clientRequestId)options.storage.removeItem(storageKey);journal=null;emit({unknown:false})};
 const checked=(value:unknown,pending:Journal)=>{
  if(!object(value)||value.source!==scope.source||!object(value.snapshot)||!object(value.snapshot.operation)||!object(value.acceleration))throw Error('Instant Send has not been confirmed.');
  const op=value.snapshot.operation as DeliveryOperation,r=value.acceleration;
  if(deliveryOperationIdentity(op)!==identity||!validDeliveryDeadline(op,value.snapshot.serverNow)||!id(r.id)||r.source!==scope.source||r.accountId!==scope.accountId||r.operationId!==scope.operationId||r.clientRequestId!==pending.request.clientRequestId||r.priorRevision!==pending.request.expectedRevision||r.originalDeadlineAt!==pending.originalDeadline||!deliveryInstant(r.createdAt)||r.createdAt!==r.effectiveDeadlineAt||r.effectiveDeadlineAt!==op.cancellableUntil||r.id!==op.accelerationId||r.createdAt!==op.acceleratedAt||r.originalDeadlineAt!==op.originalCancellableUntil||op.revision<=r.priorRevision||value.snapshot.canCancel!==false)throw Error('Instant Send receipt identity changed.');
  const receiptIdentity=(v:Record<string,any>)=>JSON.stringify([v.id,v.source,v.accountId,v.operationId,v.clientRequestId,v.priorRevision,v.createdAt,v.originalDeadlineAt,v.effectiveDeadlineAt]);
  if(state.receipt&&receiptIdentity(state.receipt)!==receiptIdentity(r))throw Error('The recorded Instant Send receipt changed.');
  return structuredClone(r) as DeliveryAccelerationReceipt;
 };
 const recover=async()=>{if(!usable()||state.sending||state.checking||corrupt||!journal)return null;const pending=journal,token=++revision;emit({checking:true,error:''});try{const value=await read('/delivery-accelerations/by-request/'+encodeURIComponent(pending.request.clientRequestId)+'?'+new URLSearchParams(scope));if(!current(token))return null;const receipt=checked(value,pending);clear(pending);emit({receipt});return receipt}catch(error){if(current(token))emit({unknown:true,error:error instanceof ApiError&&error.status===404?'The earlier Instant Send action is not visible yet. Check its status; do not repeat it.':error instanceof Error?error.message:'Instant Send status is unavailable.'});return null}finally{if(current(token))emit({checking:false})}};
 const accelerate=async(snapshot:DeliverySnapshot)=>{
  const op=snapshot.operation;if(!usable()||state.sending||state.checking||state.unknown||state.receipt||journal||corrupt||!(options.canAccelerate?.()??true)||!op||deliveryOperationIdentity(op)!==identity||!snapshot.canCancel||op.state!=='queued'||op.deliveryAttemptId||op.accelerationId||'mode'in op&&op.mode==='scheduled'||!deliveryInstant(snapshot.serverNow)||!deliveryInstant(op.cancellableUntil)||Date.parse(snapshot.serverNow)>=Date.parse(op.cancellableUntil))return null;
  const request:DeliveryAccelerationRequest={...scope,clientRequestId:(options.uuid??(()=>crypto.randomUUID()))(),expectedRevision:op.revision},pending:Journal={version:1,identity,originalDeadline,request};
  try{const saved=stored();if(saved){journal=saved;emit({unknown:true,error:'Check the earlier Instant Send action before continuing.'});return null}if(!key(request.clientRequestId))throw Error('Invalid action key');options.storage.setItem(storageKey,JSON.stringify(pending));if(JSON.stringify(stored())!==JSON.stringify(pending))throw Error('Action was not persisted');journal=pending}catch{emit({error:'Persistent browser storage is unavailable. No Instant Send action was sent.'});return null}
  const token=++revision;emit({sending:true,error:''});try{const value=await read('/delivery-accelerations',request);if(!current(token))return null;const receipt=checked(value,pending);clear(pending);emit({receipt});return receipt}catch(error){if(current(token)){const definite=error instanceof ApiError&&['delivery_control_invalid_request','ai_chat_invalid_request','invalid_recipients','delivery_control_not_found','ai_draft_send_not_found','draft_send_not_found','delivery_control_conflict','ai_draft_send_conflict','draft_send_conflict','demo_delivery_disabled','draft_send_attachment_unavailable','reconnect_required','insufficient_google_scope','sender_not_approved','recipient_not_approved','provider_not_configured'].includes(error.code||'');if(definite)try{clear(pending)}catch{}emit({unknown:!!journal,error:error instanceof Error?error.message:'Instant Send acknowledgement is unavailable. Check its status before continuing.'})}return null}finally{if(current(token))emit({sending:false})}
 };
 return{getSnapshot:()=>state,subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>listeners.delete(listener)},accelerate,recover,resume(){if(disposed)return;active=true;if(journal)void recover()},suspend(){active=false;revision++;for(const controller of controllers)controller.abort();controllers.clear();state={...state,sending:false,checking:false,unknown:!!journal||state.unknown}},dispose(){active=false;disposed=true;revision++;for(const controller of controllers)controller.abort();controllers.clear();listeners.clear()}};
}
