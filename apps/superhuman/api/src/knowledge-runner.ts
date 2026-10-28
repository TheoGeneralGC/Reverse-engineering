import {spawn}from'node:child_process';
import {existsSync,mkdtempSync,readFileSync,realpathSync,rmSync}from'node:fs';
import {createRequire}from'node:module';
import {tmpdir}from'node:os';
import {dirname,join,resolve}from'node:path';
import {fileURLToPath}from'node:url';
import {HttpError}from'./types.ts';
import type{KnowledgeExtraction}from'./knowledge-types.ts';
import {KNOWLEDGE_EXTENSIONS,KNOWLEDGE_MAX_FILE_BYTES,KNOWLEDGE_MAX_TEXT_BYTES}from'./knowledge-input.ts';
export type KnowledgeRunnerLimits={wallMs?:number;cpuSeconds?:number;heapMiB?:number;outputBytes?:number};
const parserPackages=['fflate','saxes','parse5','word-extractor']as const;
const packageName=/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
/** Resolve installed parser packages, including their own dependency versions.
 * Grant individual real package roots and their resolver-selected symlink
 * aliases, never an ancestor node_modules tree. Node checks package metadata
 * at the lexical alias before resolving its real source entry.
 * This supports npm hoisting and package-directory symlinks without exposing
 * unrelated workspace packages, environment files or the rest of the project.
 */
