import type {Store} from './store.ts';
import {currentAccountIncarnation} from './account-incarnation.ts';
import {archiveHex,archiveHash,type ArchiveBasis} from './archive-action-contract.ts';
// Action metadata, independent of reply FULL/header authority. Contact names,
// read/star/labels/snippet/tracking/presentation renewals do not advance the head.
const facts=(p:string)=>`json_object('id',${p}.id,'accountId',json_extract(${p}.data,'$.accountId'),'providerId',json_extract(${p}.data,'$.providerId'),'subject',json_extract(${p}.data,'$.subject'),'folder',json_extract(${p}.data,'$.folder'),'snoozedUntil',json_extract(${p}.data,'$.snoozedUntil'),'snoozeRetryAt',json_extract(${p}.data,'$.snoozeRetryAt'),'snoozeError',json_extract(${p}.data,'$.snoozeError'),'placement',json(COALESCE((SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(${p}.data,'$.providerLabels') WHERE value IN('INBOX','TRASH','SPAM') ORDER BY value)),'[]')),'messages',json(COALESCE((SELECT json_group_array(json_object('id',json_extract(m.value,'$.id'),'from',lower(json_extract(m.value,'$.sender.email')),'date',json_extract(m.value,'$.date'),'internetMessageId',json_extract(m.value,'$.internetMessageId'),'references',json_extract(m.value,'$.references'),'text',json_extract(m.value,'$.text'),'html',json_extract(m.value,'$.html'),'attachments',json(COALESCE(json_extract(m.value,'$.attachments'),'[]')),'draft',EXISTS(SELECT 1 FROM json_each(m.value,'$.providerLabels') WHERE value='DRAFT'))) FROM json_each(${p}.data,'$.messages') m),'[]')))`;
export function initializeArchiveBasis(store:Store){const db=store.db,existed=!!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='archive_action_heads'").get();
db.exec('SAVEPOINT archive_basis_schema');
try{db.exec(`CREATE TABLE IF NOT EXISTS archive_action_heads(thread_id TEXT PRIMARY KEY,epoch INTEGER NOT NULL,facts TEXT NOT NULL,present INTEGER NOT NULL,account_id TEXT NOT NULL,source_version TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS archive_action_insert AFTER INSERT ON records WHEN NEW.kind='thread' BEGIN
 SELECT CASE WHEN (SELECT epoch FROM archive_action_heads WHERE thread_id=NEW.id)>=9007199254740991 THEN RAISE(ABORT,'Archive source authority exhausted') END;
 INSERT INTO archive_action_heads VALUES(NEW.id,1,${facts('NEW')},1,json_extract(NEW.data,'$.accountId'),lower(hex(randomblob(32)))) ON CONFLICT(thread_id) DO UPDATE SET epoch=epoch+1,facts=excluded.facts,present=1,account_id=excluded.account_id,source_version=excluded.source_version;END;
 CREATE TRIGGER IF NOT EXISTS archive_action_update AFTER UPDATE ON records WHEN OLD.kind='thread' OR NEW.kind='thread' BEGIN
 SELECT CASE WHEN OLD.kind='thread' AND (NEW.kind<>'thread' OR OLD.id<>NEW.id) AND (SELECT epoch FROM archive_action_heads WHERE thread_id=OLD.id)>=9007199254740991 THEN RAISE(ABORT,'Archive source authority exhausted') END;
 INSERT INTO archive_action_heads SELECT OLD.id,1,${facts('OLD')},0,json_extract(OLD.data,'$.accountId'),lower(hex(randomblob(32))) WHERE OLD.kind='thread' AND (NEW.kind<>'thread' OR OLD.id<>NEW.id) ON CONFLICT(thread_id) DO UPDATE SET epoch=epoch+1,facts=excluded.facts,present=0,account_id=excluded.account_id,source_version=excluded.source_version;
 SELECT CASE WHEN NEW.kind='thread' AND (OLD.kind<>'thread' OR OLD.id<>NEW.id OR ${facts('OLD')}<>${facts('NEW')}) AND (SELECT epoch FROM archive_action_heads WHERE thread_id=NEW.id)>=9007199254740991 THEN RAISE(ABORT,'Archive source authority exhausted') END;
 INSERT INTO archive_action_heads SELECT NEW.id,1,${facts('NEW')},1,json_extract(NEW.data,'$.accountId'),lower(hex(randomblob(32))) WHERE NEW.kind='thread' AND (OLD.kind<>'thread' OR OLD.id<>NEW.id OR ${facts('OLD')}<>${facts('NEW')}) ON CONFLICT(thread_id) DO UPDATE SET epoch=epoch+1,facts=excluded.facts,present=1,account_id=excluded.account_id,source_version=excluded.source_version;END;
 CREATE TRIGGER IF NOT EXISTS archive_action_delete AFTER DELETE ON records WHEN OLD.kind='thread' BEGIN
 SELECT CASE WHEN (SELECT epoch FROM archive_action_heads WHERE thread_id=OLD.id)>=9007199254740991 THEN RAISE(ABORT,'Archive source authority exhausted') END;
 INSERT INTO archive_action_heads VALUES(OLD.id,1,${facts('OLD')},0,json_extract(OLD.data,'$.accountId'),lower(hex(randomblob(32)))) ON CONFLICT(thread_id) DO UPDATE SET epoch=epoch+1,facts=excluded.facts,present=0,account_id=excluded.account_id,source_version=excluded.source_version;END;
`);
if(!existed)db.exec(`INSERT INTO archive_action_heads SELECT r.id,1,${facts('r')},1,json_extract(r.data,'$.accountId'),lower(hex(randomblob(32))) FROM records r WHERE kind='thread'`);
db.exec('RELEASE archive_basis_schema')}
catch(e){db.exec('ROLLBACK TO archive_basis_schema;RELEASE archive_basis_schema');
throw e}
}
export function actionBasis(store:Store,threadId:string,accountId:string):ArchiveBasis|null{try{const accountVersion=currentAccountIncarnation(store,accountId),head=store.db.prepare('SELECT epoch,present,source_version,account_id FROM archive_action_heads WHERE thread_id=?').get(threadId);
if(!head||head.account_id!==accountId||head.present!==1||!Number.isSafeInteger(head.epoch)||Number(head.epoch)<1||!archiveHex(head.source_version))return null;
return{version:1,accountVersion,sourceVersion:archiveHash({version:1,threadId,accountId,epoch:head.epoch,nonce:head.source_version})}}
catch{return null}
}
export function verifiedActionBasis(store:Store,threadId:string,accountId:string):ArchiveBasis|null{const basis=actionBasis(store,threadId,accountId);
if(!basis)return null;
const head=store.db.prepare(`SELECT h.facts,${facts('r')} actual FROM archive_action_heads h JOIN records r ON r.kind='thread' AND r.id=h.thread_id WHERE h.thread_id=? AND json_extract(r.data,'$.accountId')=?`).get(threadId,accountId);
return head&&head.facts===head.actual?basis:null}
