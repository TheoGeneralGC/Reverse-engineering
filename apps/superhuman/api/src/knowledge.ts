import {randomUUID,createHash}from'node:crypto';
import {createRequire}from'node:module';
import type{Store}from'./store.ts';
import {KnowledgeRepository}from'./knowledge-store.ts';
import {runKnowledgeExtraction}from'./knowledge-runner.ts';
import {fetchKnowledgeLink}from'./knowledge-url.ts';
import {KNOWLEDGE_MAX_FILE_BYTES,KNOWLEDGE_EXTENSIONS}from'./knowledge-input.ts';
import {HttpError}from'./types.ts';
import type{KnowledgeExtraction,KnowledgeSource,KnowledgeStatus}from'./knowledge-types.ts';
const owners=new Set<string>(),alive=(pid:number)=>{try{process.kill(pid,0);return true}catch(error){return(error as NodeJS.ErrnoException).code==='EPERM'}};
export type KnowledgeOptions={now?:()=>number;autoProcess?:boolean;resume?:boolean;extract?:(bytes:Buffer,extension:string)=>Promise<KnowledgeExtraction>;fetchLink?:typeof fetchKnowledgeLink;ownerAlive?:(pid:number)=>boolean};
export class KnowledgeService{
 readonly repository:KnowledgeRepository;readonly store:Store;readonly owner=randomUUID();readonly now:()=>number;readonly extract:NonNullable<KnowledgeOptions['extract']>;readonly fetchLink:typeof fetchKnowledgeLink;readonly autoProcess:boolean;private closing=false;private draining:Promise<void>|undefined;private queued=false;
 constructor(store:Store,options:KnowledgeOptions={}){this.store=store;this.now=options.now??Date.now;this.repository=new KnowledgeRepository(store,this.now);this.extract=options.extract??runKnowledgeExtraction;this.fetchLink=options.fetchLink??fetchKnowledgeLink;this.autoProcess=options.autoProcess??true;const liveness=options.ownerAlive??alive;
  for(const candidate of store.db.prepare("SELECT source_id,account_id,content_version,owner,owner_pid FROM knowledge_jobs WHERE state='processing'").all()){
   const live=Number(candidate.owner_pid)===process.pid&&liveness===alive?owners.has(String(candidate.owner)):liveness(Number(candidate.owner_pid));if(live)continue;
   this.repository.transaction(()=>{const job=store.db.prepare("SELECT owner,owner_pid,state FROM knowledge_jobs WHERE source_id=? AND content_version=?").get(candidate.source_id,candidate.content_version);if(!job||job.state!=='processing')return;const nowLive=Number(job.owner_pid)===process.pid&&liveness===alive?owners.has(String(job.owner)):liveness(Number(job.owner_pid));if(nowLive)return;let source:KnowledgeSource;try{source=this.repository.get(String(candidate.account_id),String(candidate.source_id))}catch{store.db.prepare("UPDATE knowledge_jobs SET state='cancelled' WHERE source_id=? AND content_version=?").run(candidate.source_id,candidate.content_version);return}if(source.contentVersion!==candidate.content_version){store.db.prepare("UPDATE knowledge_jobs SET state='cancelled' WHERE source_id=? AND content_version=?").run(candidate.source_id,candidate.content_version);return}store.db.prepare("UPDATE knowledge_jobs SET state='queued',owner=NULL,owner_pid=NULL WHERE source_id=? AND content_version=?").run(candidate.source_id,candidate.content_version);this.repository.save({...source,status:'pending',revision:source.revision+1,updatedAt:new Date(this.now()).toISOString(),error:null})});
  }owners.add(this.owner);if(options.resume!==false&&this.autoProcess)this.requestProcessing();
 }
 status(accountId:string):KnowledgeStatus{this.repository.account(accountId);const require=createRequire(import.meta.url),available=(name:string)=>{try{require.resolve(name);return true}catch{return false}},counts={pending:0,processing:0,ready:0,error:0};for(const row of this.store.db.prepare('SELECT status,count(*)as n FROM knowledge_sources WHERE account_id=? AND deleted=0 GROUP BY status').all(accountId))if(Object.hasOwn(counts,String(row.status)))counts[row.status as keyof typeof counts]=Number(row.n);return{implemented:true,visibility:'private',teamSharing:false,maxFileBytes:KNOWLEDGE_MAX_FILE_BYTES,extensions:[...KNOWLEDGE_EXTENSIONS],parsers:{text:true,html:available('parse5'),pdf:available('pdfjs-dist'),word:available('word-extractor'),presentation:available('fflate')&&available('saxes')},counts,limitations:['Text extraction only; no OCR or faithful document layout.','Large documents may be truncated; sources report limits.','Links index one public HTTPS UTF-8 page; no domain crawl, browser rendering, authentication, or automatic live refresh.','Team sharing requires actual membership and is unavailable.','Descriptions default to a deterministic local excerpt, not a paid model generation.','Local budgets:1000active sources/500MiB raw storage per account;50MiB per file.']}}
 upload(accountId:string,key:string,name:string,bytes:Buffer){if(this.closing)throw new HttpError(503,'Knowledge ingestion is stopping','knowledge_stopping');const result=this.repository.createFile(accountId,key,name,bytes);if(result.created&&this.autoProcess)this.requestProcessing();return result}
 addLink(accountId:string,key:string,url:string){if(this.closing)throw new HttpError(503,'Knowledge ingestion is stopping','knowledge_stopping');const result=this.repository.createLink(accountId,key,url);if(result.created&&this.autoProcess)this.requestProcessing();return result}
 retry(accountId:string,id:string,key:string,expectedRevision:number){if(this.closing)throw new HttpError(503,'Knowledge ingestion is stopping','knowledge_stopping');const result=this.repository.retry(accountId,id,key,expectedRevision);if(result.created&&this.autoProcess)this.requestProcessing();return result}
 requestProcessing(){if(this.closing||this.queued)return;this.queued=true;setImmediate(()=>{this.queued=false;if(!this.closing)void this.runJobs().catch(()=>{})})}
 private claim(){return this.repository.transaction(()=>{if(this.closing)return null;for(const row of this.store.db.prepare("SELECT source_id,account_id,content_version FROM knowledge_jobs WHERE state='queued' ORDER BY rowid LIMIT 16").all()){let source:KnowledgeSource;try{source=this.repository.get(String(row.account_id),String(row.source_id))}catch{this.store.db.prepare("UPDATE knowledge_jobs SET state='cancelled' WHERE source_id=? AND content_version=?").run(row.source_id,row.content_version);continue}if(source.contentVersion!==row.content_version){this.store.db.prepare("UPDATE knowledge_jobs SET state='cancelled' WHERE source_id=? AND content_version=?").run(row.source_id,row.content_version);continue}this.store.db.prepare("UPDATE knowledge_jobs SET state='processing',owner=?,owner_pid=? WHERE source_id=? AND content_version=? AND state='queued'").run(this.owner,process.pid,source.id,source.contentVersion);const current=this.repository.save({...source,status:'processing',revision:source.revision+1,updatedAt:new Date(this.now()).toISOString(),error:null});return current}return null})}
 private commitJob(source:KnowledgeSource,result:KnowledgeExtraction|undefined,error:unknown,link:Awaited<ReturnType<typeof fetchKnowledgeLink>>|undefined){
  this.repository.transaction(()=>{
   const job=this.store.db.prepare('SELECT state,owner FROM knowledge_jobs WHERE source_id=? AND content_version=?').get(source.id,source.contentVersion);
   if(job?.state!=='processing'||job.owner!==this.owner)return;
   let current:KnowledgeSource;try{current=this.repository.get(source.accountId,source.id)}catch{this.store.db.prepare("UPDATE knowledge_jobs SET state='cancelled' WHERE source_id=? AND content_version=? AND owner=?").run(source.id,source.contentVersion,this.owner);return}
   if(current.contentVersion!==source.contentVersion){this.store.db.prepare("UPDATE knowledge_jobs SET state='cancelled' WHERE source_id=? AND content_version=? AND owner=?").run(source.id,source.contentVersion,this.owner);return}
   if(result&&link){
    const quota=this.store.db.prepare('SELECT COALESCE(sum(length(data)),0)as bytes FROM knowledge_blobs WHERE account_id=?').get(source.accountId)!;
    if(Number(quota.bytes)+link.bytes.length>500*1024*1024)error=new HttpError(413,'Private Knowledge storage budget reached','knowledge_storage_limit');
    else{this.store.db.prepare('INSERT OR REPLACE INTO knowledge_blobs VALUES(?,?,?)').run(source.id,source.accountId,link.bytes);current={...current,contentHash:createHash('sha256').update(link.bytes).digest('hex'),link:{...current.link!,url:link.url,fetchedAt:new Date(this.now()).toISOString(),mediaType:link.mediaType,extension:link.extension}}}
   }
   if(result&&!error)this.repository.index(current,result);
   else this.repository.save({...current,status:'error',revision:current.revision+1,updatedAt:new Date(this.now()).toISOString(),error:{code:error instanceof HttpError&&/^knowledge_[a-z_]+$/.test(error.code)?error.code:'knowledge_ingestion_failed',message:error instanceof HttpError?error.message:'The source could not be converted to searchable text.',retry:'explicit'}});
   this.store.db.prepare('UPDATE knowledge_jobs SET state=? WHERE source_id=? AND content_version=? AND owner=?').run(result&&!error?'ready':'error',source.id,source.contentVersion,this.owner);
  });
 }
 runJobs(maximum=4):Promise<void>{
  if(this.draining)return this.draining;if(this.closing)return Promise.resolve();if(!Number.isSafeInteger(maximum)||maximum<1||maximum>16)throw new TypeError('Invalid ingestion batch');
  const work=async()=>{
   for(let processed=0;processed<maximum&&!this.closing;processed++){
    const source=this.claim();if(!source)break;
    let result:KnowledgeExtraction|undefined,error:unknown,link:Awaited<ReturnType<typeof fetchKnowledgeLink>>|undefined;
    try{let bytes:Buffer,extension:string;if(source.kind==='file'){bytes=this.repository.blob(source.accountId,source.id);extension=source.file!.extension}else{link=await this.fetchLink(source.link!.requestedUrl);bytes=link.bytes;extension=link.extension}result=await this.extract(bytes,extension)}catch(failure){error=failure}
    try{this.commitJob(source,result,error,link)}catch{this.commitJob(source,undefined,new HttpError(422,'The extracted source could not be indexed','knowledge_index_failed'),undefined)}
   }
  };
  this.draining=work().finally(()=>{this.draining=undefined;if(this.autoProcess&&!this.closing&&this.store.db.prepare("SELECT 1 FROM knowledge_jobs WHERE state='queued' LIMIT 1").get())this.requestProcessing()});return this.draining;
 }
 async waitForIdle(){while(this.queued||this.draining){if(this.draining)await this.draining;else await new Promise<void>(resolve=>setImmediate(resolve))}}
 async close(){this.closing=true;await this.waitForIdle();owners.delete(this.owner)}
}
