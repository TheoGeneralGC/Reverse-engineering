import {AUTO_DRAFT_REPLY_OUTPUT_BYTES} from './auto-drafts-reply-policy.ts';
import {escapeHtml,plainTextFromHtml,plainTextToHtml,sanitizeDraftHtml} from './rich-text.ts';
import {validOutgoingRecipientEmail} from './outgoing-recipients.ts';
import {HttpError,type Message} from './types.ts';

export const REPLY_QUOTE_LIMITS={replyBytes:32768,sourceTextBytes:65536,sourceHtmlBytes:262144,headerBytes:1024,outputBytes:AUTO_DRAFT_REPLY_OUTPUT_BYTES} as const;
const invalid=():never=>{throw new HttpError(400,'Reply quotation source is invalid','auto_draft_reply_quote_invalid')};
const limit=():never=>{throw new HttpError(413,'Reply quotation exceeds its content budget','auto_draft_reply_quote_limit')};
const size=(text:string)=>Buffer.byteLength(text,'utf8');
function text(value:unknown,maxBytes:number):string {
 if(typeof value!=='string'||/[\p{Surrogate}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value))return invalid();
 if(size(value)>maxBytes)return limit();return value.replace(/\r\n?/g,'\n');
}
function header(value:unknown):string {const result=text(value,REPLY_QUOTE_LIMITS.headerBytes);if(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(result))return invalid();return result;}
function attributionDate(raw:unknown,timeZone:unknown):string {
 if(typeof raw!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)||raw.startsWith('0000')||!Number.isFinite(Date.parse(raw))||new Date(raw).toISOString()!==raw)return invalid();
 if(typeof timeZone!=='string'||timeZone.length>100||!/^[-A-Za-z_+]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(timeZone))return invalid();
 let parts:Intl.DateTimeFormatPart[];try{parts=new Intl.DateTimeFormat('en-US',{timeZone,calendar:'gregory',numberingSystem:'latn',weekday:'short',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).formatToParts(new Date(raw));}catch{return invalid();}
 const part=(kind:Intl.DateTimeFormatPartTypes)=>{const value=parts.find(p=>p.type===kind)?.value;if(!value)return invalid();return value;};
 return `${part('weekday')}, ${part('month')} ${part('day')}, ${part('year')} at ${part('hour')}:${part('minute')} ${part('dayPeriod')}`;
}
/** Pure presentation of an already authenticated immutable source snapshot.
 * Does not authorize source/recipient ownership, fetch content, or mutate source.
 * Plain source is literal. HTML-only source is sanitized then decoded once.
 */
export function projectAutoDraftSourceText(source:Readonly<Message>):string {
 if(!source||typeof source!=='object')return invalid();
 const plain=text(source.text,REPLY_QUOTE_LIMITS.sourceTextBytes),html=source.html===undefined?undefined:text(source.html,REPLY_QUOTE_LIMITS.sourceHtmlBytes);
 if(plain.trim()||!html)return plain;
 return text(plainTextFromHtml(sanitizeDraftHtml(html)),REPLY_QUOTE_LIMITS.sourceTextBytes);
}
export function composeAutoDraftReply(source:Readonly<Message>,plainReply:string,timeZone:string):Readonly<{body:string;html:string}> {
 if(!source||typeof source!=='object'||!source.sender)return invalid();
 const reply=text(plainReply,REPLY_QUOTE_LIMITS.replyBytes);if(!reply.trim())return invalid();
 const sourceText=projectAutoDraftSourceText(source);
 const name=header(source.sender.name),email=header(source.sender.email);if(!validOutgoingRecipientEmail(email))return invalid();
 const sender=name.trim()?`${name} <${email}>`:`<${email}>`;
 const attribution=`On ${attributionDate(source.date,timeZone)}, ${sender} wrote:`;
 const body=`${reply}\n\n${attribution}\n${sourceText.split('\n').map(line=>`> ${line}`).join('\n')}`;
 const markup=`${plainTextToHtml(reply)}<div><br></div><div>${escapeHtml(attribution)}</div><blockquote>${plainTextToHtml(sourceText)}</blockquote>`;
 if(size(body)>REPLY_QUOTE_LIMITS.outputBytes||size(markup)>REPLY_QUOTE_LIMITS.outputBytes)return limit();
 const html=sanitizeDraftHtml(markup);if(size(html)>REPLY_QUOTE_LIMITS.outputBytes)return limit();
 return Object.freeze({body,html});
}
