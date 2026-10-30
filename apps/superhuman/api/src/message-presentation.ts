// Browser-safe descriptive hints. They never authorize server-side admission,
// provider work, exclusions or a canonical returned occurrence.
export type MessagePresentation={version:1;kind:'ordinary'|'system-original'|'system-owned'|'indeterminate'|'unknown';coverage:'full'|'unknown'|'synthetic';hidden:boolean;subject:string|null};
export type ThreadPresentation={version:1;coverage:'full'|'unknown'|'synthetic';replyAvailability:'available'|'unavailable';lastRealMessageId:string|null;versionHash:string;requiresHydration:boolean;reason:string|null};
export type ReminderHeaderFacts={version:1;coverage:'full'|'unknown';accountId:string;accountVersion:string|null;providerThreadId:string;providerMessageId:string;headers:{name:string;value:string}[];subject:string|null;singleAuthor:string|null;snippet?:string;contentHash:string;fingerprint:string;reason:string|null};
type MessageLike={id:string;providerLabels?:string[];reminderPresentation?:MessagePresentation};
type ThreadLike<M extends MessageLike>={providerId?:string;messages:M[];reminderPresentation?:ThreadPresentation};
export function visibleMessages<M extends MessageLike>(thread:ThreadLike<M>):M[]{return thread.messages.filter(m=>{const h=m.reminderPresentation;return !(h?.version===1&&h.coverage==='full'&&h.hidden&&(h.kind==='system-original'||h.kind==='system-owned'))})}
export function lastRealMessage<M extends MessageLike>(thread:ThreadLike<M>):M|null{
 const p=thread.reminderPresentation;if(p?.version===1){if(p.replyAvailability!=='available'||!p.lastRealMessageId)return null;const found=thread.messages.filter(m=>m.id===p.lastRealMessageId);if(found.length!==1)return null;const h=found[0].reminderPresentation;return h?.version===1&&h.kind==='ordinary'&&!h.hidden&&(h.coverage==='full'||h.coverage==='synthetic')?found[0]:null}
 // A provider-backed legacy DTO is never evidence of ordinary Google content.
 if(thread.providerId)return null;return thread.messages.filter(m=>!m.providerLabels?.includes('DRAFT')).at(-1)??null;
}
export const replyReady=<M extends MessageLike>(thread:ThreadLike<M>)=>lastRealMessage(thread)!==null;
