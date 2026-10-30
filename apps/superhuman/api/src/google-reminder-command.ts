import {HttpError} from './types.ts';
export type GoogleReminderCommand=
 |{kind:'thread-read';threadId:string}
 |{kind:'archive';threadId:string}
 |{kind:'insert';threadId:string;raw:string;important:boolean}
 |{kind:'lookup';internetMessageId:string}
 |{kind:'message-read';messageId:string};
export type GoogleReminderGuard={signal:AbortSignal;assertLive:()=>void;beforeIssue:()=>void};
export type GoogleReminderPrepared=Readonly<{method:'GET'|'POST';path:string;body?:string}>;
const invalid=():never=>{throw new HttpError(400,'Invalid reminder native request','reminder_native_invalid')};
const id=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(v)?v:invalid();
const keys=(v:Record<string,unknown>,expected:string[])=>{if(Object.keys(v).sort().join(',')!==expected.sort().join(','))invalid()};
export function prepareGoogleReminderCommand(input:GoogleReminderCommand):GoogleReminderPrepared{
 let v:GoogleReminderCommand;try{v=structuredClone(input)}catch{return invalid()}if(!v||typeof v!=='object'||Array.isArray(v))return invalid();
 if(v.kind==='thread-read'){keys(v,['kind','threadId']);return Object.freeze({method:'GET',path:`threads/${encodeURIComponent(id(v.threadId))}?format=full`})}
 if(v.kind==='archive'){keys(v,['kind','threadId']);return Object.freeze({method:'POST',path:`threads/${encodeURIComponent(id(v.threadId))}/modify`,body:JSON.stringify({addLabelIds:[],removeLabelIds:['INBOX']})})}
 if(v.kind==='insert'){keys(v,['kind','threadId','raw','important']);if(typeof v.raw!=='string'||!/^[A-Za-z0-9_-]+$/.test(v.raw)||v.raw.length>400000||Buffer.from(v.raw,'base64url').toString('base64url')!==v.raw||typeof v.important!=='boolean')return invalid();return Object.freeze({method:'POST',path:'messages?internalDateSource=receivedTime',body:JSON.stringify({raw:v.raw,threadId:id(v.threadId),labelIds:['INBOX',...(v.important?['IMPORTANT']:[])]})})}
 if(v.kind==='lookup'){keys(v,['kind','internetMessageId']);if(typeof v.internetMessageId!=='string'||!/^<reminder-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}@reconstruction\.invalid>$/.test(v.internetMessageId))return invalid();const q=new URLSearchParams({q:`rfc822msgid:${v.internetMessageId}`,maxResults:'2',includeSpamTrash:'true'});return Object.freeze({method:'GET',path:`messages?${q}`})}
 if(v.kind==='message-read'){keys(v,['kind','messageId']);return Object.freeze({method:'GET',path:`messages/${encodeURIComponent(id(v.messageId))}?format=full`})}
 return invalid();
}
