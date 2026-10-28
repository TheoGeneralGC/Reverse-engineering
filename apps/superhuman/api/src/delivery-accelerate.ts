import { randomUUID } from 'node:crypto';
import type { Store } from './store.ts';
import type { AiDraftSendService } from './ai-draft-send.ts';
import type { DraftSendService } from './draft-send.ts';
import { HttpError } from './types.ts';
import { strictObject, identifier, hash } from './ai-chat-store.ts';
import { deliveryActionKeyInUse } from './delivery-action-keys.ts';
import type { DeliveryControlScope, DeliveryAccelerationReceipt, DeliveryAccelerationResponse } from './delivery-control-types.ts';
function missing():never{throw new HttpError(404,'Delivery control not found','delivery_control_not_found')}
function conflict():never{throw new HttpError(409,'This control key or delivery revision changed','delivery_control_conflict')}
function scope(raw:unknown):DeliveryControlScope{
 const value=strictObject(raw,['source','accountId','operationId','sessionId','turnId']);
 if(value.source==='composer'){strictObject(raw,['source','accountId','operationId']);return{source:'composer',accountId:identifier(value.accountId),operationId:identifier(value.operationId)}}
 if(value.source==='artifact')return{source:'artifact',accountId:identifier(value.accountId),operationId:identifier(value.operationId),sessionId:identifier(value.sessionId),turnId:identifier(value.turnId)};
 throw new HttpError(400,'Invalid delivery control source','delivery_control_invalid_request');
}
export class DeliveryAccelerationService{
 readonly store:Store;readonly aiSend:AiDraftSendService;readonly draftSend:DraftSendService;readonly now:()=>number;
 constructor(store:Store,aiSend:AiDraftSendService,draftSend:DraftSendService,now=Date.now){
  this.store=store;this.aiSend=aiSend;this.draftSend=draftSend;this.now=now;
  store.db.exec('BEGIN IMMEDIATE');try{store.db.exec(`CREATE TABLE IF NOT EXISTS delivery_accelerations(id TEXT PRIMARY KEY,source TEXT NOT NULL,account_id TEXT NOT NULL,operation_id TEXT NOT NULL,client_key TEXT NOT NULL,fingerprint TEXT NOT NULL,scope_data TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(account_id,client_key));CREATE INDEX IF NOT EXISTS delivery_acceleration_scope ON delivery_accelerations(account_id,source,operation_id);`);store.db.exec('COMMIT')}catch(error){store.db.exec('ROLLBACK');throw error}
 }
 private operation(value:DeliveryControlScope){try{return value.source==='artifact'?this.aiSend.scopedOperation(value,value.operationId):this.draftSend.operation(value.accountId,value.operationId)}catch(error){if(error instanceof HttpError&&error.status===404)missing();throw error}}
 private response(value:DeliveryControlScope,receipt:DeliveryAccelerationReceipt):DeliveryAccelerationResponse{
  if(value.source==='artifact'){const op=this.aiSend.scopedOperation(value,value.operationId);return{source:'artifact',snapshot:this.aiSend.byRequest(value,op.previewId,op.clientRequestId),acceleration:receipt}}
  const op=this.draftSend.operation(value.accountId,value.operationId);return{source:'composer',snapshot:this.draftSend.byRequest(value.accountId,op.draftId,op.clientRequestId),acceleration:receipt};
 }
 accelerate(raw:unknown):{created:boolean;response:DeliveryAccelerationResponse}{
  const value=strictObject(raw,['source','accountId','operationId','sessionId','turnId','clientRequestId','expectedRevision']),{clientRequestId,expectedRevision,...scopeRaw}=value,selected=scope(scopeRaw),key=identifier(clientRequestId);
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(key)||typeof expectedRevision!=='number'||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new HttpError(400,'Invalid delivery control identity','delivery_control_invalid_request');
  this.operation(selected);
  this.store.db.exec('BEGIN IMMEDIATE');let result:{created:boolean;response:DeliveryAccelerationResponse};
  try{
   const fingerprint=hash({kind:'delivery-accelerate',...selected,expectedRevision}),prior=this.store.db.prepare('SELECT fingerprint,data FROM delivery_accelerations WHERE account_id=? AND client_key=?').get(selected.accountId,key);
   if(prior){if(prior.fingerprint!==fingerprint)conflict();result={created:false,response:this.response(selected,JSON.parse(String(prior.data)))}}
   else{
    if(deliveryActionKeyInUse(this.store.db,selected.accountId,key))conflict();
    const op=this.operation(selected),at=new Date(this.now()).toISOString();
    const receipt:DeliveryAccelerationReceipt={id:randomUUID(),source:selected.source,accountId:selected.accountId,operationId:selected.operationId,clientRequestId:key,createdAt:at,priorRevision:expectedRevision,originalDeadlineAt:op.cancellableUntil,effectiveDeadlineAt:at};
    this.store.db.prepare('INSERT INTO delivery_accelerations VALUES(?,?,?,?,?,?,?,?)').run(receipt.id,selected.source,selected.accountId,selected.operationId,key,fingerprint,JSON.stringify(selected),JSON.stringify(receipt));
    if(selected.source==='artifact')this.aiSend.accelerateWithinTransaction(selected.operationId,expectedRevision,receipt);else this.draftSend.accelerateWithinTransaction(selected.operationId,expectedRevision,receipt);
    result={created:true,response:this.response(selected,receipt)};
   }
   this.store.db.exec('COMMIT');
  }catch(error){this.store.db.exec('ROLLBACK');throw error}
  if(result.created){if(selected.source==='artifact')this.aiSend.wakeAcceleration(selected.operationId);else this.draftSend.wakeAcceleration(selected.operationId)}
  return result;
 }
 byRequest(rawScope:unknown,key:string):DeliveryAccelerationResponse{
  const selected=scope(rawScope);identifier(key);this.operation(selected);
  const row=this.store.db.prepare('SELECT scope_data,data FROM delivery_accelerations WHERE account_id=? AND client_key=? AND source=? AND operation_id=?').get(selected.accountId,key,selected.source,selected.operationId);
  if(!row||row.scope_data!==JSON.stringify(selected))missing();return this.response(selected,JSON.parse(String(row.data)));
 }
}
