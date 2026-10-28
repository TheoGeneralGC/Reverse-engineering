import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { transformWithOxc } from 'vite';
import { JSDOM } from 'jsdom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AI_MARKDOWN_MAX_CHARACTERS, aiCitationMap, safeAiHref } from '../src/ai-markdown.ts';

const path = fileURLToPath(new URL('../src/AiMarkdown.tsx', import.meta.url));
const compiled = (await transformWithOxc(readFileSync(path, 'utf8'), path, { jsx: { runtime: 'automatic' } })).code;
const hook = registerHooks({ load(url, context, next) { return url === pathToFileURL(path).href ? { format: 'module', shortCircuit: true, source: compiled } : next(url, context); } });
const { default: AiMarkdown } = await import('../src/AiMarkdown.tsx');
hook.deregister();
const receipts = [{ id: 'owned-source-1', label: 1 }];
const render = (text: string, citations = receipts) => JSDOM.fragment(renderToStaticMarkup(createElement(AiMarkdown, { text, citations, onCitation: () => {} })));

test('AI answers render headings, bold lists, tables and literal inline code with Unicode facts', () => {
  const fragment = render('## Synthetic samples\n\n- **Cedar** has 3 samples\n- **Birch** has 2 samples\n\n| Name | Samples |\n| --- | --- |\n| Cedar | 3 |\n| Birch | 2 |\n\nExample: `samples.set("Café", 3)`');
  assert.equal(fragment.querySelector('h2')?.textContent, 'Synthetic samples');
  assert.deepEqual(Array.from(fragment.querySelectorAll('li strong'), node => node.textContent), ['Cedar', 'Birch']);
  assert.equal(fragment.querySelectorAll('tbody tr').length, 2);
  assert.deepEqual(Array.from(fragment.querySelectorAll('tbody td'), node => node.textContent), ['Cedar', '3', 'Birch', '2']);
  assert.equal(fragment.querySelector('code')?.textContent, 'samples.set("Café", 3)');
});

test('only reserved prose tokens with unambiguous current-turn receipts become citation buttons', () => {
  const fragment = render('Known [cite:1]. Unknown [cite:2]. Ordinary [1]. Escaped \\[cite:1].\n\n`[cite:1]`\n\n```text\n[cite:1]\n```\n\n[cite:1](https://example.test)\n\n[Link with [cite:1]](https://example.test)');
  const buttons = fragment.querySelectorAll('button');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].textContent, '1');
  assert.equal(buttons[0].getAttribute('data-ai-source'), 'owned-source-1');
  assert.equal(buttons[0].getAttribute('aria-label'), 'Source 1');
  assert.match(fragment.textContent!, /Unknown \[cite:2\]. Ordinary \[1\]. Escaped \[cite:1\]/);
  assert.deepEqual(Array.from(fragment.querySelectorAll('code'), node => node.textContent), ['[cite:1]', '[cite:1]\n']);
  assert.equal(fragment.querySelector('a button'), null);
  assert.equal(fragment.querySelectorAll('a').length, 2);
});

test('raw HTML, event handlers, images and executable or application links cannot become active markup', () => {
  const payload = '<script>globalThis.injected=true</script><img src="https://tracking.example.test/pixel" onerror="alert(1)"><svg onload="alert(1)"></svg>\n\n![tracking](https://tracking.example.test/pixel)\n\n[JS](javascript:alert(1)) [data](data:text/html,boom) [file](file:///etc/passwd) [app](/api/drafts/delete) [ftp](ftp://example.test) [relative](//example.test)\n\n<button data-ai-source="forged" onclick="alert(1)">Forged</button>';
  const fragment = render(payload);
  assert.equal(fragment.querySelector('script,img,svg,iframe,object,style,button'), null);
  assert.match(fragment.textContent!, /<script>/);
  for (const link of fragment.querySelectorAll('a')) assert.ok(safeAiHref(link.getAttribute('href')!));
  for (const element of fragment.querySelectorAll('*')) for (const attribute of element.attributes) assert.ok(!/^on/i.test(attribute.name));
  assert.equal(fragment.querySelector('a[href*="/api/"]'), null);
});

test('ordinary external links have safe destinations and opener isolation', () => {
  const fragment = render('[Docs](https://example.test/docs "Reference") and [Mail](mailto:person@example.test)');
  const links = fragment.querySelectorAll('a');
  assert.equal(links.length, 2);
  assert.equal(links[0].getAttribute('title'), 'Reference');
  for (const link of links) { assert.equal(link.getAttribute('target'), '_blank'); assert.equal(link.getAttribute('rel'), 'noopener noreferrer'); }
  for (const url of ['javascript:alert(1)', 'data:text/html,test', '/api', '//example.test', 'https://person:secret@example.test', 'mailto:person@example.test?body=hello%0D%0Aworld', 'https://example.test/%0a']) assert.equal(safeAiHref(url), null);
});

test('duplicate, ambiguous and forged receipt labels never create source navigation', () => {
  for (const citations of [
    [{ id: 'one', label: 1 }, { id: 'two', label: 1 }],
    [{ id: 'one', label: 1 }, { id: 'one', label: 2 }],
    [{ id: 'bad" onclick="x', label: 1 }],
    [{ id: 'one', label: 0 }],
    [{ id: 'one', label: 1.5 }],
  ]) assert.equal(render('[cite:1] [cite:2]', citations).querySelector('button'), null);
  assert.equal(aiCitationMap(Array.from({ length: 101 }, (_, index) => ({ id: 'source-' + index, label: index + 1 }))).size, 0);
});

test('over-limit answers are explicit and cannot partially activate citations', () => {
  const fragment = render('x'.repeat(AI_MARKDOWN_MAX_CHARACTERS) + '[cite:1]');
  assert.match(fragment.querySelector('[role="alert"]')?.textContent ?? '', /too long/);
  assert.equal(fragment.querySelector('button'), null);
});

test('an actual citation click dispatches only its trusted receipt ID and replacement clears old bindings', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const host = dom.window.document.querySelector('#root')!, root = createRoot(host), calls: string[] = [];
  try {
    await act(async () => root.render(createElement(AiMarkdown, { text: 'Fact [cite:1]', citations: receipts, onCitation: sourceId => calls.push(sourceId) })));
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    assert.deepEqual(calls, ['owned-source-1']);
    await act(async () => root.render(createElement(AiMarkdown, { text: 'Fact [cite:1]', citations: [], onCitation: sourceId => calls.push(sourceId) })));
    assert.equal(host.querySelector('button'), null);
    assert.match(host.textContent!, /\[cite:1\]/);
    assert.deepEqual(calls, ['owned-source-1']);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