export function knowledgeWorkerReadPaths(extension:string):string[]{
 const src=realpathSync(dirname(fileURLToPath(import.meta.url))),paths=new Set([src,realpathSync(resolve(src,'../package.json'))]),seen=new Set<string>();
 const visit=(name:string,from:ReturnType<typeof createRequire>,optional=false)=>{
  if(!packageName.test(name))throw Error('Invalid parser dependency');
  let entry:string;
  try{entry=from.resolve(name)}catch(error){if(optional&&(error as NodeJS.ErrnoException).code==='MODULE_NOT_FOUND')return;throw error}
  let directory=dirname(realpathSync(entry)),manifest:Record<string,unknown>|undefined;
  for(let depth=0;depth<64;depth++){
   const candidate=join(directory,'package.json');
   if(existsSync(candidate)){
    const bytes=readFileSync(candidate);if(bytes.length>65536)throw Error('Parser package metadata is too large');
    const value:unknown=JSON.parse(bytes.toString('utf8'));
    if(value&&typeof value==='object'&&!Array.isArray(value)&&(value as Record<string,unknown>).name===name){manifest=value as Record<string,unknown>;break}
   }
   const parent=dirname(directory);if(parent===directory)break;directory=parent;
  }
  if(!manifest||dirname(directory)===directory)throw Error('Parser package root is unavailable');
  for(const location of from.resolve.paths(name)??[]){const candidate=join(location,name);if(existsSync(candidate)&&realpathSync(candidate)===directory){paths.add(candidate);break}}
  if(seen.has(directory))return;if(seen.size>=128)throw Error('Parser dependency graph is too large');seen.add(directory);paths.add(directory);
  const dependencies=(field:string):Record<string,unknown>=>{const value=manifest![field];if(value===undefined)return{};if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid parser dependency metadata');return value as Record<string,unknown>};
  const required=dependencies('dependencies'),optionalDependencies=dependencies('optionalDependencies'),local=createRequire(join(directory,'package.json'));
  for(const dependency of Object.keys({...required,...optionalDependencies}).sort())visit(dependency,local,Object.hasOwn(optionalDependencies,dependency));
 };
 const local=createRequire(import.meta.url);for(const name of [...parserPackages,...(extension==='pdf'?['pdfjs-dist']:[])])visit(name,local);
 // Avoid permission-list separators/wildcards and conservatively reject other
 // glob-like or control characters rather than broaden an unusual read grant.
 if([...paths].some(path=>/[,*?\[\]{}\x00-\x1f\x7f]/.test(path)))throw Error('Parser permission paths are unsupported');
 return[...paths];
}
export function runKnowledgeExtraction(bytes:Buffer,extension:string,limits:KnowledgeRunnerLimits={}):Promise<KnowledgeExtraction>{
 const wallMs=limits.wallMs??15000,cpuSeconds=limits.cpuSeconds??10,heapMiB=limits.heapMiB??192,outputBytes=limits.outputBytes??(KNOWLEDGE_MAX_TEXT_BYTES*2+65536);
 if(!Number.isSafeInteger(wallMs)||wallMs<10||wallMs>60000||!Number.isSafeInteger(cpuSeconds)||cpuSeconds<1||cpuSeconds>30||!Number.isSafeInteger(heapMiB)||heapMiB<32||heapMiB>512||!Number.isSafeInteger(outputBytes)||outputBytes<256||outputBytes>4*1024*1024)throw new TypeError('Invalid parser budget');
 if(!KNOWLEDGE_EXTENSIONS.includes(extension as typeof KNOWLEDGE_EXTENSIONS[number])||!bytes.length||bytes.length>KNOWLEDGE_MAX_FILE_BYTES)throw new HttpError(400,'Invalid knowledge document','knowledge_invalid_file');
 return new Promise((accept,reject)=>{
  const src=dirname(fileURLToPath(import.meta.url));let readPaths:string[];
  try{readPaths=knowledgeWorkerReadPaths(extension)}catch{throw new HttpError(422,'Document parser dependencies are unavailable','knowledge_parser_unavailable')}
  const directory=mkdtempSync(join(tmpdir(),'knowledge-parse-')),worker=join(src,'knowledge-worker.ts');
  const args=['--permission',...readPaths.map(path=>`--allow-fs-read=${path}`),...(extension==='pdf'?['--allow-addons']:[]),`--max-old-space-size=${heapMiB}`,'--experimental-strip-types',worker,extension];
  const posix=process.platform!=='win32';const child=posix?spawn('/bin/sh',['-c',`ulimit -t ${cpuSeconds} || exit 64; exec "$@"`,'knowledge-parser',process.execPath,...args],{cwd:directory,env:{PATH:process.env.PATH??'',NODE_NO_WARNINGS:'1'},stdio:['pipe','pipe','pipe']}):spawn(process.execPath,args,{cwd:directory,env:{PATH:process.env.PATH??'',NODE_NO_WARNINGS:'1'},stdio:['pipe','pipe','pipe']});
  let size=0,settled=false,stderrBytes=0;const chunks:Buffer[]=[];
  const finish=(error?:HttpError,value?:KnowledgeExtraction)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)child.kill('SIGKILL');rmSync(directory,{recursive:true,force:true});error?reject(error):accept(value!)};
  const timer=setTimeout(()=>finish(new HttpError(422,'Document extraction exceeded its time budget','knowledge_parser_timeout')),wallMs);timer.unref();
  child.on('error',()=>finish(new HttpError(422,'Document parser could not start','knowledge_parser_unavailable')));child.stdin.on('error',()=>{});child.stdout.on('data',(part:Buffer)=>{size+=part.length;if(size>outputBytes)return finish(new HttpError(422,'Document text exceeded its output budget','knowledge_parser_output_limit'));chunks.push(part)});child.stderr.on('data',(part:Buffer)=>{stderrBytes+=part.length;if(stderrBytes>65536)finish(new HttpError(422,'Document parser exceeded its diagnostic budget','knowledge_parser_failed'))});
  child.on('close',()=>{if(settled)return;try{const result=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));if(!result.ok){const code=typeof result.error?.code==='string'&&/^knowledge_[a-z_]+$/.test(result.error.code)?result.error.code:'knowledge_extraction_failed';return finish(new HttpError(422,'This document could not be read as searchable text',code))}const value=result.value;if(typeof value?.text!=='string'||!value.text.trim()||Buffer.byteLength(value.text)>KNOWLEDGE_MAX_TEXT_BYTES||typeof value.parser!=='string'||typeof value.truncated!=='boolean'||!Array.isArray(value.warnings)||!value.warnings.every((x:unknown)=>typeof x==='string'))throw Error();finish(undefined,value)}catch{finish(new HttpError(422,'Document parser returned an invalid result','knowledge_parser_failed'))}});
  child.stdin.end(bytes);
 });
}
