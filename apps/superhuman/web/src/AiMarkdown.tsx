import { createElement } from 'react';
import type { ReactNode } from 'react';
import type { Token } from 'markdown-it';
import { AI_MARKDOWN_MAX_CHARACTERS, parseAiMarkdown, safeAiHref } from './ai-markdown.ts';
import type { AiCitation } from './ai-markdown.ts';

export type AiMarkdownProps = {
  text: string;
  citations: readonly AiCitation[];
  onCitation: (sourceId: string) => void;
  className?: string;
};
const allowed = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
  'strong', 'em', 's', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a']);

function renderTokens(tokens: readonly Token[], onCitation: AiMarkdownProps['onCitation'], prefix = 'md'): ReactNode[] {
  type Frame = { tag: string; props: Record<string, unknown>; children: ReactNode[]; hidden: boolean };
  const output: ReactNode[] = [], stack: Frame[] = [];
  const append = (node: ReactNode) => (stack.at(-1)?.children ?? output).push(node);
  const finish = () => { const frame = stack.pop(); if (frame) append(frame.hidden ? frame.children : createElement(frame.tag, frame.props, ...frame.children)); };
  tokens.forEach((token, index) => {
    const key = `${prefix}-${index}`;
    if (token.nesting === -1) { finish(); return; }
    if (token.nesting === 1) {
      const tag = allowed.has(token.tag) ? token.tag : 'span';
      const props: Record<string, unknown> = { key };
      if (tag === 'a') {
        const href = safeAiHref(String(token.attrGet('href') ?? ''));
        if (href) Object.assign(props, { href, target: '_blank', rel: 'noopener noreferrer' });
        const title = token.attrGet('title'); if (title) props.title = String(title).slice(0, 500);
      }
      if (tag === 'ol') { const start = Number(token.attrGet('start')); if (Number.isInteger(start) && start > 0 && start < 1_000_000) props.start = start; }
      if (tag === 'td' || tag === 'th') { const align = /^text-align:(left|right|center)$/.exec(String(token.attrGet('style') ?? '')); if (align) props.style = { textAlign: align[1] }; }
      stack.push({ tag, props, children: [], hidden: token.hidden });
      return;
    }
    if (token.type === 'inline') append(renderTokens(token.children ?? [], onCitation, key));
    else if (token.type === 'text') append(token.content);
    else if (token.type === 'softbreak' || token.type === 'hardbreak') append(createElement('br', { key }));
    else if (token.type === 'code_inline') append(createElement('code', { key }, token.content));
    else if (token.type === 'code_block' || token.type === 'fence') append(createElement('pre', { key }, createElement('code', null, token.content)));
    else if (token.type === 'hr') append(createElement('hr', { key }));
    else if (token.type === 'ai_citation' && typeof token.meta?.sourceId === 'string') {
      const sourceId: string = token.meta.sourceId;
      append(createElement('button', { key, type: 'button', className: 'ai-citation', 'data-ai-source': sourceId,
        'aria-label': `Source ${token.content}`, onClick: () => onCitation(sourceId) }, token.content));
    } else if (token.content) append(token.content);
  });
  while (stack.length) finish();
  return output;
}

export default function AiMarkdown({ text, citations, onCitation, className = '' }: AiMarkdownProps) {
  // Revalidate receipt values on every render, even when the array is reused.
  const tokens = text.length <= AI_MARKDOWN_MAX_CHARACTERS ? parseAiMarkdown(text, citations) : null;
  if (!tokens) return <div className={`ai-markdown ${className}`} role="alert">This response is too long to display.</div>;
  return <div className={`ai-markdown ${className}`}>{renderTokens(tokens, onCitation)}</div>;
}
