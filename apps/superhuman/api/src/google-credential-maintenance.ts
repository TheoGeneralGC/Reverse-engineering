import type{Store}from'./store.ts';
import type{GoogleService}from'./google-scopes.ts';
import {HttpError,type Account}from'./types.ts';
import {validOutgoingRecipientEmail}from'./outgoing-recipients.ts';
import {AccountIncarnationAuthority}from'./account-incarnation.ts';

const conflict=():never=>{throw new HttpError(409,'Google service changed while refreshing credentials','google_refresh_superseded')};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const grantFacts=(p:string)=>`json_object('accountId',json_extract(${p}.data,'$.accountId'),'service',json_extract(${p}.data,'$.service'),'outcome',json_extract(${p}.data,'$.outcome'),'sourceValid',CASE WHEN json_extract(${p}.data,'$.scopeSource') IN ('response','requested','token-cache') THEN 1 ELSE 0 END,'scopeType',json_type(${p}.data,'$.grantedScopes'),'countValid',CASE WHEN json_type(${p}.data,'$.grantedScopes')='array' AND json_array_length(${p}.data,'$.grantedScopes')<=128 THEN 1 ELSE 0 END,'scopes',json(CASE WHEN json_type(${p}.data,'$.grantedScopes')='array' THEN (SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(${p}.data,'$.grantedScopes') ORDER BY value)) ELSE '[]' END))`;
type AccountStamp={identity:string;mutation:number;authority:Record<string,unknown>|null};
export type CredentialMaintenanceBasis=Readonly<{accountId:string;service:GoogleService;slot:string;sealed:string;account:AccountStamp;grantId:string;grant:Record<string,unknown>|null}>;
function accountStamp(store:Store,id:string):AccountStamp{
 const account=store.get<Account>('account',id);if(!account||account.id!==id||account.provider!=='google'||!validOutgoingRecipientEmail(account.email))return conflict();
 const mutation=Number(store.db.prepare("SELECT COALESCE(max(sequence),0) sequence FROM auto_draft_ready_events WHERE account_id=? AND kind='account'").get(id)!.sequence),authority=store.db.prepare('SELECT incarnation,epoch,facts,present FROM auto_draft_ready_accounts WHERE account_id=?').get(id)??null;
 const identity=JSON.stringify({id:account.id,provider:account.provider,email:account.email.toLowerCase()});if(!Number.isSafeInteger(mutation)||mutation<0||authority&&(authority.present!==1||authority.facts!==identity||typeof authority.incarnation!=='string'||!/^([a-f0-9]{64})$/.test(authority.incarnation)||!Number.isSafeInteger(authority.epoch)||Number(authority.epoch)<1))return conflict();
 return{identity,mutation,authority};
}
export function initializeCredentialMaintenance(store:Store){
 const db=store.db;db.exec('SAVEPOINT google_credential_schema');try{new AccountIncarnationAuthority(store);const write=(p:string,present:number,create=false)=>`SELECT CASE WHEN (SELECT epoch FROM google_credential_grant_epochs WHERE grant_id=${p}.id)>=9007199254740991 THEN RAISE(ABORT,'Credential grant authority exhausted') END;
 ${create?`INSERT INTO google_credential_grant_epochs VALUES(${p}.id,1,${grantFacts(p)},${present}) ON CONFLICT(grant_id) DO UPDATE SET epoch=epoch+1,facts=excluded.facts,present=excluded.present;`:`UPDATE google_credential_grant_epochs SET epoch=epoch+1,facts=${grantFacts(p)},present=${present} WHERE grant_id=${p}.id;`}`;
 db.exec(`CREATE TABLE IF NOT EXISTS google_credential_grant_epochs(grant_id TEXT PRIMARY KEY NOT NULL,epoch INTEGER NOT NULL,facts TEXT NOT NULL,present INTEGER NOT NULL);
 CREATE TRIGGER IF NOT EXISTS google_credential_grant_insert AFTER INSERT ON records WHEN NEW.kind='googleGrant' BEGIN ${write('NEW',1)} END;
 CREATE TRIGGER IF NOT EXISTS google_credential_grant_update AFTER UPDATE ON records WHEN OLD.kind='googleGrant' OR NEW.kind='googleGrant' BEGIN
 SELECT CASE WHEN OLD.kind='googleGrant' AND (NEW.kind<>'googleGrant' OR OLD.id<>NEW.id) AND (SELECT epoch FROM google_credential_grant_epochs WHERE grant_id=OLD.id)>=9007199254740991 THEN RAISE(ABORT,'Credential grant authority exhausted') END;
 INSERT INTO google_credential_grant_epochs SELECT OLD.id,1,${grantFacts('OLD')},0 WHERE OLD.kind='googleGrant' AND (NEW.kind<>'googleGrant' OR OLD.id<>NEW.id) ON CONFLICT(grant_id) DO UPDATE SET epoch=epoch+1,facts=excluded.facts,present=0;
 SELECT CASE WHEN NEW.kind='googleGrant' AND (OLD.kind<>'googleGrant' OR OLD.id<>NEW.id OR ${grantFacts('OLD')}<>${grantFacts('NEW')}) AND (SELECT epoch FROM google_credential_grant_epochs WHERE grant_id=NEW.id)>=9007199254740991 THEN RAISE(ABORT,'Credential grant authority exhausted') END;
 INSERT INTO google_credential_grant_epochs SELECT NEW.id,1,${grantFacts('NEW')},1 WHERE NEW.kind='googleGrant' AND (OLD.kind<>'googleGrant' OR OLD.id<>NEW.id OR ${grantFacts('OLD')}<>${grantFacts('NEW')}) ON CONFLICT(grant_id) DO UPDATE SET epoch=epoch+1,facts=excluded.facts,present=1;
 END;
 CREATE TRIGGER IF NOT EXISTS google_credential_grant_delete AFTER DELETE ON records WHEN OLD.kind='googleGrant' BEGIN ${write('OLD',0,true)} END;`);db.exec('RELEASE google_credential_schema')}catch(error){db.exec('ROLLBACK TO google_credential_schema;RELEASE google_credential_schema');throw error}
}
function checkedGrant(store:Store,id:string){
 const actual=store.db.prepare(`SELECT ${grantFacts('r')} facts FROM records r WHERE kind='googleGrant' AND id=?`).get(id),head=store.db.prepare('SELECT epoch,facts,present FROM google_credential_grant_epochs WHERE grant_id=?').get(id)??null;
 if(actual?(!head||head.present!==1||head.facts!==actual.facts):head?.present===1)return conflict();
 if(head&&(!Number.isSafeInteger(head.epoch)||Number(head.epoch)<0||![0,1].includes(Number(head.present))||typeof head.facts!=='string'))return conflict();return head;
}
/** Absence and an initial exact refresh seed both represent zero mutations. */
export function credentialGrantMutationEpoch(store:Store,grantId:string){if(!store.db.prepare('SELECT 1 FROM google_credential_grant_epochs WHERE grant_id=?').get(grantId))return 0;return Number(checkedGrant(store,grantId)!.epoch)}
/** Called only when an existing token actually needs refresh. No adoption,
 * provider read, profile/model work, or bulk grant seed occurs here. */
