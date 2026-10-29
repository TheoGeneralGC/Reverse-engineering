import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {registerHooks} from 'node:module';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SplitInboxModel,splitJournalKey} from '../src/split-inbox-model.ts';
import {checkedSplitSave} from '../src/split-inbox-client.ts';
import {ApiError} from '../src/api.ts';
import {configuration,definition,views,memoryStorage,deferred} from './split-inbox-fixtures.ts';
import type {SplitSaveRequest,SplitSaveResponse,SplitConfigurationResponse} from '../src/split-inbox-client.ts';
const stable=(v:any):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
const hash=(v:unknown)=>createHash('sha256').update(stable(v)).digest('hex');
const splitId='split_11111111-1111-4111-8111-111111111111';
const intent=(patch:Partial<SplitSaveRequest>={}):SplitSaveRequest=>({accountId:'a',clientRequestId:'independent-one',expectedRevision:0,expectedBasisFingerprint:'a'.repeat(64),changes:[{type:'create',value:definition()}],...patch});
function receipt(request:SplitSaveRequest,base=configuration(1,[{...definition(),id:splitId,definitionRevision:1}]),createdIds=[splitId]):SplitSaveResponse{
 const {clientRequestId:_,...payload}=request;
 return{...structuredClone(base),historical:false,receipt:{id:'independent-receipt',accountId:request.accountId,clientRequestId:request.clientRequestId,createdAt:'2026-10-28T12:00:00Z',priorRevision:request.expectedRevision,acceptedRevision:base.settings.revision,settingsFingerprint:hash(base.settings),requestProtocol:'split-save-v1',requestFingerprint:hash({protocol:'split-save-v1',request:payload}),request:structuredClone(request),createdIds}};
}

test('accepted settings hash and exact revision increment bind the receipt, not merely well-shaped SHA strings',async()=>{
 const request=intent(),good=receipt(request);assert.equal((await checkedSplitSave(good,request)).receipt.settingsFingerprint,hash(good.settings));
 const badHash=structuredClone(good);badHash.receipt.settingsFingerprint='b'.repeat(64);await assert.rejects(checkedSplitSave(badHash,request));
 const noIncrement=receipt(request,configuration(0,[{...definition(),id:splitId,definitionRevision:1}]));await assert.rejects(checkedSplitSave(noIncrement,request));
});

test('a response mutated during awaited WebCrypto cannot return a retargeted account/receipt',async()=>{
 const request=intent(),good=receipt(request),original=globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle),gate=deferred<void>();
 const own=Object.getOwnPropertyDescriptor(globalThis.crypto.subtle,'digest');
 Object.defineProperty(globalThis.crypto.subtle,'digest',{configurable:true,value:async(...args:Parameters<SubtleCrypto['digest']>)=>{await gate.promise;return original(...args)}});
 try{const result=checkedSplitSave(good,request);good.receipt.accountId='foreign';good.settings.accountId='foreign';gate.resolve();let accepted:SplitSaveResponse|undefined;try{accepted=await result}catch{/* rejection is safe */}if(accepted){assert.equal(accepted.receipt.accountId,'a');assert.equal(accepted.settings.accountId,'a')}}
 finally{if(own)Object.defineProperty(globalThis.crypto.subtle,'digest',own);else delete (globalThis.crypto.subtle as any).digest;gate.resolve()}
});

test('same request key with changed stored intent cannot be overwritten/cleared by a held earlier ACK',async()=>{
 const storage=memoryStorage(),hold=deferred<SplitSaveResponse>();let remote=configuration(),sent!:SplitSaveRequest,patches=0;
 const model=new SplitInboxModel({accountId:'a',storage,makeKey:()=> 'same-key',request:async(path,body,method)=>{if(method==='PATCH'){patches++;sent=structuredClone(body as SplitSaveRequest);return hold.promise}return path.includes('/views?')?views(remote):remote}});
 model.activate();await model.load();const saving=model.save([{type:'create',value:definition()}]);
 const changed={version:1,request:{...structuredClone(sent),changes:[{type:'create',value:definition({query:'subject:different'})}]}};
 const bytes=JSON.stringify(changed);storage.setItem(splitJournalKey('a'),bytes);remote=configuration(1,[{...definition(),id:splitId,definitionRevision:1}]);hold.resolve(receipt(sent,remote));
 assert.equal(await saving,false);assert.equal(storage.getItem(model.storageKey),bytes);assert.equal(model.getSnapshot().unknown,true);assert.equal(patches,1);model.dispose();
});

