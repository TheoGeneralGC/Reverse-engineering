import type { Token } from 'markdown-it';
import { createAiMarkdownParser,safeAiHref } from '../../api/src/ai-markdown-policy.ts';
export { safeAiHref };
export type AiCitation={id:string;label:number};
export const AI_MARKDOWN_MAX_CHARACTERS=32_768;
const MAX_CITATIONS=100;

/** Only unambiguous, server-issued receipts may acquire an interactive label. */
export function aiCitationMap(citations:readonly AiCitation[]):Map<number,string>{
 if(!Array.isArray(citations)||citations.length>MAX_CITATIONS)return new Map();
 const valid=citations.filter(item=>item&&Number.isInteger(item.label)&&item.label>0&&item.label<=999&&typeof item.id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(item.id));
 const labels=new Map<number,number>(),ids=new Map<string,number>();
 for(const item of valid){labels.set(item.label,(labels.get(item.label)??0)+1);ids.set(item.id,(ids.get(item.id)??0)+1)}
 return new Map(valid.filter(item=>labels.get(item.label)===1&&ids.get(item.id)===1).map(item=>[item.label,item.id]));
}
const markdown=createAiMarkdownParser();
export function parseAiMarkdown(text:string,citations:readonly AiCitation[]):Token[]{
 if(text.length>AI_MARKDOWN_MAX_CHARACTERS)throw new RangeError('AI response exceeds the rendering limit');
 return markdown.parse(text,{aiCitationSourceIds:aiCitationMap(citations)});
}
