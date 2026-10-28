import type { Draft } from './api.ts';
type Change={id:string;accountId:string;updatedAt:string;revision:number;draft:Draft|null};
const stamp=(value:string)=>Number.isFinite(Date.parse(value))?Date.parse(value):0;
export function createDraftCache(){
 let revision=0;const changes=new Map<string,Change>();
 const apply=(drafts:Draft[],change:Change,accountIds:ReadonlySet<string>)=>{
  if(!accountIds.has(change.accountId))return drafts;
  const existing=drafts.find(draft=>draft.id===change.id);
  if(existing&&existing.accountId!==change.accountId)return drafts;
  if(!change.draft)return drafts.filter(draft=>draft.id!==change.id);
  if(existing&&stamp(existing.updatedAt)>stamp(change.updatedAt))return drafts;
  return existing?drafts.map(draft=>draft.id===change.id?change.draft!:draft):[change.draft,...drafts];
 };
 return{
  getRevision:()=>revision,
  acknowledge(draft:Draft,removed=false){
   const old=changes.get(draft.id),time=stamp(draft.updatedAt),terminal=removed||draft.status==='sent';
   // Sent and deleted IDs are terminal in this API; a delayed earlier PATCH
   // must not resurrect them even when its timestamp is later than our last ACK.
   if(old&&(old.accountId!==draft.accountId||!old.draft||!terminal&&stamp(old.updatedAt)>time))return null;
   const updatedAt=terminal&&old&&stamp(old.updatedAt)>time?old.updatedAt:draft.updatedAt;
   const change:Change={id:draft.id,accountId:draft.accountId,updatedAt,revision:++revision,draft:terminal?null:draft};changes.set(draft.id,change);return change;
  },
  apply,
  overlay(drafts:Draft[],since:number,accountIds:ReadonlySet<string>){let next=drafts;for(const change of changes.values())if(change.revision>since)next=apply(next,change,accountIds);return next},
 };
}
