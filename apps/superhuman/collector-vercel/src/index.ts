import express from 'express';
import { configuration, type RuntimeConfiguration } from './config.ts';
import { libsqlDatabase } from './store-libsql.ts';
import { createAsyncCollector } from './collector.ts';
import type { CollectorDatabase } from './database.ts';
import { MAX_BODY, MAX_TARGET } from '../../collector/src/protocol.ts';

/** Root middleware only: no listener, collector credential read or DB/client construction at import. */
export function createApplication(options:{configure?:()=>RuntimeConfiguration;database?:(c:RuntimeConfiguration)=>CollectorDatabase}={}) {
  const app=express();app.disable('x-powered-by');app.disable('etag');app.set('trust proxy',false);app.set('query parser',false);
  let runtime:{origin:URL;collector:ReturnType<typeof createAsyncCollector>}|undefined;
  const load=()=>{if(runtime)return runtime;const c=(options.configure??(()=>configuration(process.env)))();try{const database=(options.database??libsqlDatabase)(c);const collector=createAsyncCollector({...c,database});return runtime={origin:new URL(c.origin),collector}}finally{for(const s of c.signers.values())s.key.fill(0);c.cursorKey.fill(0)}};
  app.use(async(req,res)=>{
    const controller=new AbortController();const abort=()=>controller.abort();req.once('aborted',abort);res.once('close',()=>{if(!res.writableEnded)abort()});
    const refuse=(status:number)=>{if(res.destroyed||res.writableEnded)return;res.status(status).set({'content-type':'application/json','cache-control':'no-store'}).end('{"error":{"code":"invalid_request"}}')};
    try{
      // Capture the native target before any router/body/query transform. Header aliases confer no authority.
      const target=req.url;
      if(!target||target!==req.originalUrl||target.length>MAX_TARGET||req.body!==undefined||req.headers['transfer-encoding']!==undefined||req.headers.upgrade!==undefined)return refuse(400);
      const seen=new Set<string>();for(let i=0;i<req.rawHeaders.length;i+=2){const n=req.rawHeaders[i].toLowerCase();if(seen.has(n))return refuse(400);seen.add(n)}
      const length=req.headers['content-length'];if(length!==undefined&&(!/^\d{1,5}$/.test(length)||Number(length)>MAX_BODY))return refuse(413);
      const {origin,collector}=load();if(req.headers.host!==origin.host)return refuse(400);
      const chunks:Buffer[]=[];let size=0;for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>MAX_BODY)return refuse(413);chunks.push(b)}
      if(controller.signal.aborted)return;
      if(target==='/healthz'){if(!['GET','HEAD'].includes(req.method)||size)return refuse(400);res.status(await collector.readable()?204:503).set('cache-control','no-store').end();return}
      const headers:Record<string,string|undefined>={};for(const[n,v]of Object.entries(req.headers)){if(Array.isArray(v))return refuse(400);headers[n]=v}
      const output=await collector.handle({method:req.method,target,headers,body:Buffer.concat(chunks)},controller.signal);
      if(controller.signal.aborted||res.destroyed||res.writableEnded)return;
      res.status(output.status).set(output.headers).end(output.body);
    }catch{refuse(500)}finally{req.off('aborted',abort)}
  });
  return app;
}
export default createApplication();
