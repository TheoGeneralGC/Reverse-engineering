import {createHash} from 'node:crypto';
import {decodeWords} from 'postal-mime';
import type {Store} from './store.ts';
import {HttpError,type Account,type Message,type Thread} from './types.ts';
import {stable} from './reminder-contract.ts';
import {currentAccountIncarnation} from './account-incarnation.ts';
import {projectReminderMessages,type Scope,type OwnedWitness,type Classification} from './reminder-message-classifier.ts';
import type {ReminderHeaderFacts,MessagePresentation,ThreadPresentation} from './message-presentation.ts';
import {parseOutgoingRecipientHeader} from './outgoing-recipients.ts';
import {gmailSnippetToText} from './gmail-snippet.ts';
import {GMAIL_SCOPE} from './google-scopes.ts';
const hash=(v:unknown)=>createHash('sha256').update(stable(JSON.parse(JSON.stringify(v)))).digest('hex');
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
type FullScope={accountId:string;accountVersion:string|null;providerThreadId:string};
export type MessageWitnessAuthority=(scope:Scope,thread:Thread)=>OwnedWitness[];
export function messageSourceValue(message:Message){const{providerLabels:_labels,trackingRead:_tracking,reminderPresentation:_hint,reminderContactEligible:_contact,...content}=message;if(content.reminderHeaderFacts){const{snippet:_display,...facts}=content.reminderHeaderFacts;return{...content,reminderHeaderFacts:facts}}return content}
const headerFingerprint=(facts:Omit<ReminderHeaderFacts,'fingerprint'>)=>{const{snippet:_display,...basis}=facts;return hash(basis)};
export function messageContentHash(message:Message){const{reminderHeaderFacts:_facts,reminderPresentation:_hint,reminderContactEligible:_contact,providerLabels:_labels,trackingRead:_tracking,...content}=message;return hash(content)}
function boundedHeaders(value:unknown):{name:string;value:string}[]|null{
 if(!Array.isArray(value)||value.length>256)return null;let bytes=0;
 for(const h of value){if(!h||typeof h.name!=='string'||!/^[A-Za-z0-9-]{1,128}$/.test(h.name)||typeof h.value!=='string'||Buffer.byteLength(h.value)>16384||h.value.includes('\0'))return null;bytes+=Buffer.byteLength(h.name)+Buffer.byteLength(h.value);if(bytes>65536)return null}
 return value.map(h=>({name:h.name,value:h.value}));
}
function decodedSubject(headers:{name:string;value:string}[]){const fields=headers.filter(h=>h.name.toLowerCase()==='subject');if(fields.length>1)return null;try{const value=fields.length?decodeWords(fields[0].value):'';return Buffer.byteLength(value)<=16384&&!/[\r\n\0]/.test(value)?value:null}catch{return null}}
function singletonAuthor(headers:{name:string;value:string}[]){const from=headers.filter(h=>h.name.toLowerCase()==='from');if(from.length!==1)return null;try{const values=parseOutgoingRecipientHeader(from[0].value);return values.length===1?values[0].email.toLowerCase():null}catch{return null}}
/** Only an actual FULL resource caller may use this. Metadata normalization does
 * not call it and absence is unknown, even if selected headers look ordinary. */
