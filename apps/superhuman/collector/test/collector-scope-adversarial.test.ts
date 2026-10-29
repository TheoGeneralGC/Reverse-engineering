import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createCollector} from '../src/collector.ts';

const tenant='a'.repeat(64),otherTenant='b'.repeat(64),account='c'.repeat(64),otherAccount='d'.repeat(64),key=Buffer.alloc(32,41),cursorKey=Buffer.alloc(32,42),initial=Date.parse('2026-10-29T04:00:00.000Z');
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
function fixture(){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'collector-v3-scope-'))),path=join(dir,'synthetic.sqlite');let now=initial,sequence=0;
 const options={databasePath:path,signers:new Map([['main',{tenant,key}],['other',{tenant:otherTenant,key:Buffer.alloc(32,43)}]]),cursorKey,now:()=>now};
 let collector=createCollector(options);const db=new DatabaseSync(path);
 const send=(target:string,value?:unknown,foreign=false)=>{const method=value===undefined?'GET':'POST',body=value===undefined?Buffer.alloc(0):Buffer.from(JSON.stringify(value)),id=foreign?'other':'main',signer=options.signers.get(id)!,nonce=randomBytes(24).toString('base64url'),time=String(now);return collector.handle({method,target,body,headers:{'content-type':'application/json','x-rea-key-id':id,'x-rea-time':time,'x-rea-nonce':nonce,'x-rea-signature':createHmac('sha256',signer.key).update(['rea-tracking-v1',id,method,target,time,nonce,hash(body)].join('\n')).digest('hex')}});};
 const operation=()=> (++sequence).toString(16).padStart(32,'0');
 const prepare=(id:string,accountRef:string,foreign=false)=>{const token=randomBytes(32).toString('base64url');assert.equal(send('/v1/registrations',{operationId:operation(),registrationId:id,accountRef,deliveryRef:hash(id+(foreign?'foreign':'')),tokenDigest:hash(token),state:'prepared',expectedRevision:0},foreign).status,200);return token;};
 const confirm=(id:string,token:string,foreign=false)=>{assert.equal(send('/v1/registrations/'+id,{operationId:operation(),expectedRevision:1,state:'armed',acknowledgementRef:null},foreign).status,200);collector.handle({method:'GET',target:'/p/'+token+'.gif',headers:{}});assert.equal(send('/v1/registrations/'+id,{operationId:operation(),expectedRevision:2,state:'confirmed',acknowledgementRef:hash(id+'ack')},foreign).status,200);};
 return{db,send,prepare,confirm,advance:(ms:number)=>{now+=ms},restartEarlier:()=>{collector.close();now=initial;collector=createCollector(options)},close:()=>{db.close();collector.close();rmSync(dir,{recursive:true,force:true})}};
}

test('account-scoped binding corruption fails only the affected account and never leaks across tenant',()=>{
 const f=fixture(),one='1'.repeat(32),two='2'.repeat(32),foreign='3'.repeat(32);try{
  f.confirm(one,f.prepare(one,account));f.confirm(two,f.prepare(two,otherAccount));f.confirm(foreign,f.prepare(foreign,account,true),true);
  f.db.prepare('UPDATE tracking_registrations SET confirmed_at=NULL WHERE tenant=? AND id=?').run(tenant,two);
  const own=f.send('/v1/events?accountRef='+account);assert.equal(own.status,200);assert.equal(JSON.parse(own.body.toString()).events.length,1);
  assert.equal(f.send('/v1/events?accountRef='+otherAccount).status,500);
  const foreignPage=f.send('/v1/events?accountRef='+account,undefined,true);assert.equal(foreignPage.status,200);assert.equal(JSON.parse(foreignPage.body.toString()).events.length,1);
 }finally{f.close()}
});

test('binding account movement and missing proof cannot silently turn either account into a complete empty page',()=>{
 for(const mutation of['move','missing']){const f=fixture(),id='1'.repeat(32);try{
  f.prepare(id,account);
  if(mutation==='move')f.db.prepare('UPDATE tracking_registrations SET account_ref=? WHERE tenant=? AND id=?').run(otherAccount,tenant,id);
  else f.db.prepare('DELETE FROM tracking_bindings WHERE tenant=? AND id=?').run(tenant,id);
  assert.equal(f.send('/v1/events?accountRef='+account).status,500);
  if(mutation==='move')assert.equal(f.send('/v1/events?accountRef='+otherAccount).status,500);
 }finally{f.close()}}
});

test('persisted authentication clock high-watermark survives a new collector instance after expired nonce cleanup',()=>{
 const f=fixture();try{
  assert.equal(f.send('/v1/events?accountRef='+account).status,200);f.advance(600001);
  assert.equal(f.send('/v1/events?accountRef='+account).status,200);f.restartEarlier();
  const result=f.send('/v1/events?accountRef='+account);assert.equal(result.status,503);assert.equal(JSON.parse(result.body.toString()).error.code,'collector_clock_rollback');
 }finally{f.close()}
});
