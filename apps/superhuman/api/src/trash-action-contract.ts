import {createHash} from 'node:crypto';
import {HttpError,type Thread} from './types.ts';

export type TrashState='pending'|'confirmed'|'unknown'|'refused';
export type TrashReason='trash_source_changed'|'trash_account_changed'|'trash_grant_changed'|'trash_ineligible'|'trash_source_limit'|'trash_no_change'|'trash_native_scope'|'trash_native_unconfirmed'|'trash_effect_unconfirmed'|'trash_local_conflict'|'trash_stopping'|'trash_undo_expired'|'trash_undo_unavailable';
export type TrashRequest={version:1;action:'trash';accountId:string;accountVersion:string;expectedSourceVersion:string;clientRequestId:string};
export type TrashUndoRequest={version:1;accountId:string;accountVersion:string;clientRequestId:string};
export type TrashNativeStatus={mode:'google'|'local'|null;issuePossible:boolean;ackKnown:boolean;effectVerified:boolean};
export type TrashReceipt={version:1;action:'trash';clientRequestId:string;accountId:string;accountVersion:string;threadId:string;state:TrashState;undoId:string|null;locked:boolean;reason:TrashReason|null;native:TrashNativeStatus};
export type TrashUndoStatus={version:1;clientRequestId:string;state:TrashState;reason:TrashReason|null;native:TrashNativeStatus};
export type TrashEnvelope={version:1;scopeCurrent:boolean;thread?:Thread;receipt:TrashReceipt;undo:TrashUndoStatus|null};
export const trashStable=(value:unknown)=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const trashHash=(value:unknown)=>createHash('sha256').update(trashStable(value)).digest('hex');
export const trashRequestFingerprint=(threadId:string,request:TrashRequest)=>trashHash({kind:'trash',version:1,threadId,request});
export const trashUndoFingerprint=(threadId:string,originalRequestId:string,request:TrashUndoRequest)=>trashHash({kind:'trash-undo',version:1,threadId,originalRequestId,request});
export const trashHex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const trashKey=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export const trashId=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&Buffer.byteLength(v)<=512&&!/[\s\p{Cc}]/u.test(v);
export const trashExact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function trashFail(code:string,status=409):never{throw new HttpError(status,'This Trash operation is unavailable',code)}
export function parseTrashRequest(v:unknown):TrashRequest{if(!trashExact(v,['version','action','accountId','accountVersion','expectedSourceVersion','clientRequestId'])||v.version!==1||v.action!=='trash'||!trashId(v.accountId)||!trashHex(v.accountVersion)||!trashHex(v.expectedSourceVersion)||!trashKey(v.clientRequestId))trashFail('trash_invalid_request',400);return v as TrashRequest}
export function parseTrashUndo(v:unknown):TrashUndoRequest{if(!trashExact(v,['version','accountId','accountVersion','clientRequestId'])||v.version!==1||!trashId(v.accountId)||!trashHex(v.accountVersion)||!trashKey(v.clientRequestId))trashFail('trash_invalid_request',400);return v as TrashUndoRequest}

/** Reject duplicate object keys before ordinary JSON parsing can collapse them. */
export function parseTrashJson(text:string):unknown{
 const tokens=text.match(/"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|[{}\[\],:]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g)??[];
 const stack:({kind:'object';keys:Set<string>}|{kind:'array'})[]=[];
 for(let i=0;i<tokens.length;i++){const t=tokens[i];if(t==='{')stack.push({kind:'object',keys:new Set()});else if(t==='[')stack.push({kind:'array'});else if(t==='}'||t===']')stack.pop();else if(t.startsWith('"')&&tokens[i+1]===':'){const top=stack.at(-1);if(!top||top.kind!=='object')trashFail('trash_invalid_request',400);const k=JSON.parse(t);if(top.keys.has(k))trashFail('trash_invalid_request',400);top.keys.add(k)}}
 try{return JSON.parse(text)}catch{trashFail('trash_invalid_request',400)}
}
