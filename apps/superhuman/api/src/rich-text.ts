import sanitizeHtml from 'sanitize-html';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { HttpError } from './types.ts';

const colorValues = [/^#[a-f\d]{3,4}$/i, /^#[a-f\d]{6}(?:[a-f\d]{2})?$/i, /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i, /^(?:black|white|red|green|blue|yellow|purple|orange|gray|grey|transparent|inherit)$/i];
const fontFamilies = /^(?:["']?)(?:Arial|Helvetica|Georgia|Times New Roman|Courier New|Verdana|Tahoma|Trebuchet MS|sans-serif|serif|monospace|system-ui)(?:["']?)$/i;

/** Server boundary for authored/quoted email markup. No remote media, active
 * elements, arbitrary CSS, classes, event handlers, or executable URL schemes. */
export function sanitizeDraftHtml(input: string) {
  if (typeof input !== 'string') throw new HttpError(400, 'Draft HTML must be a string');
  if (input.length > 500_000) throw new HttpError(413, 'Draft HTML is too large');
  return sanitizeHtml(input, {
    allowedTags: ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'a', 'p', 'div', 'br', 'span', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr'],
    allowedAttributes: { '*': ['style'], a: ['href', 'target', 'rel', 'title'], ol: ['start'] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'textarea', 'option', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'form', 'button', 'select', 'video', 'audio'],
    nestingLimit: 50,
    allowedStyles: {
      '*': {
        color: colorValues,
        'background-color': colorValues,
        'font-weight': [/^(?:normal|bold|[1-9]00)$/i],
        'font-style': [/^(?:normal|italic|oblique)$/i],
        'font-size': [/^(?:[89]|[1-6]\d|7[0-2])px$/i, /^(?:0\.[5-9]|[1-3](?:\.\d{1,2})?|4)(?:em|rem)$/i, /^(?:xx-small|x-small|small|medium|large|x-large|xx-large)$/i],
        'font-family': [fontFamilies],
        'text-decoration': [/^(?:none|underline|line-through|underline line-through|line-through underline)$/i],
        'text-align': [/^(?:left|right|center|justify|start|end)$/i],
        'white-space': [/^(?:normal|pre|pre-wrap|pre-line)$/i],
        'line-height': [/^(?:normal|[1-2](?:\.\d{1,2})?|3)$/i],
        'margin-left': [/^(?:0|[1-9]\d?|1[0-5]\d|160)px$/i, /^(?:0|[1-8](?:\.\d{1,2})?)em$/i],
      },
    },
    transformTags: {
      a: (tagName, attributes) => {
        const next = { ...attributes };
        try { if (!['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(next.href).protocol)) delete next.href; } catch { delete next.href; }
        next.rel = 'noopener noreferrer';
        if (next.target && !['_blank', '_self'].includes(next.target)) delete next.target;
        return { tagName, attribs: next };
      },
      ol: (tagName, attributes) => { const next = { ...attributes }; if (next.start && !/^[1-9]\d{0,5}$/.test(next.start)) delete next.start; return { tagName, attribs: next }; },
    },
  });
}

/** Decode entities and block boundaries with a real HTML parser, after the
 * sanitizer has removed active content. This is a fallback for HTML-only API
 * callers; editors may submit their own plain-text representation alongside it. */
export function plainTextFromHtml(html: string) {
  const document = parseFragment(html); const result: { text: string; verbatim: boolean }[] = [];
  const append = (text: string, verbatim = false) => { const last = result.at(-1); if (last?.verbatim === verbatim) last.text += text; else result.push({ text, verbatim }); };
  const blocks = new Set(['p', 'div', 'blockquote', 'pre', 'ul', 'ol', 'li']);
  function walk(node: DefaultTreeAdapterMap['node'], verbatim = false) {
    if (node.nodeName === '#text') { append((node as DefaultTreeAdapterMap['textNode']).value.replaceAll('\u00a0', ' '), verbatim); return; }
    if (node.nodeName === 'br' || node.nodeName === 'hr') { append('\n', verbatim); return; }
    const block = blocks.has(node.nodeName); if (block && result.length && !result.at(-1)?.text.endsWith('\n')) append('\n', verbatim);
    if (node.nodeName === 'li') append('• ', verbatim);
    if ('childNodes' in node) node.childNodes.forEach(child => walk(child, verbatim || node.nodeName === 'pre'));
    if (block) append('\n', verbatim);
  }
  document.childNodes.forEach(node => walk(node));
  // Paragraph separators are normalized, while authored PRE whitespace is part
  // of the content and must survive in the plain MIME alternative.
  for (const part of result) if (!part.verbatim) part.text = part.text.replace(/\n{3,}/g, '\n\n');
  while (result.length && !result[0].verbatim) { result[0].text = result[0].text.trimStart(); if (result[0].text) break; result.shift(); }
  while (result.length && !result.at(-1)!.verbatim) { const last = result.at(-1)!; last.text = last.text.trimEnd(); if (last.text) break; result.pop(); }
  return result.map(part => part.text).join('');
}

export function plainTextToHtml(text: string) { return `<div>${escapeHtml(text).replaceAll('\n', '<br>')}</div>`; }
export function escapeHtml(text: string) { return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
