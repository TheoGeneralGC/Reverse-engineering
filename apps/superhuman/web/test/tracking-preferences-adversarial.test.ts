import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ApiError} from '../src/api.ts';
import {TrackingPreferencesModel,trackingJournalKey} from '../src/tracking/preferences.ts';
import type {TrackingRequest,TrackingPreferencesResponse,TrackingPreferencesSaveRequest,TrackingPreferencesSaveResponse} from '../src/tracking/client.ts';

const stable=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable((v as Record<string,unknown>)[k])).join(',')+'}';
const digest=async(v:unknown)=>createHash('sha256').update(stable(v)).digest('hex');
const capabilities={policyVersion:'local-tracking-foundation-v1',foundationImplemented:true,collector:{configured:false,verification:'not-checked',configurationFingerprint:null,provenance:'not-configured'},deliveryIntegrated:false,effectiveReadStatuses:false,effectiveRecentOpens:false,reason:'collector-not-configured',humanReadVerified:false,namedRecipientIdentity:false,teamSharing:false,provenance:'local-design',recentOpensCoupling:'requires-read-statuses'} as const;
const base=():TrackingPreferencesResponse=>({preferences:{version:1,accountId:'a',revision:0,updatedAt:null,persisted:false,desired:{readStatuses:false,recentOpens:false},provenance:{kind:'local-disabled-default',originalDefaultVerified:false}},capabilities:structuredClone(capabilities)});
async function accepted(request:TrackingPreferencesSaveRequest):Promise<TrackingPreferencesSaveResponse>{const preferences:TrackingPreferencesResponse['preferences']={version:1,accountId:'a',revision:request.expectedRevision+1,updatedAt:'2026-10-29T12:00:00.000Z',persisted:true,desired:structuredClone(request.desired),provenance:{kind:'account-saved',originalDefaultVerified:false}},{clientRequestId:_,...intent}=request;return{preferences,capabilities:structuredClone(capabilities),historical:false,receipt:{id:'receipt-'+request.clientRequestId,accountId:'a',clientRequestId:request.clientRequestId,priorRevision:request.expectedRevision,acceptedRevision:preferences.revision,acceptedAt:preferences.updatedAt!,requestProtocol:'tracking-prefs-v1',requestFingerprint:await digest({protocol:'tracking-prefs-v1',request:intent}),request:structuredClone(request),preferencesFingerprint:await digest(preferences)}}}
function fixture(){let current=base(),failCurrent=false;const map=new Map<string,string>(),receipts=new Map<string,TrackingPreferencesSaveResponse>(),calls:{path:string;method:string}[]=[];
 const storage={getItem:(key:string)=>map.get(key)??null,setItem:(key:string,v:string)=>{map.set(key,v)},removeItem:(key:string)=>{map.delete(key)}};
 const request:TrackingRequest=async(path,body,method='GET')=>{calls.push({path,method});if(method==='PATCH'){const intent=body as TrackingPreferencesSaveRequest;if(intent.expectedRevision!==current.preferences.revision)throw new ApiError('Synthetic CAS conflict',409,'tracking_revision_conflict');const value=await accepted(intent);receipts.set(intent.clientRequestId,value);current={preferences:value.preferences,capabilities:value.capabilities};return structuredClone(value)}if(path.includes('/requests/by-request/')){const key=decodeURIComponent(path.split('/requests/by-request/')[1]!.split('?')[0]!);const known=receipts.get(key);if(!known)throw new ApiError('Synthetic absent receipt',404,'tracking_not_found');return{...structuredClone(known),historical:true}}if(path==='/tracking/preferences?accountId=a'){if(failCurrent&&receipts.size)throw new ApiError('Synthetic read failure',500,'request_failed');return structuredClone(current)}throw Error('Unexpected synthetic route')};
 const model=new TrackingPreferencesModel({accountId:'a',storage,request,digest,makeKey:()=> 'owned-key',online:()=>true});model.activate();return{model,map,calls,receipts,get current(){return current},set current(v:TrackingPreferencesResponse){current=structuredClone(v)},failCurrent(v:boolean){failCurrent=v}};
}

test('unchanged reload cannot silently resolve an unresolved staged preference conflict',async()=>{
 const f=fixture();try{await f.model.load();f.model.setDesired({readStatuses:true,recentOpens:false});const remote=await accepted({accountId:'a',clientRequestId:'remote',expectedRevision:0,desired:{readStatuses:true,recentOpens:true}});f.current={preferences:remote.preferences,capabilities:remote.capabilities};
  await f.model.load();assert.equal(f.model.getSnapshot().conflict,true);await f.model.load();assert.equal(f.model.getSnapshot().conflict,true,'Only explicit conflict resolution or converged values may clear the conflict');assert.equal(await f.model.save(),false);assert.equal(f.calls.filter(c=>c.method==='PATCH').length,0);
  assert.equal(f.model.resolveConflict('mine'),true);assert.equal(await f.model.save(),true);
 }finally{f.model.dispose()}
});

test('same-key journal phase downgrade cannot erase a known positive receipt identity floor',async()=>{
 const f=fixture();try{await f.model.load();f.model.setDesired({readStatuses:true,recentOpens:false});f.failCurrent(true);assert.equal(await f.model.save(),false);
  const key=trackingJournalKey('a'),journal=JSON.parse(f.map.get(key)!);assert.equal(journal.phase,'accepted');const originalId=journal.receipt.id;journal.phase='issued';delete journal.receipt;const replacement=JSON.stringify(journal);f.map.set(key,replacement);
  const reply=f.receipts.get('owned-key')!;reply.receipt.id='substituted-valid-shaped-receipt';f.failCurrent(false);
  assert.equal(await f.model.recover(),false,'A shared journal rewrite must not forget an already verified acceptance identity');assert.equal(f.map.get(key),replacement);assert.notEqual(f.model.getSnapshot().lastReceipt?.id,reply.receipt.id);assert.equal(f.model.getSnapshot().unknown,true);assert.equal(originalId==='substituted-valid-shaped-receipt',false);assert.equal(f.calls.filter(c=>c.method==='PATCH').length,1);
 }finally{f.model.dispose()}
});
