// Browser-safe token policy shared by answer validation and React rendering.
// HTML is recognized only to preserve it as literal text, never rendered as HTML.
import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';

export function safeAiHref(value: string): string | null {
 if(!value||value.length>4096||/[\u0000-\u0020\u007f]/.test(value)||/%0[ad]/i.test(value))return null;
 try{
  const url=new URL(value);
  if(url.protocol==='mailto:')return url.pathname&&!url.hash?url.href:null;
  if(!['https:','http:'].includes(url.protocol)||!url.hostname||url.username||url.password)return null;
  const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
  if(host==='localhost'||host.endsWith('.localhost')||host==='0.0.0.0'||host.startsWith('127.')||host==='::'||host==='::1'||host==='::ffff:0:0'||/^::ffff:7f[0-9a-f]{2}:/.test(host))return null;
  return url.href;
 }catch{return null}
}

const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
// Track literal containers across inline and block tokens. Quoted > characters
// do not end a tag; comments never alter container depth. Malformed unclosed
// containers conservatively keep later markers literal until a matching close.
function trackHtml(content:string,stack:string[]){
 let position=0;
 while((position=content.indexOf('<',position))!==-1){
  if(content.startsWith('<!--',position)){const end=content.indexOf('-->',position+4);position=end<0?content.length:end+3;continue}
  const match=/^<(\/?)([A-Za-z][A-Za-z0-9:-]*)(?=[\s/>])/.exec(content.slice(position));
  if(!match){position++;continue}
  let end=position+match[0].length,quote='';
  for(;end<content.length;end++){
   const char=content[end];if(quote){if(char===quote)quote=''}else if(char==='"'||char==="'")quote=char;else if(char==='>')break;
  }
  if(end===content.length)break;
  const tag=match[2].toLowerCase();
  if(match[1]){const index=stack.lastIndexOf(tag);if(index>=0)stack.splice(index)}
  else if(!voidTags.has(tag)&&!content.slice(position,end).trimEnd().endsWith('/'))stack.push(tag);
  position=end+1;
 }
}

/** Env: {aiCitationSourceIds: Map<number,string>}. Only tokenize, then render
 * through the application's allowlist. Unsafe links and all HTML become inert. */
export function createAiMarkdownParser(){
 const parser=new MarkdownIt({html:true,breaks:true,linkify:false,typographer:false,maxNesting:20});
 parser.disable('image');
 // Recognize even rejected destinations as link syntax so nested labels cannot
 // turn into independent citations. The final token pass removes unsafe links.
 parser.validateLink=()=>true;
 parser.inline.ruler.after('link','ai_citation',(state,silent)=>{
  if(silent||state.linkLevel||state.src.charCodeAt(state.pos)!==91)return false;
  const match=/^\[cite:([1-9][0-9]{0,2})\]/.exec(state.src.slice(state.pos,state.pos+11));if(!match)return false;
  const next=state.src[state.pos+match[0].length];if(next==='('||next==='[')return false;
  const map=state.env.aiCitationSourceIds,sourceId=map instanceof Map?map.get(Number(match[1])):undefined;
  if(typeof sourceId!=='string')return false;
  const token=state.push('ai_citation','',0);token.content=match[1];token.meta={sourceId};state.pos+=match[0].length;return true;
 });
 parser.core.ruler.after('inline','ai_inert_literals',state=>{
  const html:string[]=[],links:boolean[]=[];
  const visit=(tokens:Token[])=>{for(const token of tokens){
   if(token.type==='html_inline'||token.type==='html_block'){
    trackHtml(token.content,html);token.type='text';token.tag='';token.nesting=0;continue;
   }
   if(token.type==='link_open'){
    const safe=safeAiHref(String(token.attrGet('href')??''));links.push(!!safe);
    if(safe)token.attrSet('href',safe);else{token.tag='span';token.attrs=null}
   }else if(token.type==='link_close'){if(!links.pop())token.tag='span'}
   if(token.type==='ai_citation'&&html.length){token.type='text';token.content=`[cite:${token.content}]`;token.meta=null}
   if(token.children)visit(token.children);
  }};
  visit(state.tokens);
 });
 return parser;
}