test('same configuration revision cannot replace already-known saved settings after a later GET',async()=>{
 let remote=configuration(1,[{...definition(),id:splitId,definitionRevision:1}]);
 const model=new SplitInboxModel({accountId:'a',storage:memoryStorage(),request:async(path)=>path.includes('/views?')?views(remote):remote});model.activate();await model.load();
 remote=configuration(1,[{...definition({name:'Same revision substitution'}),id:splitId,definitionRevision:1}]);assert.equal(await model.load(),false);assert.equal(model.getSnapshot().base?.settings.custom[0].name,'Cedar');model.dispose();
});

test('late high-generation views cannot poison a newer accepted count floor',async()=>{
 const base=configuration(1,[{...definition(),id:splitId,definitionRevision:1}]),old=deferred<ReturnType<typeof views>>();let viewCalls=0;
 const model=new SplitInboxModel({accountId:'a',storage:memoryStorage(),request:async(path)=>{if(path.includes('/views?'))return ++viewCalls===1?old.promise:views(base,viewCalls===2?3:4);return base}});model.activate();await model.load();await model.loadViews();assert.equal(model.getSnapshot().views?.sourceGeneration,3);old.resolve(views(base,999));await new Promise(r=>setImmediate(r));assert.equal(model.getSnapshot().views?.sourceGeneration,3);await model.loadViews();assert.equal(model.getSnapshot().views?.sourceGeneration,4);assert.equal(model.getSnapshot().viewsError,'');model.dispose();
});

test('account switch/suspend during held Save keeps original journal and cannot publish into another account',async()=>{
 const storage=memoryStorage(),hold=deferred<SplitSaveResponse>();let sent!:SplitSaveRequest,patches=0;
 const first=new SplitInboxModel({accountId:'a',storage,makeKey:()=> 'account-a',request:async(path,body,method)=>{if(method==='PATCH'){patches++;sent=structuredClone(body as SplitSaveRequest);return hold.promise}return path.includes('/views?')?views(configuration()):configuration()}});first.activate();await first.load();const saving=first.save([{type:'create',value:definition()}]);first.suspend();const bytes=storage.getItem(first.storageKey);
 const calls:string[]=[],other=configuration(0,[],'b'),second=new SplitInboxModel({accountId:'b',storage,request:async(path,_body,method)=>{calls.push(method+' '+path);return path.includes('/views?')?views(other):other}});second.activate();await second.load();hold.resolve(receipt(sent));assert.equal(await saving,false);assert.equal(first.getSnapshot().base?.settings.revision,0);assert.equal(second.getSnapshot().base?.settings.accountId,'b');assert.equal(second.getSnapshot().base?.settings.custom.length,0);assert.equal(storage.getItem(first.storageKey),bytes);assert(calls.every(c=>c.startsWith('GET ')&&c.includes('accountId=b')));assert.equal(patches,1);first.dispose();second.dispose();
});

test('silent journal removal failure retains accepted receipt and permits only GET recovery until released',async()=>{
 const backing=memoryStorage();let refuseClear=true,patches=0,remote=configuration(),saved!:SplitSaveResponse;const methods:string[]=[];
 const storage={getItem:backing.getItem,setItem:backing.setItem,removeItem:(key:string)=>{if(!refuseClear)backing.removeItem(key)}};
 const model=new SplitInboxModel({accountId:'a',storage,makeKey:()=> 'cannot-clear',request:async(path,body,method)=>{methods.push(method||'GET');if(method==='PATCH'){patches++;remote=configuration(1,[{...definition(),id:splitId,definitionRevision:1}]);saved=receipt(body as SplitSaveRequest,remote);return saved}return path.includes('/by-request/')?saved:path.includes('/views?')?views(remote):remote}});model.activate();await model.load();assert.equal(await model.save([{type:'create',value:definition()}]),false);assert.equal(model.getSnapshot().unknown,true);assert.equal(JSON.parse(storage.getItem(model.storageKey)!).receipt.id,saved.receipt.id);assert.equal(await model.save([{type:'create',value:definition()}]),false);const start=methods.length;refuseClear=false;assert.equal(await model.recover(),true);assert(methods.slice(start).every(m=>m==='GET'));assert.equal(storage.getItem(model.storageKey),null);assert.equal(model.getSnapshot().base?.settings.revision,1);assert.equal(patches,1);model.dispose();
});

