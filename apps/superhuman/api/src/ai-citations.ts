import type { Token } from 'markdown-it';
import type { AiChatAnswer, AiSourceReceipt } from './ai-chat-types.ts';
import { createAiMarkdownParser } from './ai-markdown-policy.ts';

const markdown = createAiMarkdownParser();

export function citationAnswer(text: string, sources: AiSourceReceipt[], truncated: boolean): AiChatAnswer {
  const tokens = markdown.parse(text, { aiCitationSourceIds: new Map(sources.map(s => [s.number, s.id])) }); const found = new Map<number, string>();
  const plain = (items: Token[]): string => items.map(token => {
    if (token.type === 'ai_citation' && token.meta && typeof token.meta.sourceId === 'string') { found.set(Number(token.content), token.meta.sourceId); return `[${token.content}]`; }
    if (token.children) return plain(token.children);
    if (token.type === 'text' || token.type === 'code_inline' || token.type === 'fence' || token.type === 'code_block') return token.content;
    if (token.type === 'softbreak' || token.type === 'hardbreak' || token.type.endsWith('_close') && token.block) return '\n';
    return '';
  }).join('');
  const plainText = plain(tokens).trim(); const citations = [...found].map(([number, sourceId]) => ({ number, sourceId }));
  return { markdown: text, plainText, citations, sourceIds: citations.map(c => c.sourceId), finishReason: 'end_turn', truncated };
}
