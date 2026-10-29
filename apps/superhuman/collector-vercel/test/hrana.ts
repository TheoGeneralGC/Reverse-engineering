// Synthetic protocol server over injected fetch, not a network listener or vendor fixture.
import { DatabaseSync } from 'node:sqlite';
import { schema } from './helpers.ts';
export function hranaFixture(initialize=true) {
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');if(initialize)db.exec(schema);
 const sessions=new Map<string,Map<number,string>>();let next=0,owner:string|undefined,waiters:(()=>void)[]=[];let dropCommit=false,commitHook:undefined|(()=>void),sqlFail:string|undefined;
 const statements:string[]=[];let calls=0;
 const unlock=()=>{owner=undefined;for(const f of waiters.splice(0))f()};
 const encode=(v:unknown):any=>v===null?{type:'null'}:typeof v==='number'||typeof v==='bigint'?{type:'integer',value:String(v)}:typeof v==='string'?{type:'text',value:v}:{type:'blob',base64:Buffer.from(v as any).toString('base64')};
 const decode=(v:any)=>v.type==='null'?null:v.type==='integer'?Number(v.value):v.type==='text'?v.value:v.type==='blob'?Buffer.from(v.base64,'base64'):v.value;
 function execute(stmt:any,cache:Map<number,string>,baton:string){const sql=stmt.sql??cache.get(stmt.sql_id);if(typeof sql!=='string')throw Error('Synthetic missing SQL');statements.push(sql);if(sqlFail&&sql.includes(sqlFail))throw Error('Controlled SQL failure');if(/^BEGIN/i.test(sql))owner=baton;
  const args=(stmt.args??[]).map(decode),s=db.prepare(sql),cols=s.columns();let rows:unknown[][]=[],changes=0;
  if(cols.length)rows=(s.all(...args) as Record<string,unknown>[]).map(r=>cols.map(c=>r[c.name]));else changes=Number(s.run(...args).changes);
  if(/^(COMMIT|ROLLBACK)/i.test(sql)){unlock();if(/^COMMIT/i.test(sql))commitHook?.()}
  return{cols:cols.map(c=>({name:c.name,decltype:c.type})),rows:rows.map(r=>r.map(encode)),affected_row_count:changes,last_insert_rowid:null};
 }
 const transport=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  calls++;const req=input instanceof Request?input:new Request(input,init);if(!req.url.endsWith('/v2/pipeline'))throw Error('Unexpected synthetic URL');const payload=await req.json() as any,baton=payload.baton??'session-'+(++next);if(!sessions.has(baton))sessions.set(baton,new Map());const cache=sessions.get(baton)!;
  while(owner&&owner!==baton)await new Promise<void>(r=>waiters.push(r));
  let shouldDrop=false;
  const results=payload.requests.map((r:any)=>{try{
   if(r.type==='store_sql'){cache.set(r.sql_id,r.sql);return{type:'ok',response:{type:r.type}}}
   if(r.type==='close_sql'){cache.delete(r.sql_id);return{type:'ok',response:{type:r.type}}}
   if(r.type==='close'){sessions.delete(baton);if(owner===baton){if(db.isTransaction)db.exec('ROLLBACK');unlock()}return{type:'ok',response:{type:r.type}}}
   if(r.type==='execute'){const result=execute(r.stmt,cache,baton);if(dropCommit&&/COMMIT/.test(r.stmt.sql??cache.get(r.stmt.sql_id)??'')){shouldDrop=true;dropCommit=false}return{type:'ok',response:{type:r.type,result}}}
   if(r.type==='batch'){const step_results:any[]=[],step_errors:any[]=[];const condition=(c:any):boolean=>!c||c.type==='ok'&&!!step_results[c.step]||c.type==='not'&&!condition(c.cond)||c.type==='and'&&c.conds.every(condition)||c.type==='or'&&c.conds.some(condition);for(const step of r.batch.steps){try{if(condition(step.condition)){step_results.push(execute(step.stmt,cache,baton));step_errors.push(null)}else{step_results.push(null);step_errors.push(null)}}catch{step_results.push(null);step_errors.push({message:'Controlled database failure',code:'SQLITE_ERROR'})}}return{type:'ok',response:{type:'batch',result:{step_results,step_errors}}}}
   throw Error('Unexpected Hrana command');
  }catch{return{type:'error',error:{message:'Controlled database failure',code:'SQLITE_ERROR'}}}});
  if(shouldDrop)throw Error('Synthetic ACK loss');return new Response(JSON.stringify({baton:sessions.has(baton)?baton:null,base_url:null,results}),{headers:{'content-type':'application/json'}});
 }) as typeof fetch;
 return{db,transport,statements,calls:()=>calls,fail:(s?:string)=>sqlFail=s,loseCommit:()=>dropCommit=true,onCommit:(f?:()=>void)=>commitHook=f,close:()=>db.close()};
}