test('newer different-key journal arriving during held current GET remains exact and blocks automatic new writes',async()=>{
 const storage=memoryStorage(),current=deferred<SplitConfigurationResponse>();let acceptedRead=false,sent!:SplitSaveRequest,patches=0;
 const model=new SplitInboxModel({accountId:'a',storage,makeKey:()=> 'old-key',request:async(path,body,method)=>{if(method==='PATCH'){patches++;sent=structuredClone(body as SplitSaveRequest);acceptedRead=true;return receipt(sent)}if(path.includes('/views?'))return views(configuration());if(acceptedRead)return current.promise;return configuration()}});model.activate();await model.load();const saving=model.save([{type:'create',value:definition()}]);for(let i=0;i<10&&!JSON.parse(storage.getItem(model.storageKey)||'{}').receipt;i++)await new Promise(r=>setImmediate(r));assert.ok(JSON.parse(storage.getItem(model.storageKey)!).receipt);
 const newer={version:1,request:intent({clientRequestId:'newer-key',expectedRevision:1,changes:[{type:'create',value:definition({name:'Birch',query:'subject:birch'})}]})},bytes=JSON.stringify(newer);storage.setItem(model.storageKey,bytes);current.resolve(configuration(1,[{...definition(),id:splitId,definitionRevision:1}]));assert.equal(await saving,false);assert.equal(storage.getItem(model.storageKey),bytes);assert.equal(model.getSnapshot().unknown,true);assert.equal(model.getSnapshot().base?.settings.revision,0);assert.equal(await model.save([{type:'create',value:definition()}]),false);assert.equal(patches,1);model.dispose();
});

test('preacceptance refusal classification is limited;500 or unrecognized conflict stays journalled with edits',async()=>{
 const cases=[{status:400,code:'split_invalid_request',unknown:false},{status:422,code:'split_query_unsupported',unknown:false},{status:409,code:'split_revision_conflict',unknown:false},{status:404,code:'split_not_found',unknown:false},{status:500,code:'split_invalid_request',unknown:true},{status:409,code:'request_failed',unknown:true},{status:400,code:'request_failed',unknown:true}];
 for(const c of cases){const storage=memoryStorage();let patches=0;const model=new SplitInboxModel({accountId:'a',storage,makeKey:()=> 'classified',request:async(path,_body,method)=>{if(method==='PATCH'){patches++;throw new ApiError('Synthetic refusal',c.status,c.code)}return path.includes('/views?')?views(configuration()):configuration()}});model.activate();await model.load();model.startNew();model.setField('name','Retain authored title');model.setField('query','subject:cedar');assert.equal(await model.saveEditor(),false);assert.equal(model.getSnapshot().unknown,c.unknown);assert.equal(!!storage.getItem(model.storageKey),c.unknown);assert.equal(model.getSnapshot().editor?.value.name,'Retain authored title');assert.equal(patches,1);model.dispose();}
});

test('current GET at the accepted revision must match receipt-bound saved settings before clearing an intent',async()=>{
 const storage=memoryStorage();let applied=false,saved!:SplitSaveResponse,patches=0;const wrong=configuration(1,[{...definition({name:'Substituted current GET'}),id:splitId,definitionRevision:1}]);
 const model=new SplitInboxModel({accountId:'a',storage,makeKey:()=> 'current-proof',request:async(path,body,method)=>{if(method==='PATCH'){patches++;applied=true;saved=receipt(body as SplitSaveRequest);return saved}return path.includes('/views?')?views(applied?wrong:configuration()):applied?wrong:configuration()}});model.activate();await model.load();assert.equal(await model.save([{type:'create',value:definition()}]),false);assert.equal(model.getSnapshot().unknown,true);assert.equal(model.getSnapshot().base?.settings.revision,0);assert.equal(JSON.parse(storage.getItem(model.storageKey)!).receipt.id,saved.receipt.id);assert.equal(patches,1);model.dispose();
});

test('receipt substitution with same stored request during held current GET cannot be cleared as the verified receipt',async()=>{
 const storage=memoryStorage(),current=deferred<SplitConfigurationResponse>();let applied=false,saved!:SplitSaveResponse;
 const model=new SplitInboxModel({accountId:'a',storage,makeKey:()=> 'receipt-cas',request:async(path,body,method)=>{if(method==='PATCH'){applied=true;saved=receipt(body as SplitSaveRequest);return saved}if(path.includes('/views?'))return views(configuration());return applied?current.promise:configuration()}});model.activate();await model.load();const saving=model.save([{type:'create',value:definition()}]);for(let i=0;i<10&&!JSON.parse(storage.getItem(model.storageKey)||'{}').receipt;i++)await new Promise(r=>setImmediate(r));const journal=JSON.parse(storage.getItem(model.storageKey)!);assert.equal(journal.receipt.id,saved.receipt.id);journal.receipt.id='different-receipt-same-request';const bytes=JSON.stringify(journal);storage.setItem(model.storageKey,bytes);current.resolve(configuration(1,[{...definition(),id:splitId,definitionRevision:1}]));assert.equal(await saving,false);assert.equal(storage.getItem(model.storageKey),bytes);assert.equal(model.getSnapshot().unknown,true);model.dispose();
});

