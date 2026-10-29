import { api,ApiError } from './api.ts';
import { checkedSplitConfiguration, checkedSplitSave, checkedSplitViews, sameSplitValue, stableSplitJSON } from './split-inbox-client.ts';
import type { SplitConfigurationResponse, SplitDefinitionInput, SplitChange, SplitRequest, SplitSaveRequest, SplitSaveResponse, SplitViewsResponse, SplitViewRef } from './split-inbox-client.ts';
export type SplitStorage={getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void;removeItem:(key:string)=>void};
export type SplitEditor={id:string|null;value:SplitDefinitionInput;base:SplitDefinitionInput|null;conflicts:string[]};
export type SplitState={base:SplitConfigurationResponse|null;views:SplitViewsResponse|null;editor:SplitEditor|null;pending:'loading'|'saving'|'checking'|null;unknown:boolean;needsReload:boolean;error:string;viewsError:string;viewsLoading:boolean;lastReceipt:SplitSaveResponse['receipt']|null};
type Journal={version:1;request:SplitSaveRequest;receipt?:SplitSaveResponse['receipt']};
const fields=['name','query','autoLabelIds','autoLabelJoin','enabled','leaveThreadsInImportantOther','hideEmpty'] as const;
export const emptySplitDefinition=():SplitDefinitionInput=>({name:'',query:'',autoLabelIds:[],autoLabelJoin:'or',enabled:true,leaveThreadsInImportantOther:false,hideEmpty:false});
export const splitJournalKey=(accountId:string)=>'superhuman.split-inbox.intent.v1.'+encodeURIComponent(accountId);
const input=(value:SplitDefinitionInput):SplitDefinitionInput=>Object.fromEntries(fields.map(key=>[key,structuredClone(value[key])])) as SplitDefinitionInput;
const message=(e:unknown)=>e instanceof Error?e.message:'Unable to update Split Inboxes.';
function checkedJournal(raw:string|null,accountId:string):Journal|null{
 if(raw===null)return null;const j=JSON.parse(raw),r=j?.request;if(j?.version!==1||!r||r.accountId!==accountId||typeof r.clientRequestId!=='string'||!r.clientRequestId||!Number.isSafeInteger(r.expectedRevision)||r.expectedRevision<0||!/^[a-f0-9]{64}$/.test(r.expectedBasisFingerprint)||!Array.isArray(r.changes)||!r.changes.length||r.changes.length>64||r.changes.some((c:any)=>!c||!['create','update','delete','reorder'].includes(c.type)))throw Error('The earlier Split Inbox action needs review; its saved intent could not be verified.');return j;
}
function rebase(editor:SplitEditor,base:SplitConfigurationResponse):SplitEditor{
 if(!editor.id)return editor;const remote=base.settings.custom.find(d=>d.id===editor.id);if(!remote)return{...editor,conflicts:['deleted']};
 const value=input(remote),conflicts:string[]=[];for(const key of fields){if(sameSplitValue(editor.value[key],editor.base?.[key]))continue;if((editor.conflicts.includes(key)||!sameSplitValue(remote[key],editor.base?.[key]))&&!sameSplitValue(remote[key],editor.value[key]))conflicts.push(key);Object.assign(value,{[key]:structuredClone(editor.value[key])});}
 return{id:editor.id,value,base:input(remote),conflicts};
}
export class SplitInboxModel{
 readonly accountId:string;readonly storageKey:string;
 private request:SplitRequest;private storage:SplitStorage;private makeKey:()=>string;private isCurrent:()=>boolean;
 private state:SplitState={base:null,views:null,editor:null,pending:null,unknown:false,needsReload:false,error:'',viewsError:'',viewsLoading:false,lastReceipt:null};
 private active=false;private disposed=false;private epoch=0;private reads=0;private viewsRead=0;private abort?:AbortController;private viewsAbort?:AbortController;private journal:Journal|null=null;private listeners=new Set<()=>void>();
 constructor(options:{accountId:string;request?:SplitRequest;storage:SplitStorage;makeKey?:()=>string;isCurrent?:()=>boolean}){this.accountId=options.accountId;this.storageKey=splitJournalKey(options.accountId);this.request=options.request||api;this.storage=options.storage;this.makeKey=options.makeKey||(()=>crypto.randomUUID());this.isCurrent=options.isCurrent||(()=>true);try{this.journal=checkedJournal(this.storage.getItem(this.storageKey),this.accountId);if(this.journal)this.state.unknown=true;}catch(e){this.state={...this.state,unknown:true,error:message(e)}}}
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn)}};getSnapshot=()=>this.state;
 activate(){if(this.disposed)return;this.active=true;this.epoch++;}
 suspend(){this.active=false;this.epoch++;this.reads++;this.viewsRead++;this.abort?.abort();this.viewsAbort?.abort();this.state={...this.state,pending:null,viewsLoading:false,unknown:this.state.unknown||!!this.journal};}
 dispose(){this.suspend();this.disposed=true;this.listeners.clear();}
 private current(epoch=this.epoch){return this.active&&!this.disposed&&this.isCurrent()&&epoch===this.epoch;}
 private emit(patch:Partial<SplitState>){if(!this.current())return;this.state={...this.state,...patch};for(const fn of this.listeners)fn();}
 get locked(){return !this.current()||!!this.state.pending||this.state.unknown||this.state.needsReload;}
 get requestId(){return this.journal?.request.clientRequestId||null;}
 get dirty(){const e=this.state.editor;return !!e&&!sameSplitValue(e.value,e.base||emptySplitDefinition());}
 startNew(){if(this.locked)return false;this.emit({editor:{id:null,value:emptySplitDefinition(),base:null,conflicts:[]},error:''});return true;}
 edit(id:string){if(this.locked)return false;const d=this.state.base?.settings.custom.find(x=>x.id===id);if(!d)return false;this.emit({editor:{id,value:input(d),base:input(d),conflicts:[]},error:''});return true;}
 setField<K extends keyof SplitDefinitionInput>(field:K,value:SplitDefinitionInput[K]){const e=this.state.editor;if(this.locked||!e)return;this.emit({editor:{...e,value:{...e.value,[field]:structuredClone(value)}},error:''});}
 cancelEditor(discard=false){if(this.state.pending||this.state.unknown||!this.current()||this.dirty&&!discard)return false;this.emit({editor:null,error:''});return true;}
 resolveConflicts(choice:'mine'|'saved'){
  const e=this.state.editor;if(this.locked||!e?.conflicts.length)return;
  const d=this.state.base?.settings.custom.find(x=>x.id===e.id);if(!d){if(choice==='saved')this.emit({editor:null});return;}
  const value={...e.value};if(choice==='saved')for(const field of e.conflicts as (keyof SplitDefinitionInput)[])Object.assign(value,{[field]:structuredClone(d[field])});this.emit({editor:{...e,value,base:input(d),conflicts:[]},error:''});
 }
 copyDeletedAsNew(){const e=this.state.editor;if(!this.locked&&e?.conflicts.includes('deleted'))this.emit({editor:{id:null,value:input(e.value),base:null,conflicts:[]},error:''});}
 private readJournal(){return checkedJournal(this.storage.getItem(this.storageKey),this.accountId);}
 private store(j:Journal){const existing=this.readJournal();if(existing&&(stableSplitJSON(existing.request)!==stableSplitJSON(j.request)||existing.receipt&&stableSplitJSON(existing.receipt)!==stableSplitJSON(j.receipt))){this.journal=existing;throw Error('The saved Split Inbox intent was replaced. Check the earlier action before continuing.');}const raw=JSON.stringify(j);this.storage.setItem(this.storageKey,raw);if(this.storage.getItem(this.storageKey)!==raw)throw Error('The Split Inbox action could not be saved in this browser. No new action was sent.');this.journal=j;}
 private clear(request:SplitSaveRequest,receipt?:SplitSaveResponse['receipt']){const saved=this.readJournal();if(saved&&stableSplitJSON(saved.request)!==stableSplitJSON(request)||receipt&&(!saved?.receipt||stableSplitJSON(saved.receipt)!==stableSplitJSON(receipt))||!receipt&&!!saved?.receipt){if(saved)this.journal=saved;this.emit({unknown:true,error:'Another Split Inbox action is awaiting confirmation. Check its status.'});return false;}if(saved){this.storage.removeItem(this.storageKey);if(this.storage.getItem(this.storageKey)!==null)throw Error('The confirmed action could not be released from this browser. Check status again.');}this.journal=null;return true;}
 private checkCurrent(base:SplitConfigurationResponse){const known=this.state.base;if(!known)return;if(base.settings.revision<known.settings.revision)throw Error('An older Split Inbox configuration was returned. Refresh again.');if(known.settings.persisted&&base.settings.revision===known.settings.revision&&stableSplitJSON(base.settings)!==stableSplitJSON(known.settings))throw Error('The saved Split Inbox settings changed without a new revision. Keep your current settings and refresh.');}
 async load():Promise<boolean>{
  if(!this.current()||this.state.pending==='saving'||this.state.pending==='checking')return false;
  try{const saved=this.readJournal();if(saved){this.journal=saved;return await this.recover();}if(this.state.unknown)return false;}catch(e){this.emit({unknown:true,error:message(e)});return false;}
  const epoch=this.epoch,read=++this.reads;this.abort?.abort();this.abort=new AbortController();this.emit({pending:'loading',error:''});
  try{const base=checkedSplitConfiguration(await this.request('/split-inboxes?accountId='+encodeURIComponent(this.accountId),undefined,'GET',{signal:this.abort.signal}),this.accountId);if(!this.current(epoch)||read!==this.reads)return false;this.checkCurrent(base);const editor=this.state.editor?rebase(this.state.editor,base):null;this.emit({base,editor,views:null,pending:null,needsReload:false,error:''});void this.loadViews();return true;}catch(e){if(this.current(epoch)&&read===this.reads)this.emit({pending:null,error:message(e),needsReload:!!this.state.base});return false;}
 }
 async loadViews():Promise<boolean>{
  const base=this.state.base;if(!this.current()||!base)return false;const epoch=this.epoch,read=++this.viewsRead;this.viewsAbort?.abort();this.viewsAbort=new AbortController();this.emit({viewsLoading:true,viewsError:''});
  try{const views=checkedSplitViews(await this.request('/split-inboxes/views?accountId='+encodeURIComponent(this.accountId),undefined,'GET',{signal:this.viewsAbort.signal}),base);if(!this.current(epoch)||read!==this.viewsRead||this.state.base!==base)return false;if(this.state.views&&views.sourceGeneration<this.state.views.sourceGeneration)throw Error('The Split Inbox counts are older than the current view.');this.emit({views,viewsLoading:false,viewsError:''});return true;}catch(e){if(this.current(epoch)&&read===this.viewsRead)this.emit({viewsLoading:false,viewsError:message(e)});return false;}
 }
 private async accepted(value:unknown,j:Journal,epoch:number):Promise<boolean>{
  const response=await checkedSplitSave(value,j.request);if(!this.current(epoch)||this.journal?.request.clientRequestId!==j.request.clientRequestId)return false;
  if(j.receipt&&stableSplitJSON(j.receipt)!==stableSplitJSON(response.receipt))throw Error('The earlier Split Inbox receipt changed. Keep its saved intent for review.');
  const saved=this.readJournal();if(saved&&stableSplitJSON(saved.request)!==stableSplitJSON(j.request)){this.journal=saved;this.emit({pending:null,unknown:true,error:'A newer Split Inbox action is awaiting confirmation.'});return false;}
  this.store({...j,receipt:response.receipt});
  const current=checkedSplitConfiguration(await this.request('/split-inboxes?accountId='+encodeURIComponent(this.accountId),undefined,'GET',{signal:this.abort?.signal}),this.accountId);if(!this.current(epoch))return false;
  if(current.settings.revision<response.receipt.acceptedRevision||this.state.base&&current.settings.revision<this.state.base.settings.revision)throw Error('The accepted settings are not yet available. Check status again.');
  if(current.settings.revision===response.receipt.acceptedRevision&&stableSplitJSON(current.settings)!==stableSplitJSON(response.settings))throw Error('The accepted settings changed without a new revision. Check status again.');this.checkCurrent(current);if(!this.clear(j.request,response.receipt)){this.emit({pending:null});return false;}
  this.emit({base:current,views:null,editor:null,pending:null,unknown:false,needsReload:false,error:'',lastReceipt:response.receipt});void this.loadViews();return true;
 }
 async recover():Promise<boolean>{
  if(!this.current()||this.state.pending==='saving'||this.state.pending==='checking')return false;let j:Journal|null;try{j=this.readJournal();if(!j){if(this.state.unknown)throw Error('The earlier Split Inbox intent is missing. Its outcome cannot be established.');return false;}}catch(e){this.emit({unknown:true,error:message(e)});return false;}
  this.journal=j;const epoch=this.epoch;this.abort?.abort();this.abort=new AbortController();this.emit({pending:'checking',unknown:true,error:''});
  try{return await this.accepted(await this.request('/split-inboxes/requests/by-request/'+encodeURIComponent(j.request.clientRequestId)+'?accountId='+encodeURIComponent(this.accountId),undefined,'GET',{signal:this.abort.signal}),j,epoch);}catch(e){if(this.current(epoch))this.emit({pending:null,unknown:true,error:message(e)});return false;}
 }
 async save(changes:SplitChange[]):Promise<boolean>{
  const base=this.state.base;if(this.locked||!base||!changes.length)return false;let j:Journal;
  try{const saved=this.readJournal();if(saved){this.journal=saved;this.emit({unknown:true,error:'Check the earlier Split Inbox action before saving another.'});return false;}j={version:1,request:{accountId:this.accountId,clientRequestId:this.makeKey(),expectedRevision:base.settings.revision,expectedBasisFingerprint:base.settings.effectiveBasis.fingerprint,changes:structuredClone(changes)}};this.store(j);}catch(e){let unknown=!!this.journal||this.state.unknown;try{const saved=this.readJournal();if(saved){this.journal=saved;unknown=true;}}catch{unknown=true;}this.emit({error:message(e),unknown});return false;}
  const epoch=this.epoch;this.reads++;this.abort?.abort();this.abort=new AbortController();this.emit({pending:'saving',error:'',lastReceipt:null});
  try{return await this.accepted(await this.request('/split-inboxes',j.request,'PATCH',{signal:this.abort.signal}),j,epoch);}catch(e){if(!this.current(epoch))return false;const definite=!this.journal?.receipt&&e instanceof ApiError&&(e.status===404&&e.code==='split_not_found'||[400,422].includes(e.status)&&(e.code||'').startsWith('split_')||e.status===409&&['split_revision_conflict','split_basis_conflict','split_request_conflict','split_name_conflict'].includes(e.code||''));if(definite){try{if(this.clear(j.request))this.emit({pending:null,unknown:false,needsReload:['split_revision_conflict','split_basis_conflict'].includes(e.code||''),error:message(e)});else this.emit({pending:null});}catch(clearError){this.emit({pending:null,unknown:true,error:message(clearError)})}}else this.emit({pending:null,unknown:true,error:message(e)});return false;}
 }
 async saveEditor(){const e=this.state.editor;if(!e||e.conflicts.length)return false;const value={...input(e.value),name:e.value.name.trim(),query:e.value.query.trim()};if(!value.name){this.emit({error:'Enter a Split Inbox name.'});return false;}if(!value.query&&!value.autoLabelIds.length){this.emit({error:'Enter a definition for this Split Inbox.'});return false;}if(!e.id)return this.save([{type:'create',value}]);const changes=Object.fromEntries(fields.filter(k=>!sameSplitValue(value[k],e.base?.[k])).map(k=>[k,value[k]]));if(!Object.keys(changes).length)return this.cancelEditor(true);return this.save([{type:'update',id:e.id,changes}]);}
 async setEnabled(id:string,enabled:boolean){return this.save([{type:'update',id,changes:{enabled}}]);}
 async remove(id:string){return this.save([{type:'delete',id}]);}
 async reorder(order:SplitViewRef[]){return this.save([{type:'reorder',order}]);}
}
