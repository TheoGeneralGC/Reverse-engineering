import './archive-network-deny.ts';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.ts';
import {GoogleProvider} from '../src/google.ts';
import {ArchiveActionService} from '../src/archive-actions.ts';
import {OperationQueue} from '../src/operation-queue.ts';
import {createApp} from '../src/server.ts';
import {captureCredentialMaintenance,assertCredentialMaintenance} from '../src/google-credential-maintenance.ts';
const denial=(globalThis as any)[Symbol.for('rea.generated-cloud.network-denied')];
if(!denial)throw Error('preload_required');
after(()=>assert.equal(denial.attempts,0));
const account={id:'legacy',provider:'google' as const,email:'own@example.test',name:'Own',color:'#000'};
const thread={id:'legacy:t',accountId:'legacy',providerId:'t',subject:'Synthetic',snippet:'',sender:{name:'Own',email:'own@example.test'},participants:[],lastMessageAt:'2026-10-29T00:00:00.000Z',unread:true,starred:false,important:false,folder:'inbox',labels:[],providerLabels:['INBOX'],messages:[]};
const grant={accountId:'legacy',service:'mail',requestedScopes:['https://www.googleapis.com/auth/gmail.modify'],grantedScopes:['https://www.googleapis.com/auth/gmail.modify'],scopeSource:'response',outcome:'granted',updatedAt:'2026-10-29T00:00:00.000Z'};
function legacy(mode:'valid'|'missing'|'denied'='valid'){const store=new Store(':memory:',false);
store.put('account','legacy',account);
store.put('thread','legacy:t',thread);
const google=new GoogleProvider(store,{DATABASE_PATH:':memory:',TOKEN_ENCRYPTION_KEY:'11'.repeat(32),GOOGLE_CLIENT_ID:'synthetic',GOOGLE_CLIENT_SECRET:'synthetic'},async()=>{throw Error('no_native')}
);
if(mode!=='missing')store.put('googleGrant','mail:legacy',{...grant,...(mode==='denied'?{outcome:'declined'}:{})});
return{store,google,service(){return new ArchiveActionService(store,google,new OperationQueue())}
}}
test('default seeded demo predating provider triggers gets only scoped lifecycle identity and usable cached action basis',async()=>{const app=createApp({databasePath:':memory:',env:{DATABASE_PATH:':memory:'},seed:true,runJobs:false,providerDraftAutomatic:false});
try{const account=app.store.list<any>('account')[0],thread=app.store.list<any>('thread')[0];
assert.deepEqual(app.archiveActions!.adoptedAccounts,[account.id]);
assert(app.archiveActions!.basis(thread.id,account.id));
assert.equal(app.store.db.prepare("SELECT count(*) n FROM auto_draft_ready_events WHERE kind='account-adoption'").get()!.n,1)}
finally{await app.close()}
}
);
test('valid legacy Google may adopt once; denied/missing MAIL grant stays unavailable and cached reads never adopt later',()=>{for(const mode of ['valid','missing','denied']as const){const f=legacy(mode),s=f.service();
try{assert.equal(s.adoptedAccounts.length,mode==='valid'?1:0);
assert.equal(!!s.basis(thread.id,account.id),mode==='valid');
const before=Number(f.store.db.prepare('SELECT total_changes() n').get()!.n);
s.annotate({...thread,messageCount:0});
s.basis(thread.id,account.id);
assert.equal(Number(f.store.db.prepare('SELECT total_changes() n').get()!.n),before);
if(mode!=='valid'){f.store.put('googleGrant','mail:legacy',grant);
const n=Number(f.store.db.prepare('SELECT total_changes() n').get()!.n);
assert.equal(s.basis(thread.id,account.id),null);
assert.equal(Number(f.store.db.prepare('SELECT total_changes() n').get()!.n),n)}
}
finally{s.close();
f.store.close()}
}
}
);
test('existing valid incarnation is exact across a second owner and corrupt existing authority is never reset',()=>{const f=legacy(),s=f.service();
try{const before=f.store.db.prepare('SELECT * FROM auto_draft_ready_accounts').all(),events=f.store.db.prepare('SELECT * FROM auto_draft_ready_events').all(),second=f.service();
assert.deepEqual(second.adoptedAccounts,[]);
assert.deepEqual(f.store.db.prepare('SELECT * FROM auto_draft_ready_accounts').all(),before);
assert.deepEqual(f.store.db.prepare('SELECT * FROM auto_draft_ready_events').all(),events);
second.close();
f.store.db.prepare("UPDATE auto_draft_ready_accounts SET facts='untrusted'").run();
const badBefore=f.store.db.prepare('SELECT * FROM auto_draft_ready_accounts').all(),third=f.service();
assert.equal(third.basis(thread.id,account.id),null);
assert.deepEqual(f.store.db.prepare('SELECT * FROM auto_draft_ready_accounts').all(),badBefore);
third.close()}
finally{s.close();
f.store.close()}
}
);
test('already captured credential maintenance allows only identity adoption noise and preserves its service authority',()=>{const f=legacy();
try{f.google.saveTokens('legacy',{access_token:'synthetic',refresh_token:'synthetic-r',expires_at:0,grantedScopes:grant.grantedScopes});
const sealed=String(f.store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get('legacy')!.value),basis=captureCredentialMaintenance(f.store,'legacy','mail',sealed);
assert.equal(basis.account.authority,null);
const s=f.service();
try{assert.deepEqual(s.adoptedAccounts,['legacy']);
assert.doesNotThrow(()=>assertCredentialMaintenance(f.store,basis));
assert.equal(f.store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get('legacy')!.value,sealed);
assert.deepEqual(f.store.required('googleGrant','mail:legacy'),grant)}
finally{s.close()}
}
finally{f.store.close()}
}
);
test('new Archive schema failure rolls back scoped adoption and metadata heads together without changing old account or grant rows',()=>{const f=legacy();
try{const accounts=f.store.db.prepare("SELECT * FROM records WHERE kind IN('account','googleGrant') ORDER BY kind,id").all();
f.store.db.exec('CREATE VIEW archive_action_operations AS SELECT 1 AS account_id');
assert.throws(()=>f.service());
assert.deepEqual(f.store.db.prepare("SELECT * FROM records WHERE kind IN('account','googleGrant') ORDER BY kind,id").all(),accounts);
assert.equal(f.store.db.prepare('SELECT count(*) n FROM auto_draft_ready_accounts').get()!.n,0);
assert.equal(f.store.db.prepare('SELECT count(*) n FROM auto_draft_ready_events').get()!.n,0);
assert.equal(f.store.db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='archive_action_heads'").get()!.n,0)}
finally{f.store.close()}
}
);
