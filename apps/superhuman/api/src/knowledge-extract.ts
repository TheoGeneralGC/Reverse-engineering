import {posix}from'node:path';
import {Unzip,UnzipInflate}from'fflate';
import {SaxesParser}from'saxes';
import {parse}from'parse5';
import WordExtractor from'word-extractor';
import type{KnowledgeExtraction}from'./knowledge-types.ts';
import {KNOWLEDGE_EXTENSIONS,KNOWLEDGE_MAX_FILE_BYTES,KNOWLEDGE_MAX_TEXT_BYTES}from'./knowledge-input.ts';
export class KnowledgeParseError extends Error{readonly code:string;constructor(code:string){super(code);this.code=code}}
function fail(code:string):never{throw new KnowledgeParseError(code)}
export function clipKnowledgeText(value:string,maximum=KNOWLEDGE_MAX_TEXT_BYTES):{text:string;truncated:boolean}{const bytes=Buffer.from(value);if(bytes.length<=maximum)return{text:value,truncated:false};let end=maximum;while(end>0&&(bytes[end]&0xc0)===0x80)end--;return{text:bytes.subarray(0,end).toString('utf8'),truncated:true}}
function utf8(bytes:Uint8Array){try{const value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(value.includes('\0'))fail('knowledge_binary_text');return value}catch(error){if(error instanceof KnowledgeParseError)throw error;return fail('knowledge_invalid_utf8')}}
export function knowledgeZipXml(bytes:Buffer):Map<string,string>{
 if(bytes.length<4||bytes.readUInt32LE(0)!==0x04034b50)fail('knowledge_invalid_archive');
 const result=new Map<string,string>(),seen=new Set<string>();let count=0,total=0;
 const unzip=new Unzip(file=>{
  const name=file.name;if(++count>2000||Buffer.byteLength(name)>1024||name.includes('\\')||name.startsWith('/')||name.split('/').some(p=>p==='..'||p==='__proto__'||p==='constructor'||p==='prototype')||seen.has(name))fail('knowledge_archive_structure');seen.add(name);
  if(!/\.(xml|rels)$/i.test(name))return;
  if(file.originalSize!==undefined&&(!Number.isSafeInteger(file.originalSize)||file.originalSize>16*1024*1024))fail('knowledge_expansion_limit');
  const chunks:Uint8Array[]=[];let size=0;
  file.ondata=(error,data,final)=>{if(error)fail('knowledge_invalid_archive');size+=data.length;total+=data.length;if(size>16*1024*1024||total>16*1024*1024)fail('knowledge_expansion_limit');chunks.push(data);if(final)result.set(name,utf8(Buffer.concat(chunks.map(p=>Buffer.from(p)),size)))};file.start();
 });unzip.register(UnzipInflate);
 try{for(let start=0;start<bytes.length;start+=4096)unzip.push(bytes.subarray(start,Math.min(bytes.length,start+4096)),start+4096>=bytes.length)}catch(error){if(error instanceof KnowledgeParseError)throw error;fail('knowledge_invalid_archive')}
 if(!result.has('[Content_Types].xml'))fail('knowledge_invalid_archive');return result;
}
function xmlText(xml:string):string{
 const parser=new SaxesParser({xmlns:true});let depth=0,inText=0,text='';
 parser.on('doctype',()=>fail('knowledge_unsafe_xml'));parser.on('opentag',tag=>{if(++depth>256)fail('knowledge_xml_depth');if(tag.local==='t')inText++;if(tag.local==='br'||tag.local==='tab')text+=tag.local==='br'?'\n':'\t'});parser.on('text',value=>{if(inText)text+=value;if(Buffer.byteLength(text)>KNOWLEDGE_MAX_TEXT_BYTES*2)fail('knowledge_text_limit')});parser.on('closetag',tag=>{if(tag.local==='t')inText--;if(tag.local==='p')text+='\n';depth--});
 try{parser.write(xml).close()}catch(error){if(error instanceof KnowledgeParseError)throw error;fail('knowledge_invalid_xml')}return text;
}
function xmlVisit(xml:string,open:(tag:any)=>void){const parser=new SaxesParser({xmlns:true});let depth=0;parser.on('doctype',()=>fail('knowledge_unsafe_xml'));parser.on('opentag',tag=>{if(++depth>256)fail('knowledge_xml_depth');open(tag)});parser.on('closetag',()=>{depth--});try{parser.write(xml).close()}catch(error){if(error instanceof KnowledgeParseError)throw error;fail('knowledge_invalid_xml')}}
function attribute(tag:any,name:string,relationship=false):string|undefined{for(const value of Object.values(tag.attributes)as any[])if(value.local===name&&(relationship?/(?:schemas.openxmlformats.org\/officeDocument\/2006|purl.oclc.org\/ooxml\/officeDocument)\/relationships$/.test(value.uri):!value.uri))return value.value;return undefined}
function presentationRelationships(xml:string,base:string){const result=new Map<string,{type:string;target:string|null;external:boolean}>();xmlVisit(xml,tag=>{if(tag.local!=='Relationship')return;const id=attribute(tag,'Id'),type=attribute(tag,'Type'),target=attribute(tag,'Target'),mode=attribute(tag,'TargetMode');if(!id||!type||!target||result.has(id))fail('knowledge_invalid_presentation');const external=mode==='External';let part:string|null=null;if(!external){if(mode&&mode!=='Internal'||/[\\\x00-\x1f?#]/.test(target)||/^[a-z][a-z\d+.-]*:/i.test(target)||target.startsWith('//'))fail('knowledge_invalid_presentation');let decoded:string;try{decoded=decodeURIComponent(target)}catch{fail('knowledge_invalid_presentation')}part=target.startsWith('/')?posix.normalize(decoded!).slice(1):posix.normalize(posix.join(posix.dirname(base),decoded!));if(part.startsWith('../')||part==='..'||part.startsWith('/'))fail('knowledge_invalid_presentation')}result.set(id,{type,target:part,external})});return result}
function presentationText(files:Map<string,string>):{text:string;truncated:boolean;warnings:string[]}{
 const main='ppt/presentation.xml',xml=files.get(main),rels=files.get('ppt/_rels/presentation.xml.rels');if(!xml||!rels)fail('knowledge_invalid_presentation');const relationships=presentationRelationships(rels,main),ids:string[]=[];xmlVisit(xml,tag=>{if(tag.local==='sldId'){const id=attribute(tag,'id',true);if(!id)fail('knowledge_invalid_presentation');ids.push(id)}});if(!ids.length||ids.length>2000)fail('knowledge_invalid_presentation');let text='',truncated=false;const warnings:string[]=[];
 for(const id of ids){const relation=relationships.get(id);if(!relation||!relation.type.endsWith('/slide'))fail('knowledge_invalid_presentation');if(relation.external){truncated=true;warnings.push('external-slide-omitted');continue}const name=relation.target!,slide=files.get(name);if(!slide)fail('knowledge_invalid_presentation');text+=xmlText(slide)+'\n';const slideRels=files.get(posix.join(posix.dirname(name),'_rels',posix.basename(name)+'.rels'));if(slideRels)for(const note of presentationRelationships(slideRels,name).values()){if(!note.type.endsWith('/notesSlide'))continue;if(note.external){truncated=true;warnings.push('external-notes-omitted');continue}const noteXml=files.get(note.target!);if(!noteXml)fail('knowledge_invalid_presentation');text+=xmlText(noteXml)+'\n'}if(Buffer.byteLength(text)>KNOWLEDGE_MAX_TEXT_BYTES){truncated=true;break}}
 return{text,truncated,warnings:[...new Set(warnings)]};
}
function htmlText(bytes:Buffer){const root=parse(utf8(bytes)),parts:string[]=[];let nodes=0;const visit=(node:any,depth:number)=>{if(++nodes>100000||depth>256)fail('knowledge_html_limit');if(['script','style','template','noscript'].includes(node.tagName))return;if(node.nodeName==='#text')parts.push(node.value);for(const child of node.childNodes??[])visit(child,depth+1);if(['p','div','br','li','h1','h2','h3','tr','section','article'].includes(node.tagName))parts.push('\n')};visit(root,0);return parts.join('')}
export async function extractKnowledgeDocument(bytes:Buffer,extension:string):Promise<KnowledgeExtraction>{
 if(!bytes.length)fail('knowledge_empty_file');if(bytes.length>KNOWLEDGE_MAX_FILE_BYTES)fail('knowledge_file_too_large');if(!KNOWLEDGE_EXTENSIONS.includes(extension as typeof KNOWLEDGE_EXTENSIONS[number]))fail('knowledge_unsupported_extension');
 let text='',parser='utf8-inert',truncated=false;const warnings:string[]=[];
 if(extension==='pdf'){
  if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))fail('knowledge_invalid_pdf');
  const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=pdf.getDocument({data:new Uint8Array(bytes),useSystemFonts:false,disableFontFace:true,maxImageSize:0,stopAtErrors:true,verbosity:0});
  try{const loaded=await task.promise;const pages=Math.min(loaded.numPages,200);if(loaded.numPages>pages){truncated=true;warnings.push('page_limit')}for(let page=1;page<=pages;page++){const part=await loaded.getPage(page),content=await part.getTextContent();for(const item of content.items){if('str'in item)text+=item.str+('hasEOL'in item&&item.hasEOL?'\n':' ');if(Buffer.byteLength(text)>KNOWLEDGE_MAX_TEXT_BYTES){truncated=true;break}}text+='\n';part.cleanup();if(truncated&&Buffer.byteLength(text)>KNOWLEDGE_MAX_TEXT_BYTES)break}parser='pdfjs-dist-6.4.299';warnings.push('text-only-no-ocr')}catch(error){if((error as{name?:string}).name==='PasswordException')fail('knowledge_password_required');fail('knowledge_invalid_pdf')}finally{await task.destroy().catch(()=>{})}
 }else if(extension==='doc'||extension==='docx'){
  if(extension==='doc'&&(bytes.length<8||bytes.subarray(0,8).toString('hex')!=='d0cf11e0a1b11ae1'))fail('knowledge_invalid_word');
  if(extension==='docx'&&!knowledgeZipXml(bytes).has('word/document.xml'))fail('knowledge_invalid_word');
  try{const doc=await new WordExtractor().extract(bytes);text=[doc.getBody(),doc.getFootnotes(),doc.getEndnotes(),doc.getHeaders(),doc.getFooters(),doc.getTextboxes()].filter(Boolean).join('\n');parser='word-extractor-1.0.4';warnings.push('text-only-layout-omitted')}catch(error){if(error instanceof KnowledgeParseError)throw error;fail('knowledge_invalid_word')}
 }else if(extension==='pptx'){
  const extracted=presentationText(knowledgeZipXml(bytes));text=extracted.text;truncated=extracted.truncated;warnings.push(...extracted.warnings);parser='fflate-0.8.3+saxes-6.0.0';warnings.push('text-only-layout-omitted');
 }else if(extension==='html'){text=htmlText(bytes);parser='parse5-8.0.1-inert'}else{text=utf8(bytes)}
 text=text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').trim();if(!text)fail('knowledge_empty_text');const clipped=clipKnowledgeText(text);return{text:clipped.text,parser,truncated:truncated||clipped.truncated,warnings};
}
