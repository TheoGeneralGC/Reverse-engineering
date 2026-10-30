import type {Store} from './store.ts';
import {HttpError,type Account} from './types.ts';
import {validOutgoingRecipientEmail} from './outgoing-recipients.ts';
// Shared model-independent subset of the existing AutoDraft readiness authority.
// Same table/trigger names and identity facts; no profile, model, provider or IO.
const facts=(a:Account)=>JSON.stringify({id:a.id,provider:a.provider,email:a.email.toLowerCase()});
/** Read-only access to the same durable registry. A cached GET never creates or
 * adopts authority merely to render a message. */
export function currentAccountIncarnation(store:Store,id:string):string{
 const a=store.get<Account>('account',id);if(!a||a.id!==id||!['google','demo'].includes(a.provider)||!validOutgoingRecipientEmail(a.email)||!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='auto_draft_ready_accounts'").get())throw new HttpError(404,'Reminder account authority is unavailable','reminder_not_found');
 const r=store.db.prepare('SELECT * FROM auto_draft_ready_accounts WHERE account_id=?').get(id);if(!r||r.present!==1||r.facts!==facts(a)||typeof r.incarnation!=='string'||!/^[a-f0-9]{64}$/.test(r.incarnation)||!Number.isSafeInteger(r.epoch)||Number(r.epoch)<1)throw new HttpError(404,'Reminder account authority is unavailable','reminder_not_found');return r.incarnation;
}
const sql=(p:string)=>`json_object('id',json_extract(${p}.data,'$.id'),'provider',json_extract(${p}.data,'$.provider'),'email',lower(json_extract(${p}.data,'$.email')))`;
export class AccountIncarnationAuthority{
 private serial=0;
 readonly store:Store;
 constructor(store:Store){this.store=store;store.db.exec(`CREATE TABLE IF NOT EXISTS auto_draft_ready_accounts(account_id TEXT PRIMARY KEY,incarnation TEXT NOT NULL,epoch INTEGER NOT NULL,facts TEXT NOT NULL,present INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS auto_draft_ready_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK(sequence<=9007199254740991),account_id TEXT NOT NULL,kind TEXT NOT NULL);`);
 const write=(p:string,present:number)=>`SELECT CASE WHEN (SELECT epoch FROM auto_draft_ready_accounts WHERE account_id=${p}.id)>=9007199254740991 THEN RAISE(ABORT,'Account authority exhausted') END;
 INSERT INTO auto_draft_ready_accounts VALUES(${p}.id,lower(hex(randomblob(32))),1,${sql(p)},${present}) ON CONFLICT(account_id) DO UPDATE SET incarnation=lower(hex(randomblob(32))),epoch=auto_draft_ready_accounts.epoch+1,facts=excluded.facts,present=excluded.present;
 INSERT INTO auto_draft_ready_events(account_id,kind) VALUES(${p}.id,'account');`;
 store.db.exec(`CREATE TRIGGER IF NOT EXISTS auto_draft_account_insert AFTER INSERT ON records WHEN NEW.kind='account' BEGIN ${write('NEW',1)} END;
 CREATE TRIGGER IF NOT EXISTS auto_draft_account_update AFTER UPDATE OF data ON records WHEN NEW.kind='account' AND ${sql('OLD')}<>${sql('NEW')} BEGIN ${write('NEW',1)} END;
 CREATE TRIGGER IF NOT EXISTS auto_draft_account_delete AFTER DELETE ON records WHEN OLD.kind='account' BEGIN ${write('OLD',0)} END;`);}
 account(id:string):Account{const a=this.store.get<Account>('account',id);if(!a||a.id!==id||!['google','demo'].includes(a.provider)||!validOutgoingRecipientEmail(a.email))throw new HttpError(404,'Reminder account is unavailable','reminder_not_found');return a}
 version(id:string):string{return currentAccountIncarnation(this.store,id)}
 adoptAccount(id:string){const name=`reminder_account_adopt_${++this.serial}`;this.store.db.exec(`SAVEPOINT ${name}`);try{const a=this.account(id),old=this.store.db.prepare('SELECT 1 FROM auto_draft_ready_accounts WHERE account_id=?').get(id);if(!old){this.store.db.prepare('INSERT INTO auto_draft_ready_accounts VALUES(?,lower(hex(randomblob(32))),1,?,1)').run(id,facts(a));this.store.db.prepare("INSERT INTO auto_draft_ready_events(account_id,kind) VALUES(?,'account-adoption')").run(id)}const version=this.version(id);this.store.db.exec(`RELEASE ${name}`);return version}catch(e){this.store.db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);throw e}}
 adoptAccounts(){const name=`reminder_account_adopt_${++this.serial}`;this.store.db.exec(`SAVEPOINT ${name}`);try{const adopted:string[]=[];for(const r of this.store.db.prepare("SELECT id,data FROM records WHERE kind='account' ORDER BY id").all()){const a=JSON.parse(String(r.data)) as Account;if(!['google','demo'].includes(a.provider))continue;if(a.id!==r.id)throw new HttpError(404,'Reminder account is unavailable','reminder_not_found');this.account(a.id);const old=this.store.db.prepare('SELECT * FROM auto_draft_ready_accounts WHERE account_id=?').get(a.id);if(!old){this.store.db.prepare('INSERT INTO auto_draft_ready_accounts VALUES(?,lower(hex(randomblob(32))),1,?,1)').run(a.id,facts(a));this.store.db.prepare("INSERT INTO auto_draft_ready_events(account_id,kind) VALUES(?,'account-adoption')").run(a.id);adopted.push(a.id)}else this.version(a.id)}this.store.db.exec(`RELEASE ${name}`);return adopted}catch(e){this.store.db.exec(`ROLLBACK TO ${name};RELEASE ${name}`);throw e}}
}
