import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { CollectorError } from '../../collector/src/protocol.ts';
import { validateSchema, type CollectorDatabase, type SqlConnection, type SqlValue } from '../src/database.ts';
export const schema=readFileSync(new URL('../migrations/001.sql',import.meta.url),'utf8');
export function memoryDatabase() {
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');db.exec(schema);
  let tail=Promise.resolve();let fail:string|undefined,loseCommit=false,closed=false;let before:((sql:string)=>Promise<void>|void)|undefined;
  const sql:SqlConnection={prepare:(s)=>({get:async(...a)=>{await before?.(s);if(fail&&s.includes(fail))throw Error('Synthetic SQL failure');return db.prepare(s).get(...a as any)},all:async(...a)=>{await before?.(s);if(fail&&s.includes(fail))throw Error('Synthetic SQL failure');return db.prepare(s).all(...a as any)},run:async(...a)=>{await before?.(s);if(fail&&s.includes(fail))throw Error('Synthetic SQL failure');return{changes:Number(db.prepare(s).run(...a as any).changes)}}})};
  const client=():CollectorDatabase=>({
    async primaryTransaction(work,alive=()=>true){let release!:()=>void;const prior=tail;tail=new Promise<void>(r=>release=r);await prior;let committed=false;try{if(closed||!alive())throw new CollectorError(503,'collector_unavailable');db.exec('BEGIN IMMEDIATE');await validateSchema(sql);const v=await work(sql);if(!alive())throw new CollectorError(503,'collector_unavailable');db.exec('COMMIT');committed=true;if(loseCommit){loseCommit=false;throw new CollectorError(503,'collector_unavailable')}return v}catch(e){if(!committed&&db.isTransaction)db.exec('ROLLBACK');throw e}finally{release()}},
    readableMarker:async()=>!closed&&db.prepare("SELECT value FROM tracking_meta WHERE key='schema'").get()?.value==='rea-tracking-collector-v2',close(){} });
  return{db,client,connection:sql,close:()=>{closed=true;db.close()},fail:(s?:string)=>fail=s,loseCommit:()=>loseCommit=true,before:(f?:typeof before)=>before=f};
}
export const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{promise,resolve}};
