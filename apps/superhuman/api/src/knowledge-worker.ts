// Executed only in a bounded subprocess with explicit fs permissions and no keys.
import {createRequire,syncBuiltinESMExports}from'node:module';
import {KNOWLEDGE_MAX_FILE_BYTES}from'./knowledge-input.ts';
const require=createRequire(import.meta.url),blocked=()=>{throw new Error('Knowledge parser network access is disabled')};
for(const name of ['node:http','node:https']){const module=require(name);module.request=blocked;module.get=blocked}
const net=require('node:net');net.connect=blocked;net.createConnection=blocked;net.Socket.prototype.connect=blocked;
const dns=require('node:dns');dns.lookup=blocked;dns.resolve=blocked;globalThis.fetch=blocked as typeof fetch;syncBuiltinESMExports();
let count=0;const chunks:Buffer[]=[];
try{
 for await(const part of process.stdin){const bytes=Buffer.from(part);count+=bytes.length;if(count>KNOWLEDGE_MAX_FILE_BYTES)throw Error('limit');chunks.push(bytes)}
 const {extractKnowledgeDocument}=await import('./knowledge-extract.ts');const value=await extractKnowledgeDocument(Buffer.concat(chunks,count),process.argv[2]??'');process.stdout.write(JSON.stringify({ok:true,value}));
}catch(error){const code=typeof(error as{code?:unknown}).code==='string'&&/^knowledge_[a-z_]+$/.test(String((error as{code?:unknown}).code))?String((error as{code:string}).code):'knowledge_extraction_failed';process.stdout.write(JSON.stringify({ok:false,error:{code}}));process.exitCode=1}
