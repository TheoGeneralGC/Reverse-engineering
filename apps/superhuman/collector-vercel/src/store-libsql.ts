import { createClient, type Client, type Transaction } from '@libsql/client/web';
import { CollectorError, requireValue } from '../../collector/src/protocol.ts';
import { MARKER, validateSchema, type CollectorDatabase, type Row, type SqlConnection, type SqlValue } from './database.ts';
import type { RuntimeConfiguration } from './config.ts';
export function sqlConnection(tx: Pick<Transaction,'execute'>, deadline=Infinity): SqlConnection {
  const execute=async(sql:string,args:SqlValue[])=>{
    requireValue(typeof sql==='string' && sql.length<=32768 && args.length<=32,500,'collector_unavailable');
    for(const a of args)requireValue(a===null || typeof a==='string' && Buffer.byteLength(a)<=131072 || typeof a==='number' && Number.isSafeInteger(a) || a instanceof Uint8Array && a.byteLength<=131072,500,'collector_unavailable');
    requireValue(Date.now()<=deadline,503,'collector_unavailable');const result=await tx.execute({sql,args});requireValue(Date.now()<=deadline,503,'collector_unavailable');
    requireValue(result.rows.length<=1000 && Number.isSafeInteger(result.rowsAffected) && result.rowsAffected>=0,500,'collector_unavailable');
    const rows:Row[]=result.rows.map(r=>Object.fromEntries(result.columns.map(c=>{const v=r[c];requireValue(v===null || typeof v==='string' && Buffer.byteLength(v)<=131072 || typeof v==='number' && Number.isSafeInteger(v) || v instanceof ArrayBuffer && v.byteLength<=131072,500,'collector_artifact_corrupt');return[c,v instanceof ArrayBuffer?new Uint8Array(v):v]})));
    return {rows,changes:result.rowsAffected};
  };
  return {prepare:(sql)=>({get:async(...a)=>(await execute(sql,a)).rows[0],all:async(...a)=>(await execute(sql,a)).rows,run:async(...a)=>({changes:(await execute(sql,a)).changes})})};
}
/** One shared HTTP client is never closed by an individual invocation; each unit owns its TX. */
export function libsqlDatabase(config: RuntimeConfiguration, options:{transport?:typeof fetch;client?:Client}={}): CollectorDatabase {
  const origin=new URL(config.databaseUrl.replace(/^libsql:/,'https:')).origin;
  const upstream=options.transport??fetch;
  const transport=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const request=input instanceof Request?input:new Request(input,init),url=new URL(request.url);
    requireValue(url.origin===origin&&url.pathname==='/v2/pipeline'&&!url.search&&!url.username&&!url.password&&request.method==='POST',503,'collector_unavailable');
    requireValue((await request.clone().arrayBuffer()).byteLength<=262144,503,'collector_unavailable');
    const response=await upstream(new Request(request,{redirect:'error',signal:AbortSignal.timeout(4000)}));
    requireValue(response.status<300||response.status>=400,503,'collector_unavailable');
    const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
    if(reader)try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;requireValue(size<=2097152,503,'collector_unavailable');chunks.push(r.value)}}finally{await reader.cancel().catch(()=>{})}
    return new Response(Buffer.concat(chunks),{status:response.status,headers:response.headers});
  };
  const client=options.client??createClient({url:config.databaseUrl,authToken:config.authToken,intMode:'number',fetch:transport,concurrency:8});
  let closed=false;
  return {
    async primaryTransaction(work, canCommit=()=>true){requireValue(!closed && canCommit(),503,'collector_unavailable');let tx:Transaction|undefined;
      const deadline=Date.now()+4500;
      try{tx=await client.transaction('write');requireValue(!closed && canCommit(),503,'collector_unavailable');const db=sqlConnection(tx,deadline);await validateSchema(db);const result=await work(db);requireValue(!closed && canCommit() && Date.now()<=deadline,503,'collector_unavailable');await tx.commit();return result}
      catch(error){try{await tx?.rollback()}catch{};if(error instanceof CollectorError)throw error;throw new CollectorError(503,'collector_unavailable')}
      finally{tx?.close()}
    },
    async readableMarker(){if(closed)return false;try{return (await client.execute("SELECT value FROM tracking_meta WHERE key='schema'")).rows[0]?.value===MARKER}catch{return false}},
    close(){if(closed)return;closed=true;client.close()}
  };
}
