import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createCollector} from '../src/collector.ts';

test('events rejects a confirmed registration hidden by a corrupted current confirmation filter',()=>{
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'collector-v2-filter-'))),path=join(dir,'synthetic.sqlite');
  const key=Buffer.alloc(32,31),tenant='a'.repeat(64),account='b'.repeat(64),reg='1'.repeat(32),stamp=Date.parse('2026-10-29T03:00:00.000Z');
  const collector=createCollector({databasePath:path,signers:new Map([['own',{tenant,key}]]),cursorKey:Buffer.alloc(32,32),now:()=>stamp});
  const db=new DatabaseSync(path);let sequence=0;
  const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
  const send=(method:string,target:string,value?:unknown)=>{
    const body=value===undefined?Buffer.alloc(0):Buffer.from(JSON.stringify(value)),nonce=randomBytes(24).toString('base64url'),time=String(stamp);
    return collector.handle({method,target,body,headers:{'content-type':'application/json','x-rea-key-id':'own','x-rea-time':time,'x-rea-nonce':nonce,'x-rea-signature':createHmac('sha256',key).update(['rea-tracking-v1','own',method,target,time,nonce,sha(body)].join('\n')).digest('hex')}});
  };
  const operation=()=>String(++sequence).padStart(32,'0');
  try {
    const token=randomBytes(32).toString('base64url');
    assert.equal(send('POST','/v1/registrations',{operationId:operation(),registrationId:reg,accountRef:account,deliveryRef:'c'.repeat(64),tokenDigest:sha(token),state:'prepared',expectedRevision:0}).status,200);
    assert.equal(send('POST','/v1/registrations/'+reg,{operationId:operation(),expectedRevision:1,state:'armed',acknowledgementRef:null}).status,200);
    collector.handle({method:'GET',target:'/p/'+token+'.gif',headers:{}});
    assert.equal(send('POST','/v1/registrations/'+reg,{operationId:operation(),expectedRevision:2,state:'confirmed',acknowledgementRef:'d'.repeat(64)}).status,200);
    assert.equal(send('POST','/v1/registrations/'+reg,{operationId:operation(),expectedRevision:3,state:'disabled',acknowledgementRef:null}).status,200);
    const target='/v1/events?accountRef='+account;
    assert.equal(JSON.parse(send('GET',target).body.toString()).events.length,1);
    db.prepare('UPDATE tracking_registrations SET confirmed_at=NULL WHERE tenant=? AND id=?').run(tenant,reg);
    assert.equal(send('GET','/v1/registrations/'+reg).status,500);
    assert.equal(send('GET',target).status,500,'A retained confirmed event must not disappear behind the current-row predicate');
  } finally {db.close();collector.close();rmSync(dir,{recursive:true,force:true});}
});
