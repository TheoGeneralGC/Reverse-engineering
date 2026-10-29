// Validate persisted acceptance independently of the current mutable settings/labels.
import type { CustomSplit, SplitSaveRequest, SplitSaveResponse, SplitSettings, SplitViewRef } from './split-inbox-types.ts';
import { splitCapabilities, splitDefinition, splitFail, splitHash, splitNameKey, splitSaveRequest, viewRef } from './split-inbox-config.ts';
import { parseSplitQuery, SPLIT_POLICY_VERSION, type SplitQueryNode } from './split-inbox-query.ts';
const corrupt=():never=>splitFail(500,'split_artifact_corrupt','Stored Split Inbox acceptance could not be verified');
const record=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,keys:string[]):v is Record<string,any>=>record(v)&&Object.keys(v).sort().join(',')===keys.sort().join(',');
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=2048&&!/[\s\p{Cc}\p{Cf}\p{Surrogate}]/u.test(v);
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const number=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const timestamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const fields=(c:CustomSplit)=>({name:c.name,query:c.query,autoLabelIds:c.autoLabelIds,autoLabelJoin:c.autoLabelJoin,enabled:c.enabled,leaveThreadsInImportantOther:c.leaveThreadsInImportantOther,hideEmpty:c.hideEmpty});
const labels=(n:SplitQueryNode):string[]=>n.kind==='term'?n.field==='label'?[n.value]:[]:n.kind==='not'?labels(n.child):n.children.flatMap(labels);
function settings(v:unknown,accountId:string):asserts v is SplitSettings{
 if(!exact(v,['version','accountId','revision','updatedAt','persisted','effectiveBasis','custom','order'])||v.version!==1||v.accountId!==accountId||!number(v.revision)||v.revision<1||!timestamp(v.updatedAt)||v.persisted!==true||!exact(v.effectiveBasis,['kind','fingerprint'])||v.effectiveBasis.kind!=='account'||v.effectiveBasis.fingerprint!==splitHash({accountId,revision:v.revision})||!Array.isArray(v.custom)||v.custom.length>32||!Array.isArray(v.order))return corrupt();
 for(const c of v.custom){if(!exact(c,['id','definitionRevision','name','query','autoLabelIds','autoLabelJoin','enabled','leaveThreadsInImportantOther','hideEmpty'])||!/^split_[a-f0-9-]{36}$/.test(c.id)||!number(c.definitionRevision)||c.definitionRevision<1||splitHash(splitDefinition(fields(c as CustomSplit)))!==splitHash(fields(c as CustomSplit)))return corrupt()}
 if(new Set(v.custom.map((c:CustomSplit)=>c.id)).size!==v.custom.length||new Set(v.custom.map((c:CustomSplit)=>splitNameKey(c.name))).size!==v.custom.length||new Set(v.order).size!==v.order.length)return corrupt();const refs=v.custom.map((c:CustomSplit)=>`custom:${c.id}`);if(v.order.some((ref:unknown)=>!['builtin:important','builtin:other','builtin:calendar'].includes(viewRef(ref))&&!refs.includes(ref as string))||refs.some((ref:string)=>!v.order.includes(ref)))return corrupt();
}
export function validateSplitAcceptance(raw:unknown,scope:{id:string;accountId:string;key:string;fingerprint:string}):SplitSaveResponse{
 try{
  if(!exact(raw,['settings','capabilities','validation','receipt','historical'])||raw.historical!==false||splitHash(raw.capabilities)!==splitHash(splitCapabilities))return corrupt();settings(raw.settings,scope.accountId);const s=raw.settings;
  const r=raw.receipt;if(!exact(r,['id','accountId','clientRequestId','createdAt','priorRevision','acceptedRevision','settingsFingerprint','requestProtocol','requestFingerprint','request','createdIds'])||r.id!==scope.id||r.accountId!==scope.accountId||r.clientRequestId!==scope.key||!timestamp(r.createdAt)||r.createdAt!==s.updatedAt||!number(r.priorRevision)||r.acceptedRevision!==r.priorRevision+1||r.acceptedRevision!==s.revision||r.settingsFingerprint!==splitHash(s)||r.requestProtocol!=='split-save-v1'||r.requestFingerprint!==scope.fingerprint||!Array.isArray(r.createdIds)||!r.createdIds.every(id)||new Set(r.createdIds).size!==r.createdIds.length)return corrupt();
  const request=splitSaveRequest(r.request),{clientRequestId:_key,...intent}=request;if(request.accountId!==scope.accountId||request.clientRequestId!==scope.key||request.expectedRevision!==r.priorRevision||splitHash({protocol:'split-save-v1',request:intent})!==scope.fingerprint||r.createdIds.length!==request.changes.filter(c=>c.type==='create').length)return corrupt();
  let index=0,order:SplitViewRef[]|null=null;const effects=new Map<string,Record<string,unknown>|null>();
  for(const c of request.changes){if(c.type==='create'){const id=r.createdIds[index++];effects.set(id,splitDefinition(c.value));if(order)order.push(`custom:${id}`)}else if(c.type==='update'){if(effects.get(c.id)===null)return corrupt();effects.set(c.id,{...effects.get(c.id),...splitDefinition(c.changes,true)})}else if(c.type==='delete'){effects.set(c.id,null);if(order)order=order.filter(ref=>ref!==`custom:${c.id}`)}else order=[...c.order]}
  for(const[id,expected]of effects){const c=s.custom.find(c=>c.id===id);if(expected===null){if(c)return corrupt()}else{if(!c)return corrupt();for(const[k,value]of Object.entries(expected))if(splitHash((c as unknown as Record<string,unknown>)[k])!==splitHash(value))return corrupt()}}
  if(order&&splitHash(order)!==splitHash(s.order))return corrupt();
  if(!Array.isArray(raw.validation)||raw.validation.length!==s.custom.length||new Set(raw.validation.map(v=>v?.id)).size!==raw.validation.length)return corrupt();
  for(const v of raw.validation){const c=s.custom.find(c=>c.id===v?.id);if(!c||!exact(v,['id','valid','issue','policyVersion','queryHash','labelBindings'])||typeof v.valid!=='boolean'||v.valid!==(v.issue===null)||v.policyVersion!==SPLIT_POLICY_VERSION||v.queryHash!==splitHash(parseSplitQuery(c.query))||!Array.isArray(v.labelBindings))return corrupt();if(v.issue!==null&&(!record(v.issue)||typeof v.issue.code!=='string'||!/^split_[a-z0-9_]+$/.test(v.issue.code)||typeof v.issue.message!=='string'||v.issue.message.length>2048||v.issue.position!==undefined&&!number(v.issue.position)||v.issue.field!==undefined&&typeof v.issue.field!=='string'))return corrupt();
   for(const b of v.labelBindings)if(!exact(b,['id','providerId','name','fingerprint'])||!id(b.id)||!(b.providerId===null||id(b.providerId))||typeof b.name!=='string'||!b.name.trim()||b.fingerprint!==splitHash({id:b.id,accountId:scope.accountId,providerId:b.providerId,name:b.name}))return corrupt();const terms=[...new Set(labels(parseSplitQuery(c.query).ast))];if(terms.length!==v.labelBindings.length||terms.some(t=>!v.labelBindings.some((b:any)=>b.id===t||b.providerId===t||splitNameKey(b.name)===splitNameKey(t))))return corrupt();
  }
  return raw as SplitSaveResponse;
 }catch{return corrupt()}
}
