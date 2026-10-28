import type { Draft } from './api.ts';
// Recognize only the editor's small empty-markup language. Unknown text,
// attributes, entities or structural/media tags are retained conservatively.
export function isDiscardableDraft(draft:Pick<Draft,'to'|'cc'|'bcc'|'subject'|'body'|'html'|'attachments'|'providerDraftId'|'status'>):boolean{
 if(!['draft','failed'].includes(draft.status)||draft.providerDraftId||[draft.to,draft.cc,draft.bcc,draft.subject,draft.body].some(value=>value!==''))return false;
 if(draft.attachments!==undefined&&(!Array.isArray(draft.attachments)||draft.attachments.length>0))return false;
 return isEmptyEditorHTML(draft.html);
}
export function isEmptyEditorHTML(html:string|undefined):boolean{
 if(html===undefined||html==='')return true;if(typeof html!=='string')return false;
 const source=html,token=/[\t\n\f\r ]+|<(\/?)(div|p|br)[\t\n\f\r ]*(\/?)>/giy,stack:string[]=[];let offset=0;
 while(offset<source.length){token.lastIndex=offset;const match=token.exec(source);if(!match)return false;offset=token.lastIndex;if(!match[2])continue;const closing=match[1]==='/',tag=match[2].toLowerCase(),self=match[3]==='/';if(tag==='br'){if(closing)return false;continue}if(self)return false;if(closing){if(stack.pop()!==tag)return false}else stack.push(tag);}
 return stack.length===0;
}
