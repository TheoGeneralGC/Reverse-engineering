import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {Store} from '../src/store.ts';
import {GoogleProvider} from '../src/google.ts';
import {GMAIL_SCOPE} from '../src/google-scopes.ts';
import {createApp} from '../src/server.ts';
const at=Date.parse('2026-10-28T22:00:00Z');
const env={GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',TOKEN_ENCRYPTION_KEY:'1'.repeat(64)};
const tokens=(patch:Record<string,unknown>={})=>({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:at+3600000,grantedScopes:[GMAIL_SCOPE],...patch});
const account=(name='a')=>({id:`google:${name}@example.test`,email:`${name}@example.test`,name:'Synthetic '+name,provider:'google' as const,color:'#123456',retainedUnknown:{keep:true}});
function fixture(path=':memory:'){const store=new Store(path,false);let network=0;const google=new GoogleProvider(store,env,(async()=>{network++;throw Error('No provider call allowed')})as typeof fetch,{now:()=>at});const put=(name='a',value=tokens())=>{const a=account(name);store.put('account',a.id,a);google.saveTokens(a.id,value as Parameters<typeof google.saveTokens>[1]);return a};return{store,google,put,network:()=>network,close:()=>store.close()}}
function bytes(store:Store){return{records:store.db.prepare('SELECT kind,id,data FROM records ORDER BY kind,id').all(),secrets:store.db.prepare('SELECT account_id,value FROM secrets ORDER BY account_id').all()}}

test('explicit migration adopts cached scopes only, preserves every token/account byte, and creates no OAuth attempt',()=>{
 const f=fixture();try{const a=f.put(),b=f.put('b',tokens({grantedScopes:['openid','https://mail.google.com/',GMAIL_SCOPE,GMAIL_SCOPE]}));const before=bytes(f.store);assert.equal(f.google.grant(a.id,'mail'),undefined);f.google.status();assert.deepEqual(bytes(f.store),before,'Construction and policy/status reads must not migrate');assert.deepEqual(f.google.migrateLegacyMailGrants(),{adopted:2});const grant=f.google.grant(a.id,'mail')!;assert.deepEqual(grant,{accountId:a.id,service:'mail',requestedScopes:[],grantedScopes:[GMAIL_SCOPE],scopeSource:'token-cache',updatedAt:new Date(at).toISOString(),outcome:'granted'});assert.deepEqual(f.google.grant(b.id,'mail')!.grantedScopes,['openid','https://mail.google.com/',GMAIL_SCOPE]);assert.deepEqual(f.store.db.prepare('SELECT account_id,value FROM secrets ORDER BY account_id').all(),before.secrets);assert.deepEqual(f.store.db.prepare("SELECT kind,id,data FROM records WHERE kind!='googleGrant' ORDER BY kind,id").all(),before.records);assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM records WHERE kind='googleOAuthAttempt'").get()!.n,0);assert.equal(f.network(),0);const migrated=bytes(f.store);assert.deepEqual(f.google.migrateLegacyMailGrants(),{adopted:0});assert.deepEqual(bytes(f.store),migrated)}finally{f.close()}
});

test('every existing mail grant row wins by SQL presence, including partial, null and malformed JSON',()=>{
 for(const raw of ['null','false','{malformed',' {"outcome":"partial","futureMetadata":{"keep":true}} ','{"outcome":"granted","grantedScopes":[]}']){const f=fixture();try{const a=f.put();f.store.db.prepare("INSERT INTO records VALUES('googleGrant',?,?)").run('mail:'+a.id,raw);f.store.put('googleOAuthAttempt','mail:'+a.id,{outcome:'declined',unknown:'preserve'});let decrypts=0;f.google.unseal=()=>{decrypts++;throw Error('An existing record must not be decrypted or overwritten')};const before=bytes(f.store);assert.deepEqual(f.google.migrateLegacyMailGrants(),{adopted:0});assert.equal(decrypts,0);assert.deepEqual(bytes(f.store),before)}finally{f.close()}}
});

test('mail/calendar keys, real Google account association, demo and orphan credentials stay isolated',()=>{
 const f=fixture();try{const a=account('calendar-only');f.store.put('account',a.id,a);f.google.saveTokens(a.id,tokens(),'calendar');const b=f.put('readonly',tokens({grantedScopes:['https://www.googleapis.com/auth/gmail.readonly']}));f.google.saveTokens(b.id,tokens(),'calendar');const demo={...account('demo'),provider:'demo' as const};f.store.put('account',demo.id,demo);f.google.saveTokens(demo.id,tokens());f.google.saveTokens(account('orphan').id,tokens());const mismatched={...account('mismatch'),email:'another@example.test'};f.store.put('account',mismatched.id,mismatched);f.google.saveTokens(mismatched.id,tokens());const collision={...account('prefix'),id:'calendar:'+account('prefix').id};f.store.put('account',collision.id,collision);f.google.saveTokens(collision.id,tokens());f.store.put('googleGrant','calendar:'+b.id,{accountId:b.id,service:'calendar',grantedScopes:[GMAIL_SCOPE],scopeSource:'response',outcome:'partial'});const before=bytes(f.store);assert.deepEqual(f.google.migrateLegacyMailGrants(),{adopted:0});assert.deepEqual(bytes(f.store),before);assert.equal(f.network(),0)}finally{f.close()}
});

test('missing, malformed, read-only or ambiguous cached scope/token shapes never become a grant',()=>{
 const variants=[{grantedScopes:undefined},{grantedScopes:[]},{grantedScopes:GMAIL_SCOPE},{grantedScopes:[GMAIL_SCOPE+' ']},{grantedScopes:[GMAIL_SCOPE.toUpperCase()]},{grantedScopes:[GMAIL_SCOPE,42]},{grantedScopes:[GMAIL_SCOPE,'bad\\scope']},{grantedScopes:[GMAIL_SCOPE,'bad"scope']},{grantedScopes:[GMAIL_SCOPE,'bad\nscope']},{grantedScopes:[GMAIL_SCOPE,...Array(128).fill('openid')]},{grantedScopes:[GMAIL_SCOPE,'x'.repeat(2049)]},{grantedScopes:['https://www.googleapis.com/auth/gmail.readonly']},{scope:GMAIL_SCOPE},{access_token:''},{access_token:'bad\r\nheader'},{refresh_token:undefined},{refresh_token:''},{expires_at:'123'},{expires_at:0},{expires_at:-1},{expires_at:Number.MAX_SAFE_INTEGER+1}];
 for(const patch of variants){const f=fixture();try{f.put('a',tokens(patch));const before=bytes(f.store);assert.deepEqual(f.google.migrateLegacyMailGrants(),{adopted:0},JSON.stringify(Object.keys(patch)));assert.deepEqual(bytes(f.store),before)}finally{f.close()}}
});

test('missing/wrong configuration and corrupt or noncanonical encrypted envelopes are skipped without token changes',()=>{
 for(const config of [{...env,TOKEN_ENCRYPTION_KEY:undefined},{...env,TOKEN_ENCRYPTION_KEY:'not-hex'},{...env,TOKEN_ENCRYPTION_KEY:'2'.repeat(64)},{...env,GOOGLE_CLIENT_ID:undefined}]){const f=fixture();try{f.put();const before=bytes(f.store),provider=new GoogleProvider(f.store,config,(async()=>{throw Error('No provider call')})as typeof fetch);assert.deepEqual(provider.migrateLegacyMailGrants(),{adopted:0});assert.deepEqual(bytes(f.store),before)}finally{f.close()}}
 const f=fixture();try{const a=f.put(),sealed=String(f.store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(a.id)!.value);for(const bad of ['not-encrypted',sealed+'.extra',sealed+'=',sealed.replace(/^./,sealed[0]==='A'?'B':'A')]){f.store.db.prepare('UPDATE secrets SET value=? WHERE account_id=?').run(bad,a.id);const before=bytes(f.store);assert.deepEqual(f.google.migrateLegacyMailGrants(),{adopted:0});assert.deepEqual(bytes(f.store),before)}}finally{f.close()}
});

test('a grant write failure rolls back the entire multi-account batch and leaves token/OAuth bytes unchanged',()=>{
 const f=fixture();try{f.put('a');f.put('b');f.store.put('googleOAuthAttempt','legacy',{outcome:'unchanged'});const before=bytes(f.store);f.store.db.exec("CREATE TEMP TRIGGER deny_second_mail_grant BEFORE INSERT ON records WHEN NEW.kind='googleGrant' AND NEW.id='mail:google:b@example.test' BEGIN SELECT RAISE(ABORT,'controlled second grant failure');END");assert.throws(()=>f.google.migrateLegacyMailGrants(),/controlled second grant failure/);assert.equal(f.store.db.isTransaction,false);assert.deepEqual(bytes(f.store),before);f.store.db.exec('DROP TRIGGER deny_second_mail_grant');assert.deepEqual(f.google.migrateLegacyMailGrants(),{adopted:2});assert.equal(f.network(),0)}finally{f.close()}
});

test('normal expired access with a refresh credential retains only last-observed scopes, without refreshing or claiming current consent',()=>{
 const f=fixture();try{const a=f.put('a',tokens({expires_at:1}));assert.deepEqual(f.google.migrateLegacyMailGrants(),{adopted:1});const grant=f.google.grant(a.id,'mail')!;assert.equal(grant.scopeSource,'token-cache');assert.deepEqual(grant.requestedScopes,[]);assert.equal(f.network(),0);assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM records WHERE kind='googleOAuthAttempt'").get()!.n,0)}finally{f.close()}
});

async function get(app:ReturnType<typeof createApp>,url:string){return new Promise<number>(resolve=>{const request=Object.assign(Readable.from([]),{method:'GET',url,headers:{host:'127.0.0.1'}}),response={setHeader(){},status:0,writeHead(status:number){this.status=status},end(){resolve(this.status)}};app.server.emit('request',request,response)})}
test('createApp invokes migration once at startup, GET reads do not, and a second isolated restart preserves exact grant/token bytes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'legacy-mail-grant-')),path=join(dir,'synthetic.sqlite');const seed=fixture(path),a=seed.put();seed.store.updatePreferences({activeAccountId:a.id});seed.close();const original=GoogleProvider.prototype.migrateLegacyMailGrants;let calls=0;GoogleProvider.prototype.migrateLegacyMailGrants=function(){calls++;return original.call(this)};let app:ReturnType<typeof createApp>|undefined;try{app=createApp({databasePath:path,env:{...env,DATABASE_PATH:path},seed:false,runJobs:false});assert.equal(calls,1);assert.equal(app.google.grant(a.id,'mail')!.scopeSource,'token-cache');const before=bytes(app.store);assert.equal(await get(app,'/api/provider/status'),200);assert.equal(await get(app,'/api/accounts'),200);assert.equal(calls,1);await app.close();app=undefined;app=createApp({databasePath:path,env:{...env,DATABASE_PATH:path},seed:false,runJobs:false});assert.equal(calls,2);assert.deepEqual(bytes(app.store),before)}finally{GoogleProvider.prototype.migrateLegacyMailGrants=original;if(app)await app.close();rmSync(dir,{recursive:true,force:true})}
});

test('an explicit caller transaction is never committed or rolled back by this startup-only migration',()=>{
 const f=fixture();try{f.put();const before=bytes(f.store);f.store.db.exec('BEGIN IMMEDIATE');assert.throws(()=>f.google.migrateLegacyMailGrants(),/own its startup transaction/);assert.equal(f.store.db.isTransaction,true);assert.deepEqual(bytes(f.store),before);f.store.db.exec('ROLLBACK')}finally{if(f.store.db.isTransaction)f.store.db.exec('ROLLBACK');f.close()}
});
