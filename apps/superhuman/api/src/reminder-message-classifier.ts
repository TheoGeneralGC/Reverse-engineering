// Private server-only projection. Caller verifies witness MAC/DB authority.
// This module never establishes that authority from message headers.
export type Scope={accountId:string;accountVersion:string;providerThreadId:string};
export type Message={id:string;threadId:string;labelIds?:string[];payload:{headers?:{name:string;value:string}[]}};
export type OwnedWitness=Scope & {version:1;providerMessageId:string;reminderRef:string;generation:number;attemptRef:string;anchorProviderMessageId:string;proofHash:string};
export type OriginalFacts={reminderId:string;anchorProviderMessageId:string;source:'USER'};
export type Classification=
 | {kind:'ordinary';draft:boolean}
 | {kind:'original-reminder-candidate';draft:false;facts:OriginalFacts}
 | {kind:'owned-reminder-witness';draft:false;witness:OwnedWitness}
 | {kind:'indeterminate';draft:boolean;reason:string};
export type Projection={raw:readonly Message[];classified:readonly {message:Message;classification:Classification}[];visible:readonly Message[];lastReal:Message|null;assessment:'clear'|'indeterminate'};
const encoder=new TextEncoder(),hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(v);
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&encoder.encode(v).length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const ref=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const original=['x-superhuman-triggered-reminder-id','x-superhuman-triggered-reminder-last-message-id','x-superhuman-triggered-reminder-source'];
const owned=['x-reconstruction-reminder-id','x-reconstruction-reminder-attempt-id','x-reconstruction-reminder-last-message-id','x-reconstruction-reminder-mac'];
function assertScope(s:Scope){if(!s||!text(s.accountId,512)||!hash(s.accountVersion)||!id(s.providerThreadId))throw Error('classifier_scope');}
const unknown=(draft:boolean,reason:string):Classification=>({kind:'indeterminate',draft,reason});
export function classifyReminderMessage(scope:Scope,message:Message,witness:OwnedWitness|null=null):Classification{
 assertScope(scope);const draft=Array.isArray(message?.labelIds)&&message.labelIds.includes('DRAFT');
 if(!message||!id(message.id)||message.threadId!==scope.providerThreadId||!message.payload||!Array.isArray(message.payload.headers)||message.payload.headers.length>256||message.labelIds!==undefined&&(!Array.isArray(message.labelIds)||message.labelIds.length>100||message.labelIds.some(x=>!text(x,256))))return unknown(draft,'message-incomplete');
 const headers=new Map<string,string[]>();let bytes=0;
 for(const h of message.payload.headers){if(!h||typeof h.name!=='string'||!/^[A-Za-z0-9-]{1,128}$/.test(h.name)||typeof h.value!=='string'||h.value.length>16384||encoder.encode(h.value).length>16384||h.value.includes('\0'))return unknown(draft,'headers-invalid');bytes+=encoder.encode(h.name).length+encoder.encode(h.value).length;if(bytes>65536)return unknown(draft,'headers-limit');const k=h.name.toLowerCase();headers.set(k,[...(headers.get(k)??[]),h.value]);}
 const hasOriginal=original.some(k=>headers.has(k)),hasOwned=owned.some(k=>headers.has(k));
 if(draft)return witness?unknown(true,'draft-witness'):{kind:'ordinary',draft:true};
 if(hasOriginal&&hasOwned)return unknown(false,'mixed-markers');
 const exact=(keys:string[])=>keys.every(k=>headers.get(k)?.length===1),get=(k:string)=>headers.get(k)?.[0];
 if(hasOwned||witness){
  if(!witness)return unknown(false,'owned-authority-missing');
  if(!hasOwned||!exact(owned))return unknown(false,'owned-markers-invalid');
  if(witness.version!==1||witness.accountId!==scope.accountId||witness.accountVersion!==scope.accountVersion||witness.providerThreadId!==scope.providerThreadId||witness.providerMessageId!==message.id||!ref(witness.reminderRef)||!ref(witness.attemptRef)||!Number.isSafeInteger(witness.generation)||witness.generation<0||!id(witness.anchorProviderMessageId)||!hash(witness.proofHash)||get(owned[0])!==witness.reminderRef||get(owned[1])!==witness.attemptRef||get(owned[2])!==witness.anchorProviderMessageId||!hash(get(owned[3])))return unknown(false,'owned-binding-invalid');
  return{kind:'owned-reminder-witness',draft:false,witness:{...witness}};
 }
 if(hasOriginal){
  if(!exact(original)||!uuid(get(original[0]))||!id(get(original[1]))||get(original[2])!=='USER')return unknown(false,'original-markers-invalid');
  return{kind:'original-reminder-candidate',draft:false,facts:{reminderId:get(original[0])!,anchorProviderMessageId:get(original[1])!,source:'USER'}};
 }
 return{kind:'ordinary',draft:false};
}
export function projectReminderMessages(scope:Scope,messages:readonly Message[],witnesses:readonly OwnedWitness[]=[]):Projection{
 assertScope(scope);if(!Array.isArray(messages)||messages.length>200||!Array.isArray(witnesses)||witnesses.length>200)throw Error('classifier_message_limit');
 const positions=new Map<string,number[]>(),proofs=new Map<string,OwnedWitness[]>();messages.forEach((m,i)=>positions.set(m?.id,[...(positions.get(m?.id)??[]),i]));
 for(const w of witnesses){if(!w||!id(w.providerMessageId))throw Error('classifier_witness');proofs.set(w.providerMessageId,[...(proofs.get(w.providerMessageId)??[]),w]);}
 const classified=messages.map((message,index)=>{const draft=Array.isArray(message?.labelIds)&&message.labelIds.includes('DRAFT'),ws=proofs.get(message?.id)??[];let classification:Classification=positions.get(message?.id)!.length!==1?unknown(draft,'duplicate-message'):ws.length>1?unknown(draft,'duplicate-witness'):classifyReminderMessage(scope,message,ws[0]??null);
  if(classification.kind==='original-reminder-candidate'||classification.kind==='owned-reminder-witness'){const anchor=classification.kind==='original-reminder-candidate'?classification.facts.anchorProviderMessageId:classification.witness.anchorProviderMessageId;const at=positions.get(anchor);if(!at||at.length!==1||at[0]>=index)classification=unknown(false,'anchor-not-earlier');}
  return{message,classification};});
 const visible=classified.filter(x=>x.classification.kind==='ordinary'||x.classification.kind==='indeterminate').map(x=>x.message);let lastReal:Message|null=null;
 for(const x of classified){if(x.classification.kind==='ordinary'&&!x.classification.draft)lastReal=x.message;else if(x.classification.kind==='indeterminate'&&!x.classification.draft)lastReal=null;}
 return{raw:[...messages],classified,visible,lastReal,assessment:classified.some(x=>x.classification.kind==='indeterminate')?'indeterminate':'clear'};
}