export function captureCredentialMaintenance(store:Store,accountId:string,service:GoogleService,sealed:string):CredentialMaintenanceBasis{
 const db=store.db;db.exec('SAVEPOINT google_credential_capture');try{
  const account=accountStamp(store,accountId),grantId=service+':'+accountId;
  const observed=db.prepare(`SELECT ${grantFacts('r')} facts FROM records r WHERE kind='googleGrant' AND id=?`).get(grantId);db.prepare('INSERT OR IGNORE INTO google_credential_grant_epochs VALUES(?,0,?,?)').run(grantId,observed?String(observed.facts):'absent',observed?1:0);
  const slot=service==='mail'?accountId:'calendar:'+accountId,basis={accountId,service,slot,sealed,account,grantId,grant:checkedGrant(store,grantId)};
  assertCredentialMaintenance(store,basis);db.exec('RELEASE google_credential_capture');return basis;
 }catch(error){db.exec('ROLLBACK TO google_credential_capture;RELEASE google_credential_capture');throw error}
}
/** Must run inside the same write transaction as slot/grant publication. The
 * request/view cancellation signal is intentionally not credential authority. */
export function assertCredentialMaintenance(store:Store,basis:CredentialMaintenanceBasis){
 const current=accountStamp(store,basis.accountId);if(current.identity!==basis.account.identity||current.mutation!==basis.account.mutation)return conflict();
 if(basis.account.authority&&!same(current.authority,basis.account.authority))return conflict();
 if(current.authority&&(current.authority.present!==1||current.authority.facts!==current.identity))return conflict();
 if(store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(basis.slot)?.value!==basis.sealed||!same(checkedGrant(store,basis.grantId),basis.grant))return conflict();
}