test('actual Workspace Create selects only receipt-created ID, never a different tab-created replacement from newer current settings',async()=>{
 const {transformWithOxc}=await import('vite'),{JSDOM}=await import('jsdom'),path=fileURLToPath(new URL('../src/SplitInboxWorkspace.tsx',import.meta.url)),compiled=(await transformWithOxc(readFileSync(path,'utf8'),path,{jsx:{runtime:'automatic'}})).code;
 const hook=registerHooks({load(url,context,next){if(url.endsWith('.css'))return{format:'module',shortCircuit:true,source:''};if(url===pathToFileURL(path).href)return{format:'module',shortCircuit:true,source:compiled};return next(url,context)}});
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1:5173'}),keys=['window','document','navigator','Node','HTMLElement','Element','Event','KeyboardEvent'],prior=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const k of keys)Object.defineProperty(globalThis,k,{configurable:true,value:dom.window[k as keyof typeof dom.window]});const priorAct=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{configurable:true,value:true});
 try{const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client'),{default:Workspace}=await import('../src/SplitInboxWorkspace.tsx');
  for(const ownState of['present','gone','disabled']){const opened:string[]=[],otherId='split_22222222-2222-4222-8222-222222222222',ours={...definition(),id:splitId,definitionRevision:1},other={...definition({name:'Birch',query:'subject:birch'}),id:otherId,definitionRevision:1};let applied=false;
   const model=new SplitInboxModel({accountId:'a',storage:memoryStorage(),makeKey:()=> 'create-owned',request:async(path,body,method)=>{if(method==='PATCH'){applied=true;return receipt(body as SplitSaveRequest,configuration(1,[ours]))}const current=applied?configuration(ownState==='present'?2:3,ownState==='present'?[ours,other]:ownState==='disabled'?[{...ours,enabled:false,definitionRevision:2},other]:[other]):configuration();return path.includes('/views?')?views(current):current}});model.activate();await model.load();model.startNew();model.setField('name','Cedar');model.setField('query','subject:cedar');model.setField('leaveThreadsInImportantOther',true);const host=dom.window.document.createElement('div');dom.window.document.body.append(host);const root=createRoot(host);
   try{await act(async()=>root.render(createElement(Workspace,{model,onClose:()=>{},onCreated:(ref:string)=>opened.push(ref)})));const create=host.querySelector<HTMLButtonElement>('button[type=submit]')!;assert.ok(create&&!create.disabled);await act(async()=>create.click());for(let i=0;i<100&&model.getSnapshot().pending;i++)await act(async()=>new Promise(r=>setTimeout(r,2)));assert.equal(model.getSnapshot().pending,null);assert.deepEqual(opened,ownState==='present'?['custom:'+splitId]:[],'The action must never navigate to the other window\'s Split');}
   finally{await act(async()=>root.unmount());model.dispose();host.remove()}
  }
 }finally{hook.deregister();dom.window.close();for(const k of keys){const saved=prior.get(k);if(saved)Object.defineProperty(globalThis,k,saved);else delete (globalThis as any)[k]}if(priorAct)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',priorAct);else delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT}
});

test('another journal adopted between initial read and durable store locks editing immediately without a PATCH',async()=>{
 const backing=memoryStorage(),replacement={version:1,request:intent({clientRequestId:'other-tab'})},bytes=JSON.stringify(replacement);let inject=false,patches=0;
 const storage={getItem:(key:string)=>{const old=backing.getItem(key);if(inject){inject=false;backing.setItem(key,bytes)}return old},setItem:backing.setItem,removeItem:backing.removeItem};
 const model=new SplitInboxModel({accountId:'a',storage,makeKey:()=> 'first-tab',request:async(path,_body,method)=>{if(method==='PATCH')patches++;return path.includes('/views?')?views(configuration()):configuration()}});model.activate();await model.load();model.startNew();model.setField('name','Retain title');model.setField('query','subject:cedar');inject=true;assert.equal(await model.saveEditor(),false);assert.equal(storage.getItem(model.storageKey),bytes);assert.equal(patches,0);assert.equal(model.getSnapshot().unknown,true);assert.equal(model.locked,true);model.setField('name','Must not overwrite during unknown');assert.equal(model.getSnapshot().editor?.value.name,'Retain title');model.dispose();
});