export function captureFullHeaderFacts(scope:FullScope,raw:{id:string;snippet?:string;payload?:{headers?:unknown}},message:Message):ReminderHeaderFacts{
 const bounded=boundedHeaders(raw.payload?.headers),base:Omit<ReminderHeaderFacts,'fingerprint'>={version:1,coverage:bounded?'full':'unknown',accountId:scope.accountId,accountVersion:scope.accountVersion,providerThreadId:scope.providerThreadId,providerMessageId:raw.id,headers:bounded??[],subject:bounded?decodedSubject(bounded):null,singleAuthor:bounded?singletonAuthor(bounded):null,snippet:typeof raw.snippet==='string'?gmailSnippetToText(raw.snippet).slice(0,4096):'',contentHash:messageContentHash(message),reason:bounded?null:'headers-incomplete'};
 return{...base,fingerprint:headerFingerprint(base)};
}
function checkedFacts(scope:Scope,message:Message):ReminderHeaderFacts|null{
 const f=message.reminderHeaderFacts;if(!f||f.version!==1||f.coverage!=='full'||f.accountId!==scope.accountId||f.accountVersion!==scope.accountVersion||f.providerThreadId!==scope.providerThreadId||f.providerMessageId!==message.id||f.contentHash!==messageContentHash(message))return null;
 const{fingerprint,...base}=f,headers=boundedHeaders(f.headers);if(!hex(fingerprint)||headerFingerprint(base)!==fingerprint||!headers||f.subject!==decodedSubject(headers)||f.singleAuthor!==singletonAuthor(headers))return null;return f;
}
export function mailHeaderGrant(store:Store,accountId:string){const g=store.get<{accountId?:string;service?:string;outcome?:string;grantedScopes?:string[]}>('googleGrant','mail:'+accountId);return !!g&&g.accountId===accountId&&g.service==='mail'&&['granted','partial'].includes(g.outcome??'')&&Array.isArray(g.grantedScopes)&&g.grantedScopes.length<=128&&g.grantedScopes.every(s=>typeof s==='string')&&['response','requested','token-cache'].includes((g as {scopeSource?:string}).scopeSource??'')&&g.grantedScopes.some(s=>s===GMAIL_SCOPE||s==='https://mail.google.com/')}
export function threadSourceVersion(thread:Thread){return hash({id:thread.id,accountId:thread.accountId,providerId:thread.providerId??null,subject:thread.subject,messages:thread.messages.map(messageSourceValue)})}
export function projectStoredMessages(store:Store,thread:Thread){
 const account=store.get<Account>('account',thread.accountId),synthetic=account?.provider==='demo',hints=new Map<string,MessagePresentation>();let version:string|null=null;
 if(account?.provider==='google')try{version=currentAccountIncarnation(store,account.id)}catch{}
 const scope=version&&thread.providerId?{accountId:thread.accountId,accountVersion:version,providerThreadId:thread.providerId}:null;
 let classified:{message:Message;classification:Classification|{kind:'unknown';draft:boolean}}[],coverage:'full'|'unknown'|'synthetic';
 if(synthetic){coverage='synthetic';classified=thread.messages.map(message=>({message,classification:{kind:'ordinary',draft:!!message.providerLabels?.includes('DRAFT')}}))}
 else if(!scope||thread.messages.length>200){coverage='unknown';classified=thread.messages.map(message=>({message,classification:{kind:'unknown',draft:!!message.providerLabels?.includes('DRAFT')}}))}
 else{
  const raw=thread.messages.map(m=>({id:m.id,threadId:scope.providerThreadId,labelIds:m.providerLabels,payload:{headers:checkedFacts(scope,m)?.headers}})),witnesses=store.messageWitnesses(scope,thread),projection=projectReminderMessages(scope,raw,witnesses);
  classified=projection.classified.map((x,i)=>({message:thread.messages[i],classification:x.classification}));coverage=thread.messages.every(m=>checkedFacts(scope,m))?'full':'unknown';
 }
 let lastReal:Message|null=null,assessment:'clear'|'indeterminate'='clear';
 for(const x of classified){const c=x.classification,m=x.message,full=scope?checkedFacts(scope,m):null,ordinary=c.kind==='ordinary',hidden=c.kind==='original-reminder-candidate'||c.kind==='owned-reminder-witness';
  const invalidAuthor=ordinary&&!synthetic&&(!full?.singleAuthor||full.singleAuthor!==m.sender.email.toLowerCase()||full.subject===null),kind:MessagePresentation['kind']=!synthetic&&!full?'unknown':c.kind==='original-reminder-candidate'?'system-original':c.kind==='owned-reminder-witness'?'system-owned':c.kind==='unknown'?'unknown':c.kind==='indeterminate'||invalidAuthor?'indeterminate':'ordinary';
  const hint:MessagePresentation={version:1,kind,coverage:synthetic?'synthetic':full?'full':'unknown',hidden,subject:synthetic?thread.subject:full?.subject??null};hints.set(m.id,hint);
  if(kind==='ordinary'&&!c.draft)lastReal=m;else if(kind==='unknown'||kind==='indeterminate'){assessment='indeterminate';if(!c.draft)lastReal=null}
 }
 const granted=synthetic||mailHeaderGrant(store,thread.accountId),available=!!lastReal&&coverage!=='unknown'&&granted;
 const presentation:ThreadPresentation={version:1,coverage,replyAvailability:available?'available':'unavailable',lastRealMessageId:available?lastReal!.id:null,versionHash:hash({source:threadSourceVersion(thread),accountVersion:version,coverage,classified:[...hints],granted}),requiresHydration:!synthetic&&coverage==='unknown',reason:available?null:!granted?'mail-grant-unavailable':coverage==='unknown'?'full-headers-unavailable':'reply-source-unavailable'};
 return{raw:thread.messages,visible:thread.messages.filter(m=>!hints.get(m.id)?.hidden),lastReal,hints,assessment,presentation,scope};
}
export function presentationThread(store:Store,thread:Thread):Thread{
 const p=projectStoredMessages(store,thread),last=p.lastReal,hint=last?p.hints.get(last.id):null;
 return{...thread,reminderContactEligible:!!last,...(last?{subject:hint?.subject||'(no subject)',sender:last.sender,reminderContactAt:last.date,snippet:last.reminderHeaderFacts?.snippet??thread.snippet,participants:[...new Map(p.visible.filter(m=>p.hints.get(m.id)?.kind==='ordinary').flatMap(m=>[m.sender,...m.to,...m.cc??[]]).map(person=>[person.email,person])).values()]}:{}),messages:thread.messages.map(m=>({...m,reminderContactEligible:p.hints.get(m.id)?.kind==='ordinary',reminderPresentation:p.hints.get(m.id)!}))};
}
export function publicThread(store:Store,thread:Thread):Thread{
 const p=projectStoredMessages(store,thread),last=p.lastReal,hint=last?p.hints.get(last.id):null;
 const{reminderContactAt:_contactAt,reminderContactEligible:_contactEligible,...wire}=thread;return{...wire,...(last?{subject:hint?.subject||'(no subject)',sender:last.sender}:{}),reminderPresentation:p.presentation,messages:thread.messages.map(m=>{const{reminderHeaderFacts:_private,reminderContactEligible:_contact,reminderPresentation:_hint,...value}=m;return{...value,reminderPresentation:p.hints.get(m.id)!}})};
}
export function requireReplySource(store:Store,thread:Thread):Message{const p=projectStoredMessages(store,thread);if(!p.lastReal||p.presentation.replyAvailability!=='available')throw new HttpError(409,'Refresh this conversation before creating a reply','reply_source_unavailable');return p.lastReal}

/** Every JSON transport uses this structural projection, including embedded
 * Thread snapshots/resources. No private fields are serialized via plain nested
 * objects even when they are not complete Thread DTOs. */
export function publicWireValue(store:Store,value:unknown):unknown{const seen=new WeakMap<object,unknown>();const visit=(v:any):any=>{if(!v||typeof v!=='object'||v instanceof Date||v instanceof Uint8Array)return v;if(seen.has(v))return seen.get(v);if(Array.isArray(v)){const out:any[]=[];seen.set(v,out);for(const x of v)out.push(visit(x));return out}const isThread=typeof v.id==='string'&&typeof v.accountId==='string'&&typeof v.subject==='string'&&Array.isArray(v.messages)&&v.sender&&Array.isArray(v.participants)&&typeof v.lastMessageAt==='string'&&typeof v.unread==='boolean'&&typeof v.starred==='boolean'&&typeof v.folder==='string'&&Array.isArray(v.labels),source=isThread?publicThread(store,v as Thread):v,out:Record<string,unknown>={};seen.set(v,out);for(const[k,x]of Object.entries(source))if(!['reminderHeaderFacts','reminderContactEligible','reminderContactAt'].includes(k))out[k]=visit(x);return out};return visit(value)}
