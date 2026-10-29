export const SPLIT_POLICY_VERSION='local-split-metadata-v1';
export type SplitField='subject'|'from'|'to'|'cc'|'label'|'in'|'has'|'is';
export type SplitQueryNode={kind:'term';field:SplitField;value:string}|{kind:'not';child:SplitQueryNode}|{kind:'and'|'or';children:SplitQueryNode[]};
export class SplitQueryError extends Error{readonly code:string;readonly position:number;readonly field?:string;readonly status:number;constructor(code:string,message:string,position:number,field?:string,status=400){super(message);this.code=code;this.position=position;this.field=field;this.status=status}}
type Token={kind:'word'|'open'|'close';value:string;position:number;quoted:boolean;fieldColon:number};
const bytes=(value:string)=>new TextEncoder().encode(value).length;
const unsupported=new Set(['after','before','older','newer','filename','category','list','shared','bcc']);
const fail=(position:number,message='Invalid Split Inbox query'):never=>{throw new SplitQueryError('split_query_invalid',message,position)};
function tokenize(input:string):Token[]{
 const out:Token[]=[];for(let i=0;i<input.length;){if(/\s/u.test(input[i])){i++;continue}const position=i;if('(){}'.includes(input[i])){const value=input[i++];out.push({kind:'({'.includes(value)?'open':'close',value,position,quoted:false,fieldColon:-1});continue}
  let value='',quoted=false,inside=false,finishedQuote=false,colon=-1;while(i<input.length){const c=input[i];if(c==='"'){if(!inside&&(finishedQuote||value&&!value.endsWith(':')&&!/^[!-]+$/.test(value)))fail(i,'Quote the whole criterion value');inside=!inside;if(!inside)finishedQuote=true;quoted=true;i++;continue}if(c==='\\'){if(!inside||!['"','\\'].includes(input[i+1]??''))fail(i,'Only quoted quote and backslash escapes are supported');value+=input[i+1];i+=2;continue}if(!inside&&(/\s/u.test(c)||'(){}'.includes(c)))break;if(finishedQuote&&!inside)fail(i,'Separate criteria after a quoted value');if(!inside&&c===':'&&colon<0)colon=value.length;value+=c;i++}if(inside)fail(position,'Close the quoted value');if(!value&& !quoted)fail(position);out.push({kind:'word',value,position,quoted,fieldColon:colon});if(out.length>128)throw new SplitQueryError('split_query_limit','Split query exceeds128 tokens',position)
 }if(out.length>128)throw new SplitQueryError('split_query_limit','Split query exceeds128 tokens',input.length);return out;
}
export function parseSplitQuery(raw:unknown):{query:string;ast:SplitQueryNode;terms:number}{
 if(typeof raw!=='string'||raw.length>2048||bytes(raw)>4096||/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Surrogate}]/u.test(raw))throw new SplitQueryError('split_query_limit','Use a bounded single-line Split query',0);
 const query=raw.trim();if(!query)fail(0,'Enter a Split Inbox definition');const tokens=tokenize(query);let index=0,nodes=0,terms=0;
 const node=<T extends SplitQueryNode>(value:T):T=>{if(++nodes>64)throw new SplitQueryError('split_query_limit','Split query exceeds64 nodes',tokens[index]?.position??query.length);return value};
 const op=(value:string)=>{const t=tokens[index];return t?.kind==='word'&&!t.quoted&&t.fieldColon<0&&t.value.toUpperCase()===value};
 const starts=()=>{const t=tokens[index];return!!t&&t.kind!=='close'&&!op('OR')&&!op('AND')};
 const combine=(kind:'and'|'or',children:SplitQueryNode[])=>children.length===1?children[0]:node({kind,children});
 const term=(field:string|undefined,value:string,position:number):SplitQueryNode=>{
  if(!field)fail(position,'Split definitions require a supported field');field=field!.toLowerCase();if(field==='l')field='label';if(field==='autolabel')throw new SplitQueryError('split_query_autolabel','Use the separate Auto Labels selector',position,field);
  if(unsupported.has(field))throw new SplitQueryError('split_query_unsupported','This query family is not available in local Split Inboxes',position,field,422);
  if(!['subject','from','to','cc','label','in','has','is'].includes(field))throw new SplitQueryError('split_query_invalid','Unsupported Split query field',position,field);
  if(!value.trim())fail(position,'Enter a value for this field');
  if(field==='label'&&['done','other','important','muted','snippets','reminders','snoozed','archived','unread','all'].includes(value.normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim()))throw new SplitQueryError('split_query_unsupported','This status-style label is not supported in a Split definition',position,field,422);
  if(field==='in'){value=value.toLowerCase();if(!['inbox','sent'].includes(value))throw new SplitQueryError('split_query_unsupported','This folder criterion is not available for a local Split',position,field,422)}
  if(field==='has'){value=value.toLowerCase();if(!['attachment','attachments'].includes(value))throw new SplitQueryError('split_query_unsupported','Only attachment presence is available',position,field,422);value='attachment'}
  if(field==='is'){value=value.toLowerCase();if(!['starred','flagged'].includes(value))throw new SplitQueryError('split_query_unsupported','This status criterion is not available for a local Split',position,field,422);value='starred'}
  terms++;return node({kind:'term',field:field as SplitField,value});
 };
 function unit(inherited:string|undefined,depth:number):SplitQueryNode{
  if(depth>8)throw new SplitQueryError('split_query_limit','Split query nesting exceeds8',tokens[index]?.position??query.length);let negative=false;
  while(op('NOT')||(tokens[index]?.kind==='word'&&!tokens[index].quoted&&['-','!'].includes(tokens[index].value))){negative=!negative;index++}
  const t=tokens[index++];if(!t||t.kind==='close'||t.kind==='word'&&!t.quoted&&t.fieldColon<0&&['AND','OR'].includes(t.value.toUpperCase()))fail(t?.position??query.length,'Expected a criterion');let result:SplitQueryNode;
  if(t.kind==='open'){if(!starts())fail(t.position,'Empty query groups are not allowed');result=expression(t.value==='{'?'or':'and',inherited,depth+1);const close=tokens[index++];if(!close||close.kind!=='close'||close.value!==(t.value==='{'?'}':')'))fail(close?.position??query.length,'Close the matching query group')}
  else{let value=t.value,colon=t.fieldColon;if(!t.quoted||t.fieldColon>0)while(value.length>1&&['-','!'].includes(value[0])){negative=!negative;value=value.slice(1);if(colon>=0)colon--}let field=inherited;if(colon>0){field=value.slice(0,colon);value=value.slice(colon+1)}else if(colon===0)fail(t.position,'Missing field name');if(field&&!value&&tokens[index]?.kind==='open')result=unit(field,depth+1);else result=term(field,value,t.position)}
  return negative?node({kind:'not',child:result}):result;
 }
 function conjunction(mode:'and'|'or',inherited:string|undefined,depth:number):SplitQueryNode{
  if(!starts())fail(tokens[index]?.position??query.length,'Expected a criterion');const children=[unit(inherited,depth)];while(op('AND')||(mode==='and'&&starts())){if(op('AND'))index++;if(!starts())fail(tokens[index]?.position??query.length,'Expected a criterion after AND');children.push(unit(inherited,depth))}return combine('and',children);
 }
 function expression(mode:'and'|'or',inherited:string|undefined,depth:number):SplitQueryNode{const children=[conjunction(mode,inherited,depth)];while(op('OR')||(mode==='or'&&starts())){if(op('OR'))index++;if(!starts())fail(tokens[index]?.position??query.length,'Expected a criterion after OR');children.push(conjunction(mode,inherited,depth))}return combine('or',children)}
 const ast=expression('and',undefined,0);if(index!==tokens.length)fail(tokens[index]?.position??query.length,'Unexpected query delimiter or operator');return{query,ast,terms};
}
