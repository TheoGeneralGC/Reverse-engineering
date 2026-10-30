import type { DatabaseSync } from 'node:sqlite';
import { normalizeContactEmail } from './contacts.ts';
const normalized=(raw:string)=>raw.normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim();
const text=(path:string,field:string)=>`CASE WHEN json_type(${path},'$.${field}')='text' THEN json_extract(${path},'$.${field}') ELSE '' END`;
function snapshot(data:string){
 const messages=`CASE WHEN json_type(${data},'$.messages')='array' THEN json_extract(${data},'$.messages') ELSE '[]' END`;
 const doc="CASE WHEN m.type='object' THEN m.value ELSE '{}' END";
 const sender=`CASE WHEN json_type(${doc},'$.sender')='object' THEN json_extract(${doc},'$.sender') ELSE '{}' END`;
 const recipient="CASE WHEN p.type='object' THEN p.value ELSE '{}' END";
 const list=(field:string)=>`CASE WHEN json_type(${doc},'$.${field}')='array' THEN json_extract(${doc},'$.${field}') ELSE '[]' END`;
 const visible=`NOT(COALESCE(json_extract(${doc},'$.reminderPresentation.version'),0)=1 AND COALESCE(json_extract(${doc},'$.reminderPresentation.coverage'),'')='full' AND COALESCE(json_extract(${doc},'$.reminderPresentation.hidden'),0)=1 AND COALESCE(json_extract(${doc},'$.reminderPresentation.kind'),'') IN ('system-original','system-owned'))`;
 const person=(p:string,invalid='0')=>`json_object('email',substr(${text(p,'email')},1,1025),'name',substr(${text(p,'name')},1,2049),'clipped',(${invalid}) OR length(${text(p,'email')})>1024 OR length(${text(p,'name')})>2048)`;
 const people=`SELECT 'message:'||m.key AS message_key,'from' AS role,0 AS ordinal,${person(sender,`m.type<>'object' OR COALESCE(json_type(${doc},'$.sender'),'null')<>'object'`)} AS person FROM json_each(${messages}) m WHERE ${visible}
 UNION ALL SELECT 'message:'||m.key,'to',p.key,${person(recipient,"p.type<>'object'")} FROM json_each(${messages}) m JOIN json_each(${list('to')}) p WHERE ${visible}
 UNION ALL SELECT 'message:'||m.key,'cc',p.key,${person(recipient,"p.type<>'object'")} FROM json_each(${messages}) m JOIN json_each(${list('cc')}) p WHERE ${visible}
 UNION ALL SELECT 'fallback','from',0,${person(`CASE WHEN json_type(${data},'$.sender')='object' THEN json_extract(${data},'$.sender') ELSE '{}' END`)} WHERE json_array_length(${messages})=0`;
 const invalid=`COALESCE(json_type(${data},'$.subject'),'null')<>'text' OR COALESCE(json_type(${data},'$.messages'),'array')<>'array' OR EXISTS(SELECT 1 FROM json_each(${messages}) m WHERE m.type<>'object' OR COALESCE(json_type(${doc},'$.to'),'array')<>'array' OR COALESCE(json_type(${doc},'$.cc'),'array')<>'array')`;
 return `json_object('subject',substr(${text(data,'subject')},1,32769),'subjectClipped',length(${text(data,'subject')})>32768,'metadataInvalid',${invalid},'people',json(COALESCE((SELECT json_group_array(json_object('message',message_key,'role',role,'ordinal',ordinal,'person',json(person))) FROM (SELECT * FROM (${people}) LIMIT 2049)),'[]')))`;
}
export function initializeSplitHeaders(db:DatabaseSync){
 db.exec('BEGIN IMMEDIATE');try{
  const reminderProjection=!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('split-header-reminder-visible-v1');if(reminderProjection)db.exec('DROP TRIGGER IF EXISTS split_headers_insert;DROP TRIGGER IF EXISTS split_headers_update');
  db.exec(`CREATE TABLE IF NOT EXISTS split_source_generations(account_id TEXT PRIMARY KEY NOT NULL,generation INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS split_header_pending(thread_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,metadata TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS split_header_pending_account ON split_header_pending(account_id,thread_id);
   CREATE TABLE IF NOT EXISTS split_header_facts(thread_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,subject_norm TEXT NOT NULL,incomplete INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS split_header_facts_account ON split_header_facts(account_id,thread_id);
   CREATE TABLE IF NOT EXISTS split_header_people(thread_id TEXT NOT NULL,account_id TEXT NOT NULL,message_key TEXT NOT NULL,role TEXT NOT NULL,ordinal INTEGER NOT NULL,email TEXT NOT NULL,domain TEXT NOT NULL,name TEXT NOT NULL,haystack TEXT NOT NULL,PRIMARY KEY(thread_id,message_key,role,ordinal));
   CREATE INDEX IF NOT EXISTS split_people_thread_role ON split_header_people(account_id,thread_id,role);
   CREATE INDEX IF NOT EXISTS split_people_email_role ON split_header_people(account_id,role,email,thread_id);
   CREATE INDEX IF NOT EXISTS split_people_domain_role ON split_header_people(account_id,role,domain,thread_id);
   CREATE TRIGGER IF NOT EXISTS split_headers_before_insert BEFORE INSERT ON records WHEN NEW.kind='thread' BEGIN
    INSERT INTO split_source_generations SELECT account_id,1 FROM thread_summaries WHERE id=NEW.id ON CONFLICT(account_id) DO UPDATE SET generation=generation+1;
   END;
   CREATE TRIGGER IF NOT EXISTS split_headers_insert AFTER INSERT ON records WHEN NEW.kind='thread' BEGIN
    DELETE FROM split_header_people WHERE thread_id=NEW.id;DELETE FROM split_header_facts WHERE thread_id=NEW.id;
    INSERT OR REPLACE INTO split_header_pending VALUES(NEW.id,json_extract(NEW.data,'$.accountId'),${snapshot('NEW.data')});
    INSERT INTO split_source_generations VALUES(json_extract(NEW.data,'$.accountId'),1) ON CONFLICT(account_id) DO UPDATE SET generation=generation+1;
   END;
   CREATE TRIGGER IF NOT EXISTS split_headers_update AFTER UPDATE ON records WHEN OLD.kind='thread' OR NEW.kind='thread' BEGIN
    DELETE FROM split_header_people WHERE thread_id=OLD.id AND OLD.kind='thread';DELETE FROM split_header_facts WHERE thread_id=OLD.id AND OLD.kind='thread';DELETE FROM split_header_pending WHERE thread_id=OLD.id AND OLD.kind='thread';
    INSERT OR REPLACE INTO split_header_pending SELECT NEW.id,json_extract(NEW.data,'$.accountId'),${snapshot('NEW.data')} WHERE NEW.kind='thread';
    INSERT INTO split_source_generations SELECT json_extract(OLD.data,'$.accountId'),1 WHERE OLD.kind='thread' ON CONFLICT(account_id) DO UPDATE SET generation=generation+1;
    INSERT INTO split_source_generations SELECT json_extract(NEW.data,'$.accountId'),1 WHERE NEW.kind='thread' ON CONFLICT(account_id) DO UPDATE SET generation=generation+1;
   END;
   CREATE TRIGGER IF NOT EXISTS split_headers_delete AFTER DELETE ON records WHEN OLD.kind='thread' BEGIN
    DELETE FROM split_header_people WHERE thread_id=OLD.id;DELETE FROM split_header_facts WHERE thread_id=OLD.id;DELETE FROM split_header_pending WHERE thread_id=OLD.id;
    INSERT INTO split_source_generations VALUES(json_extract(OLD.data,'$.accountId'),1) ON CONFLICT(account_id) DO UPDATE SET generation=generation+1;
   END;
   CREATE TRIGGER IF NOT EXISTS split_label_before_insert BEFORE INSERT ON records WHEN NEW.kind='label' BEGIN
    INSERT INTO split_source_generations SELECT CASE WHEN json_valid(data) THEN json_extract(data,'$.accountId') END,1 FROM records WHERE kind='label' AND id=NEW.id AND CASE WHEN json_valid(data) THEN json_extract(data,'$.accountId') END IS NOT NULL ON CONFLICT(account_id) DO UPDATE SET generation=generation+1;END;
   CREATE TRIGGER IF NOT EXISTS split_label_insert AFTER INSERT ON records WHEN NEW.kind='label' BEGIN INSERT INTO split_source_generations SELECT CASE WHEN json_valid(NEW.data) THEN json_extract(NEW.data,'$.accountId') END,1 WHERE CASE WHEN json_valid(NEW.data) THEN json_extract(NEW.data,'$.accountId') END IS NOT NULL ON CONFLICT(account_id) DO UPDATE SET generation=generation+1;END;
   CREATE TRIGGER IF NOT EXISTS split_label_update AFTER UPDATE ON records WHEN OLD.kind='label' OR NEW.kind='label' BEGIN
    INSERT INTO split_source_generations SELECT CASE WHEN json_valid(OLD.data) THEN json_extract(OLD.data,'$.accountId') ELSE NULL END,1 WHERE OLD.kind='label' AND CASE WHEN json_valid(OLD.data) THEN json_extract(OLD.data,'$.accountId') END IS NOT NULL ON CONFLICT(account_id) DO UPDATE SET generation=generation+1;
    INSERT INTO split_source_generations SELECT CASE WHEN json_valid(NEW.data) THEN json_extract(NEW.data,'$.accountId') ELSE NULL END,1 WHERE NEW.kind='label' AND CASE WHEN json_valid(NEW.data) THEN json_extract(NEW.data,'$.accountId') END IS NOT NULL ON CONFLICT(account_id) DO UPDATE SET generation=generation+1;
   END;
   CREATE TRIGGER IF NOT EXISTS split_label_delete AFTER DELETE ON records WHEN OLD.kind='label' BEGIN INSERT INTO split_source_generations SELECT CASE WHEN json_valid(OLD.data) THEN json_extract(OLD.data,'$.accountId') END,1 WHERE CASE WHEN json_valid(OLD.data) THEN json_extract(OLD.data,'$.accountId') END IS NOT NULL ON CONFLICT(account_id) DO UPDATE SET generation=generation+1;END;`);
  if(!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('split-header-metadata-v1')){
   db.exec(`INSERT OR REPLACE INTO split_header_pending SELECT id,json_extract(data,'$.accountId'),${snapshot('data')} FROM records WHERE kind='thread'`);
   while(refreshSplitHeaders(db,{limit:64})){/* Derived metadata only; no source record/configuration writes. */}
   db.prepare('INSERT INTO schema_migrations VALUES(?)').run('split-header-metadata-v1');
  }
  if(reminderProjection)db.prepare('INSERT INTO schema_migrations VALUES(?)').run('split-header-reminder-visible-v1');
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error}
}
export function refreshSplitHeaders(db:DatabaseSync,options:{threadId?:string;limit?:number}={}):number{
 db.exec('SAVEPOINT split_header_refresh');try{
  const rows=options.threadId?db.prepare('DELETE FROM split_header_pending WHERE thread_id=? RETURNING *').all(options.threadId):db.prepare('DELETE FROM split_header_pending WHERE thread_id IN (SELECT thread_id FROM split_header_pending ORDER BY thread_id LIMIT ?) RETURNING *').all(options.limit??64);
  const insert=db.prepare('INSERT INTO split_header_people VALUES(?,?,?,?,?,?,?,?,?)');
  for(const row of rows){
   db.prepare('DELETE FROM split_header_people WHERE thread_id=?').run(row.thread_id);db.prepare('DELETE FROM split_header_facts WHERE thread_id=?').run(row.thread_id);
   const value=JSON.parse(String(row.metadata))as{subject?:unknown;subjectClipped?:unknown;metadataInvalid?:unknown;people?:unknown};let incomplete=value.subjectClipped===1||value.metadataInvalid===1||typeof value.subject!=='string';const people=Array.isArray(value.people)?value.people:[];if(people.length>2048)incomplete=true;
   for(const item of people.slice(0,2048)){
    if(!item||!['from','to','cc'].includes(item.role)||!Number.isSafeInteger(item.ordinal)||typeof item.message!=='string'||!item.person||typeof item.person.email!=='string'||typeof item.person.name!=='string'){incomplete=true;continue}
    const raw=item.person;if(raw.clipped)incomplete=true;const email=normalizeContactEmail(raw.email)??normalized(raw.email),name=normalized(raw.name.startsWith('"')&&raw.name.endsWith('"')?raw.name.slice(1,-1).replace(/\\(["\\])/g,'$1'):raw.name);if(!email&&!name)continue;const at=email.lastIndexOf('@'),domain=at>=0?email.slice(at+1):'';
    insert.run(row.thread_id,row.account_id,item.message,item.role,item.ordinal,email,domain,name,`${name} ${email}`);
   }
   db.prepare('INSERT INTO split_header_facts VALUES(?,?,?,?)').run(row.thread_id,row.account_id,normalized(typeof value.subject==='string'?value.subject:''),incomplete?1:0);
  }
  db.exec('RELEASE split_header_refresh');return rows.length;
 }catch(error){db.exec('ROLLBACK TO split_header_refresh; RELEASE split_header_refresh');throw error}
}
export function splitSourceGeneration(db:DatabaseSync,accountId:string){return Number(db.prepare('SELECT generation FROM split_source_generations WHERE account_id=?').get(accountId)?.generation??0)}
