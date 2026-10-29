import type { SplitConfigurationResponse, SplitSaveRequest, SplitSaveResponse, SplitViewRef, SplitViewsResponse, SplitThreadPage, SplitDefinitionInput, SplitChange } from '../../api/src/split-inbox-types.ts';
export type { SplitConfigurationResponse, SplitSaveRequest, SplitSaveResponse, SplitViewRef, SplitViewsResponse, SplitThreadPage, SplitDefinitionInput, SplitChange };
export type SplitRequest = (path:string,body?:unknown,method?:string,options?:{signal?:AbortSignal})=>Promise<any>;
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
const text=(v:unknown):v is string=>typeof v==='string';
const id=(v:unknown):v is string=>text(v)&&v.length>0&&v.length<=1024&&!/[\p{Cc}\p{Cf}\p{Cs}]/u.test(v);
const sha=(v:unknown):v is string=>text(v)&&/^[a-f0-9]{64}$/.test(v);
const time=(v:unknown)=>text(v)&&Number.isFinite(Date.parse(v));
const unique=(v:unknown[]):boolean=>new Set(v).size===v.length;
export const sameSplitValue=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export const isSplitViewRef=(v:unknown):v is SplitViewRef=>text(v)&&(/^(builtin:)(important|other|calendar)$/.test(v)||v.startsWith('custom:')&&id(v.slice(7)));
const fail=():never=>{throw Error('The Split Inbox response could not be verified.');};
function definition(v:unknown):boolean{return object(v)&&text(v.name)&&v.name.trim()===v.name&&v.name.length>0&&v.name.length<=80&&text(v.query)&&v.query.length<=2048&&Array.isArray(v.autoLabelIds)&&v.autoLabelIds.every(id)&&unique(v.autoLabelIds)&&['and','or'].includes(v.autoLabelJoin)&&['enabled','leaveThreadsInImportantOther','hideEmpty'].every(k=>typeof v[k]==='boolean');}
function issue(v:unknown):boolean{return v===null||object(v)&&id(v.code)&&text(v.message)&&(v.position===undefined||integer(v.position))&&(v.field===undefined||text(v.field));}
export function checkedSplitConfiguration(v:unknown,accountId:string):SplitConfigurationResponse{
 if(!object(v)||!object(v.settings)||!object(v.capabilities)||!Array.isArray(v.validation))return fail();const s=v.settings,c=v.capabilities;
 if(s.version!==1||s.accountId!==accountId||!integer(s.revision)||!(s.updatedAt===null||time(s.updatedAt))||typeof s.persisted!=='boolean'||!object(s.effectiveBasis)||!['legacy-global','account'].includes(s.effectiveBasis.kind)||!sha(s.effectiveBasis.fingerprint)||!Array.isArray(s.custom)||s.custom.length>32||s.custom.some((d:any)=>!definition(d)||!id(d.id)||!integer(d.definitionRevision)||d.definitionRevision<1)||!unique(s.custom.map((d:any)=>d.id)))return fail();
 const refs=s.custom.map((d:any)=>'custom:'+d.id);if(!Array.isArray(s.order)||!s.order.every(isSplitViewRef)||!unique(s.order)||refs.some((ref:string)=>!s.order.includes(ref))||s.order.some((ref:string)=>ref.startsWith('custom:')&&!refs.includes(ref)))return fail();
 if(c.implemented!==true||c.scope!=='local-imported-metadata'||c.providerEffects!==false||c.classification!==false||c.autoLabels!==false||!id(c.policyVersion)||!Array.isArray(c.supportedFields)||!c.supportedFields.every(text)||!Array.isArray(c.unsupportedFields)||!c.unsupportedFields.every(text)||!object(c.limits))return fail();
 for(const[k,n]of Object.entries({custom:32,nameUnits:80,queryUnits:2048,queryBytes:4096,tokens:128,nodes:64,depth:8}))if(c.limits[k]!==n)return fail();
 if(v.validation.length!==s.custom.length||!unique(v.validation.map((d:any)=>d?.id))||v.validation.some((d:any)=>!object(d)||!refs.includes('custom:'+d.id)||typeof d.valid!=='boolean'||!issue(d.issue)||d.valid!==(d.issue===null)||d.policyVersion!==c.policyVersion||!sha(d.queryHash)||!Array.isArray(d.labelBindings)||d.labelBindings.some((b:any)=>!object(b)||!id(b.id)||!(b.providerId===null||id(b.providerId))||!text(b.name)||!sha(b.fingerprint))))return fail();
 return structuredClone(v) as SplitConfigurationResponse;
}
export function stableSplitJSON(value:unknown):string{
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(stableSplitJSON).join(',')+']';
 return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableSplitJSON((value as Record<string,unknown>)[key])).join(',')+'}';
}
export async function splitValueFingerprint(value:unknown){return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableSplitJSON(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function splitRequestFingerprint(request:SplitSaveRequest){const {clientRequestId:_,...payload}=structuredClone(request);return splitValueFingerprint({protocol:'split-save-v1',request:payload});}
export async function checkedSplitSave(v:unknown,request:SplitSaveRequest):Promise<SplitSaveResponse>{
 v=structuredClone(v);request=structuredClone(request);const c=checkedSplitConfiguration(v,request.accountId);if(!object(v)||!object(v.receipt)||typeof v.historical!=='boolean')return fail();const r=v.receipt;
 if(!id(r.id)||r.accountId!==request.accountId||r.clientRequestId!==request.clientRequestId||!time(r.createdAt)||r.priorRevision!==request.expectedRevision||r.acceptedRevision!==r.priorRevision+1||c.settings.revision!==r.acceptedRevision||(!sha(r.settingsFingerprint)||r.settingsFingerprint!==await splitValueFingerprint(c.settings))||r.requestProtocol!=='split-save-v1'||!sha(r.requestFingerprint)||stableSplitJSON(r.request)!==stableSplitJSON(request)||r.requestFingerprint!==await splitRequestFingerprint(request)||!Array.isArray(r.createdIds)||!r.createdIds.every(id)||!unique(r.createdIds)||r.createdIds.length!==request.changes.filter(change=>change.type==='create').length)return fail();
 let createIndex=0;const effects=new Map<string,Record<string,unknown>|null>();let finalOrder:SplitViewRef[]|null=null;
 const normalized=(fields:Record<string,unknown>)=>Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,(key==='name'||key==='query')&&typeof value==='string'?value.trim():structuredClone(value)]));
 for(const change of request.changes){
  if(change.type==='create'){const created=r.createdIds[createIndex++];effects.set(created,normalized(change.value));if(finalOrder)finalOrder.push(`custom:${created}`);}
  else if(change.type==='update'){if(effects.has(change.id)&&effects.get(change.id)===null)return fail();effects.set(change.id,{...effects.get(change.id),...normalized(change.changes)});}
  else if(change.type==='delete'){effects.set(change.id,null);if(finalOrder)finalOrder=finalOrder.filter(ref=>ref!==`custom:${change.id}`);}
  else finalOrder=[...change.order];
 }
 for(const [changed,fields]of effects){const saved=c.settings.custom.find(d=>d.id===changed);if(fields===null){if(saved)return fail();continue;}if(!saved)return fail();for(const [key,expected]of Object.entries(fields))if(stableSplitJSON((saved as any)[key])!==stableSplitJSON(expected))return fail();}
 if(finalOrder&&!sameSplitValue(c.settings.order,finalOrder))return fail();
 return structuredClone(v) as SplitSaveResponse;
}
function count(v:unknown){return object(v)&&(v.total===null||integer(v.total))&&typeof v.isComplete==='boolean'&&typeof v.isEstimate==='boolean'&&!(v.total===null&&v.isComplete);}
function coverage(v:unknown){return object(v)&&v.scope==='local-imported-metadata'&&['complete','pending','unavailable'].includes(v.status)&&integer(v.pendingHeaders)&&(v.reason===null||text(v.reason))&&!(v.status==='complete'&&v.pendingHeaders!==0);}
export function checkedSplitViews(v:unknown,base:SplitConfigurationResponse):SplitViewsResponse{
 if(!object(v)||v.accountId!==base.settings.accountId||v.settingsRevision!==base.settings.revision||!integer(v.sourceGeneration)||v.policyVersion!==base.capabilities.policyVersion||!object(v.rawCounts)||!['inbox','important','other','calendar'].every(k=>integer(v.rawCounts[k]))||!(v.exclusionCount===null||integer(v.exclusionCount))||!coverage(v.coverage)||!Array.isArray(v.views)||!unique(v.views.map((x:any)=>x?.ref))||v.views.some((x:any)=>!object(x)||!base.settings.order.includes(x.ref)||!text(x.name)||typeof x.enabled!=='boolean'||typeof x.hideEmpty!=='boolean'||!count(x.count)||!issue(x.issue)))return fail();
 for(const view of v.views){const custom=base.settings.custom.find(x=>'custom:'+x.id===view.ref);if(custom&&(view.name!==custom.name||view.enabled!==custom.enabled||view.hideEmpty!==custom.hideEmpty))return fail();}
 return structuredClone(v) as SplitViewsResponse;
}
export function checkedSplitPage(v:unknown,context:{accountId:string;viewRef:SplitViewRef;settingsRevision:number;policyVersion:string}):SplitThreadPage{
 if(!object(v)||v.accountId!==context.accountId||v.viewRef!==context.viewRef||v.settingsRevision!==context.settingsRevision||v.policyVersion!==context.policyVersion||!integer(v.sourceGeneration)||!count(v.count)||v.total!==v.count.total||!coverage(v.coverage)||typeof v.hasMore!=='boolean'||!(v.nextCursor===null||text(v.nextCursor)&&v.nextCursor.length>0)||v.hasMore!==(v.nextCursor!==null)||!Array.isArray(v.threads)||v.threads.length>100||!unique(v.threads.map((x:any)=>x?.id))||v.threads.some((t:any)=>!object(t)||!id(t.id)||t.accountId!==context.accountId||!text(t.subject)||!text(t.snippet)||!object(t.sender)||!text(t.sender.name)||!text(t.sender.email)||!Array.isArray(t.participants)||!time(t.lastMessageAt)||['unread','starred','important'].some(k=>typeof t[k]!=='boolean')||!text(t.folder)||!Array.isArray(t.labels)||'messages'in t))return fail();
 return structuredClone(v) as SplitThreadPage;
}
