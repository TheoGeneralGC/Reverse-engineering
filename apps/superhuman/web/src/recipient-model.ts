export type RecipientField='to'|'cc'|'bcc';
export type RecipientHeaders=Record<RecipientField,string>;
export type Recipient={id:string;name:string;email:string;raw:string;valid:boolean};
export type RecipientFieldState={tokens:Recipient[];input:string;editing:number|null;selected:number[];edge:number|null};
export type RecipientState={fields:Record<RecipientField,RecipientFieldState>;active:RecipientField;expanded:boolean};
export const recipientFields:RecipientField[]=['to','cc','bcc'];
let sequence=0;
export function validRecipientEmail(email:string){return email.length<=900&&!/[\x00-\x1f\x7f]/.test(email)&&/^[^\s@<>,;"\\]+@[^\s@<>,;"\\]+\.[^\s@<>,;"\\]+$/.test(email)}
export function formatRecipient(contact:{name?:string;email:string}){
 const name=contact.name?.trim()||'';if(!name||name===contact.email)return contact.email;
 return `${/^[\p{L}\p{N} $%&'*+.\-/=?^_`{}|~]+$/u.test(name)?name:'"'+name.replace(/["\\]/g,char=>'\\'+char)+'"'} <${contact.email}>`;
}
export function parseRecipient(raw:string):Recipient{
 raw=raw.trim();const bracket=raw.indexOf('@')>0?raw.match(/^(.*?)\s*<([^<>]+)>$/):null,email=(bracket?bracket[2]:raw).trim();
 let name=bracket?.[1]?.trim()||'';if(name.startsWith('"')&&name.endsWith('"'))name=name.slice(1,-1).replace(/\\(["\\])/g,'$1');
 let quoted=false,escaped=false,depth=0,pairs=0,syntax=true;
 for(const char of raw){
  if(escaped){escaped=false;continue}
  if(quoted&&char==='\\'){escaped=true;continue}
  if(char==='"'){quoted=!quoted;continue}
  if(!quoted&&char==='<'){if(depth||pairs)syntax=false;depth++;pairs++}
  if(!quoted&&char==='>'){if(depth!==1)syntax=false;depth--}
 }
 return{id:`recipient-${++sequence}`,name,email,raw,valid:validRecipientEmail(email)&&!/[\x00-\x1f\x7f]/.test(raw)&&syntax&&!quoted&&!escaped&&depth===0&&pairs<=1};
}
export function recipientLabel(contact:Recipient){
 if(!contact.valid)return contact.raw;
 if(!contact.name)return contact.email.toLowerCase();
 // Observed presentation of a simple "Last, First" name is "First Last".
 // Keep authored name/raw fields intact; provider storage normalization is unknown.
 return /^[^\s,.]+,[^,]+$/.test(contact.name)?contact.name.split(',').reverse().map(part=>part.trim()).join(' '):contact.name;
}
export function splitRecipientText(text:string,whitespace=false,preserveInvalidDelimiters=false){
 const result:string[]=[];let part='',quoted=false,escaped=false,angle=0;
 for(let index=0;index<text.length;index++){const char=text[index];
  if(escaped){part+=char;escaped=false;continue}
  if(quoted&&char==='\\'){part+=char;escaped=true;continue}
  if(char==='"')quoted=!quoted;
  if(!quoted&&char==='<')angle++;
  if(!quoted&&char==='>')angle=Math.max(0,angle-1);
  if(!quoted&&!angle&&([',',';','\r','\n'].includes(char)||(whitespace&&/\s/.test(char)))){if(preserveInvalidDelimiters&&[',',';'].includes(char)&&part&&!part.includes('@')&&!text.slice(index+1).trim()){part+=char;continue}if(part.trim())result.push(part.trim());part=''}else part+=char;
 }
 if(part.trim())result.push(part.trim());return result;
}
const headerRecipient=(text:string)=>{
 // Quote invalid fragments containing list delimiters on persistence so a later
 // valid address cannot be absorbed into that fragment when the draft reopens.
 if(text.startsWith('"')&&text.endsWith('"'))try{const decoded:unknown=JSON.parse(text);if(typeof decoded==='string'&&!parseRecipient(text).valid)return parseRecipient(decoded)}catch{}
 return parseRecipient(text);
};
const emptyField=(text=''):RecipientFieldState=>({tokens:splitRecipientText(text,false,true).map(headerRecipient),input:'',editing:null,selected:[],edge:null});
const copy=(state:RecipientState):RecipientState=>structuredClone(state);
function historyCopy(state:RecipientState){const next=copy(state);for(const field of recipientFields){const value=next.fields[field];value.input='';value.editing=null;value.selected=[];value.edge=null}return next}
export function recipientHeaders(state:RecipientState):RecipientHeaders{
 const encode=(raw:string)=>{const contact=parseRecipient(raw);let supported=false;try{supported=parseOutgoingRecipientHeader(raw).length===1}catch{}return supported?formatRecipient(contact):/[,;"\\<>\r\n]/.test(raw)?JSON.stringify(raw):raw};
 return Object.fromEntries(recipientFields.map(field=>{const value=state.fields[field],raw=value.tokens.map((token,index)=>encode(index===value.editing?value.input:token.raw));if(value.editing===null&&value.input.trim())raw.push(encode(value.input));return[field,raw.filter(text=>text.trim()&&text!=='""').join(', ')]})) as RecipientHeaders;
}
export function createRecipientModel(initial:RecipientHeaders){
 let state:RecipientState={fields:{to:emptyField(initial.to),cc:emptyField(initial.cc),bcc:emptyField(initial.bcc)},active:'to',expanded:!!(initial.cc.trim()||initial.bcc.trim())},locked=false;
 const past:RecipientState[]=[],future:RecipientState[]=[];
 const remember=()=>{past.push(historyCopy(state));if(past.length>100)past.shift();future.length=0};
 const current=(field:RecipientField)=>state.fields[field];
 const reset=(value:RecipientFieldState)=>{value.input='';value.editing=null;value.selected=[];value.edge=null};
 const add=(field:RecipientField,tokens:Recipient[],index:number,replace:number[]=[])=>{
  const value=current(field),keys=new Set(tokens.map(token=>token.email||token.raw));
  // Exact field-local equality follows the retained client branch. Suggestion
  // result deduplication is independently case-insensitive at the API boundary.
  const unique=tokens.filter((token,i)=>tokens.findIndex(other=>(other.email||other.raw)===(token.email||token.raw))===i);
  const before=value.tokens.slice(0,index).filter((token,i)=>!replace.includes(i)&&!keys.has(token.email||token.raw)).length;
  value.tokens=value.tokens.filter((token,i)=>!replace.includes(i)&&!keys.has(token.email||token.raw));value.tokens.splice(before,0,...unique);return{index:before,count:unique.length};
 };
 const commit=(field:RecipientField,contact?:{name:string;email:string})=>{
  if(locked)return;const value=current(field);if(value.editing===null&&!value.input.trim()&&!contact)return;
  remember();const editing=value.editing,raw=contact?formatRecipient(contact):value.input.trim();
  if(!raw){if(editing!==null)value.tokens.splice(editing,1);reset(value);return}
  const {index,count}=add(field,[parseRecipient(raw)],editing??value.tokens.length,editing===null?[]:[editing]);reset(value);
  // The original runtime keeps an edited existing chip selected and removes
  // the trailing input until navigation explicitly enters the append position.
  if(editing!==null&&count){value.selected=[index];value.edge=index}
 };
 return{
  getState:()=>copy(state),getValue:()=>recipientHeaders(state),setLocked:(value:boolean)=>{locked=value},
  validate(){
   let count=0,basicInvalid=false,unsupported=false;const invalid:RecipientField[]=[],headers=recipientHeaders(state);
   for(const field of recipientFields){
    const value=current(field),raw=value.tokens.map((token,index)=>index===value.editing?value.input:token.raw);if(value.editing===null&&value.input.trim())raw.push(value.input);
    for(const text of raw){if(!text.trim())continue;count++;if(!parseRecipient(text).valid){basicInvalid=true;if(!invalid.includes(field))invalid.push(field)}else try{if(parseOutgoingRecipientHeader(text).length!==1)throw new Error('Multiple recipients in one edit')}catch{unsupported=true;if(!invalid.includes(field))invalid.push(field)}}
    try{parseOutgoingRecipientHeader(headers[field])}catch{if(!invalid.includes(field)){unsupported=true;invalid.push(field)}}
   }
   return{valid:count>0&&!invalid.length,hasRecipients:count>0,field:invalid[0]??(count?undefined:'to' as RecipientField),...(unsupported&&!basicInvalid?{message:'This recipient format or size is unsupported. Use standard ASCII email addresses and shorter recipient lists.'}:{})};
  },
  focus(field:RecipientField){state.active=field;if(field!=='to')state.expanded=true},
  expand(){if(!locked)state.expanded=true},
  input(field:RecipientField,text:string){if(locked)return;state.active=field;current(field).input=text;if(current(field).editing===null)current(field).selected=[]},
  commit,
  select(field:RecipientField,index:number,mode:'single'|'range'|'toggle'='single'){
   if(locked)return;const value=current(field);if(value.editing!==null||value.input.trim())commit(field);state.active=field;if(!value.tokens[index])return;
   const anchor=value.edge??value.selected[0]??index;
   value.selected=mode==='range'?Array.from({length:Math.abs(index-anchor)+1},(_,i)=>Math.min(index,anchor)+i):mode==='toggle'?value.selected.includes(index)?value.selected.filter(item=>item!==index):[...value.selected,index]:[index];value.editing=null;value.input='';value.edge=index;
  },
  selectAll(field:RecipientField){if(locked)return;const value=current(field);if(value.input)return;value.selected=value.tokens.map((_,i)=>i);value.edge=value.tokens.length-1;state.active=field},
  edit(field:RecipientField,index?:number){if(locked)return;const value=current(field),rank=index??value.selected[0];if(rank===undefined||!value.tokens[rank])return;state.active=field;value.editing=rank;value.input=value.tokens[rank].raw;value.selected=[rank]},
  append(field:RecipientField){if(locked)return;commit(field);reset(current(field));state.active=field},
  remove(field:RecipientField,indices?:number[]){if(locked)return;const value=current(field),ranks=indices??(value.selected.length?value.selected:value.editing!==null?[value.editing]:value.tokens.length?[value.tokens.length-1]:[]);if(!ranks.length)return;remember();const next=Math.min(...ranks)-1;value.tokens=value.tokens.filter((_,index)=>!ranks.includes(index));reset(value);if(next>=0&&value.tokens[next]){value.selected=[next];value.edge=next}},
  arrow(field:RecipientField,direction:number,extend=false){
   if(locked)return;const value=current(field);if(value.editing!==null||value.input.trim())commit(field);state.active=field;
   const old=value.edge??(value.selected.length?value.selected[0]:value.tokens.length),next=Math.max(0,Math.min(value.tokens.length,old+direction));
   if(next===value.tokens.length){if(!extend)reset(value);return}
   if(extend){if(value.selected.includes(next))value.selected=value.selected.filter(index=>index!==old);else value.selected=[...new Set([...value.selected,next])];value.edge=next}
   else{value.selected=[next];value.edge=next;value.editing=null;value.input=''}
  },
  paste(field:RecipientField,text:string){
   if(locked)return;const value=current(field);if(value.input.trim())return;
   text=text.replace(/mailto:/gi,'').normalize('NFKC');const raw=splitRecipientText(text,!text.includes('<')),tokens=raw.map(parseRecipient),pending:string[]=[];
   while(tokens.length&&!tokens.at(-1)!.valid)pending.unshift(tokens.pop()!.raw);
   remember();const rank=value.selected.length?Math.min(...value.selected):value.editing??value.tokens.length;add(field,tokens,rank,value.selected);reset(value);value.input=pending.join(' ');state.active=field;
  },
  move(field:RecipientField,direction:number){
   if(locked)return;commit(field);const value=current(field),target=recipientFields[recipientFields.indexOf(field)+direction];if(!target||!value.selected.length)return;
   remember();const selected=value.selected.map(index=>value.tokens[index]).filter(Boolean),destination=current(target);const result=add(target,selected,destination.tokens.length);value.tokens=value.tokens.filter((_,i)=>!value.selected.includes(i));reset(value);reset(destination);destination.selected=Array.from({length:result.count},(_,i)=>result.index+i);destination.edge=destination.selected.at(-1)??null;state.active=target;state.expanded=true;
  },
  selectedText(field:RecipientField){const value=current(field);return[...value.selected].sort((a,b)=>a-b).map(index=>value.tokens[index]?.raw).filter(Boolean).join(', ')},
  undo(){if(locked||!past.length)return;future.push(historyCopy(state));state=copy(past.pop()!)},
  redo(){if(locked||!future.length)return;past.push(historyCopy(state));state=copy(future.pop()!)},
 };
}
export type RecipientModel=ReturnType<typeof createRecipientModel>;
import { parseOutgoingRecipientHeader } from '../../api/src/outgoing-recipients.ts';

