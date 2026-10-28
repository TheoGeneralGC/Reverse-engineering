import type { Thread } from './api.ts';

export type ContactIdentity={name:string;email:string};
export type ContactContext={accountId:string;draftId:string|null;threadId:string|null;mode:string};
export type ContactRecentThread={id:string;accountId:string;subject:string;lastMessageAt:string};
export type ContactSummary={contact:ContactIdentity;threads:ContactRecentThread[];matched:boolean;source:'local-message-participants';limited:true};
export type ContactSource='commit'|'selection'|'suggestion'|'backspace'|'message'|'author';
export type ContactSnapshot={context:ContactContext|null;contact:ContactIdentity|null;source:ContactSource|null;threads:ContactRecentThread[];loading:boolean;error:string};
export type ContactRequest=(context:{accountId:string;email:string;excludeThreadId?:string},signal:AbortSignal)=>Promise<ContactSummary>;
export const contactContextKey=(context:ContactContext)=>JSON.stringify([context.accountId,context.draftId,context.threadId,context.mode]);
function canonicalContactEmail(value:string){
 const text=value.normalize('NFKC').trim().toLowerCase(),parts=text.split('@');if(parts.length!==2||/[\p{Cc}\p{Cf}]/u.test(text))return;
 const [local,rawDomain]=parts;if(!local||local.length>64||local.startsWith('.')||local.endsWith('.')||local.includes('..')||!/^[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+$/u.test(local)||!rawDomain)return;
 try{
  const labels=rawDomain.replace(/[。．｡]/gu,'.').split('.').map(label=>{
   if(/^[\x00-\x7f]*$/.test(label))return label;
   // Append a fixed DNS suffix so URL's IDNA conversion cannot reinterpret a
   // numeric mailbox label as an IPv4 host. Strip only that exact suffix.
   const host=new URL('http://'+label+'.invalid').hostname;return host.endsWith('.invalid')?host.slice(0,-8):'';
  });
  if(!labels.every(label=>/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label)))return;
  const domain=labels.join('.'),email=local+'@'+domain;return domain.length<=253&&new TextEncoder().encode(email).length<=254?email:undefined;
 }catch{return}
}
export function contactEmailKey(value:string){return canonicalContactEmail(value)||value.normalize('NFKC').trim().toLowerCase()}
export function messageContact(message:Thread['messages'][number],selfEmail:string):ContactIdentity|null{
 const isSelf=(person:ContactIdentity)=>person.email.toLowerCase()===selfEmail.toLowerCase();
 return (!isSelf(message.sender)?message.sender:[...message.to,...message.cc||[]].find(person=>!isSelf(person)))||message.sender||null;
}
export function createContactContext(dependencies:{request:ContactRequest;isCurrent?:(context:ContactContext)=>boolean}){
 let state:ContactSnapshot={context:null,contact:null,source:null,threads:[],loading:false,error:''},revision=0,selectionRevision=0,disposed=false,paused=false,controller:AbortController|null=null;
 const listeners=new Set<()=>void>(),publish=(patch:Partial<ContactSnapshot>)=>{if(disposed)return;state={...state,...patch};for(const listener of listeners)listener()},cancel=()=>{revision++;controller?.abort();controller=null};
 const read=()=>{
  if(disposed||paused)return;cancel();const context=state.context,contact=state.contact;if(!context||!contact||context.mode!=='mail')return;
  // Malformed draft recipients still have a visible fallback, but no metadata
  // request should turn that incomplete address into a fabricated profile.
  if(!canonicalContactEmail(contact.email)){publish({threads:[],loading:false,error:''});return}
  const generation=revision,requestController=new AbortController();controller=requestController;publish({threads:[],loading:true,error:''});
  const current=()=>!disposed&&!requestController.signal.aborted&&revision===generation&&state.context!==null&&contactContextKey(state.context)===contactContextKey(context)&&state.contact?.email===contact.email&&(!dependencies.isCurrent||dependencies.isCurrent(context));
  void dependencies.request({accountId:context.accountId,email:contact.email,...(context.threadId?{excludeThreadId:context.threadId}:{})},requestController.signal).then(result=>{
   if(!current())return;
   if(contactEmailKey(result.contact.email)!==contactEmailKey(contact.email)||result.threads.some(thread=>thread.accountId!==context.accountId))throw new Error('Contact response did not match the selected account and address');
   const seen=new Set<string>(),threads=result.threads.filter(thread=>thread.accountId===context.accountId&&thread.id!==context.threadId&&!seen.has(thread.id)&&!!seen.add(thread.id)).slice(0,4).map(({id,accountId,subject,lastMessageAt})=>({id,accountId,subject,lastMessageAt}));
   const name=contact.name||(result.matched?result.contact.name:'');publish({contact:name!==contact.name?{...contact,name}:state.contact,threads,loading:false,error:''});
  }).catch(error=>{if(current())publish({threads:[],loading:false,error:error instanceof Error?error.message:'Could not load recent mail'})});
 };
 return{
  getSnapshot:()=>state,getSelectionRevision:()=>selectionRevision,subscribe(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener)},
  setContext(context:ContactContext,options:{preserveContact?:boolean}={}){
   if(disposed||state.context&&contactContextKey(state.context)===contactContextKey(context))return;
   const prior=state.context,sameAccount=prior?.accountId===context.accountId,sameView=prior?.draftId===context.draftId&&prior?.threadId===context.threadId;
   const retain=sameAccount&&(sameView||!!options.preserveContact&&!context.draftId);
   selectionRevision++;cancel();publish({context,contact:retain?state.contact:null,source:retain?state.source:null,threads:[],loading:false,error:''});read();
  },
  select(contact:ContactIdentity,source:ContactSource){
   if(disposed||paused||!state.context||!contact.email.includes('@')&&source!=='author')return;
   const next={name:contact.name||'',email:contact.email.trim()};if(!next.email)return;
   if(state.contact?.email===next.email&&state.contact.name===next.name)return;
   selectionRevision++;cancel();publish({contact:next,source,threads:[],loading:false,error:''});read();
  },
  clear(){selectionRevision++;cancel();publish({contact:null,source:null,threads:[],loading:false,error:''})},retry:read,isActive:()=>!disposed&&!paused,
  suspend(){paused=true;cancel()},resume(){if(disposed)return;paused=false;read()},
  dispose(){cancel();disposed=true;listeners.clear()},
 };
}
