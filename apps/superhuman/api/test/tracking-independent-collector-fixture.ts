/** Test-owned transport only. Construction opens an explicit in-memory collector, never a main App. */
import {randomBytes} from 'node:crypto';
import {createCollector} from '../../collector/src/collector.ts';

export type CollectorCall=Readonly<{method:string;target:string;bodyBase64:string}>;
export type CollectorFault=(response:Response,call:CollectorCall)=>Promise<Response>;

export function createCollectorFixture(options:{now?:()=>number;fault?:CollectorFault}={}){
 const key=randomBytes(32),tenant=randomBytes(32).toString('hex'),keyId='independent-synthetic',origin='https://collector.example.test';
 const now=options.now??(()=>Date.parse('2026-10-29T10:00:00.000Z'));
 const collector=createCollector({databasePath:':memory:',signers:new Map([[keyId,{tenant,key}]]),cursorKey:randomBytes(32),now});
 const calls:CollectorCall[]=[],entries:{origin:string;method:string;target:string}[]=[];let fault=options.fault;
 const transport:typeof fetch=async(input,init={})=>{
  const url=new URL(String(input));entries.push({origin:url.origin,method:init.method??'GET',target:url.pathname+url.search});if(url.origin!==origin)throw Error('Synthetic collector origin escaped');
  if(init.redirect!=='error'||init.credentials!=='omit')throw Error('Collector transport guard omitted');
  const method=init.method??'GET',target=url.pathname+url.search,body=Buffer.from(init.body as Uint8Array??[]);
  const call=Object.freeze({method,target,bodyBase64:body.toString('base64')});calls.push(call);
  const result=collector.handle({method,target,body,headers:Object.fromEntries(new Headers(init.headers))});
  const response=new Response(new Uint8Array(result.body),{status:result.status,headers:result.headers});
  return fault?fault(response,call):response;
 };
 return{
  configuration:{origin,keyId,tenant,key,transport,now},
  calls,entries,
  setFault(value?:CollectorFault){fault=value},
  pixel(token:string){return collector.handle({method:'GET',target:'/p/'+token+'.gif',headers:{}})},
  close(){collector.close();key.fill(0)},
 };
}
