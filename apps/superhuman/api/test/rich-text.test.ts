import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';
import { createApp } from '../src/server.ts';
import { buildMime } from '../src/mime.ts';
import { plainTextFromHtml, sanitizeDraftHtml } from '../src/rich-text.ts';
import type { Account, Draft, Thread } from '../src/types.ts';

test('authored rich HTML preserves allowed formatting but removes active content, remote media and arbitrary CSS', () => {
  const html = sanitizeDraftHtml(`<div class="bad" id="bad" onclick="alert(1)" style="color:rgb(23, 45, 67);font-weight:bold;background-image:url(https://remote.invalid/pixel);position:fixed"><strong>Bold</strong><i>Italic</i><u>Under</u><s>Strike</s><ul><li>Item</li></ul><blockquote>Quote</blockquote><script>HIDDEN_SCRIPT</script><style>HIDDEN_STYLE</style><img src="https://remote.invalid/tracker" onerror="alert(1)"><iframe>HIDDEN_FRAME</iframe><svg><a href="javascript:alert(1)">HIDDEN_SVG</a></svg></div>`);
  for (const expected of ['<strong>Bold</strong>', '<i>Italic</i>', '<u>Under</u>', '<s>Strike</s>', '<ul><li>Item</li></ul>', '<blockquote>Quote</blockquote>', 'color:rgb(23, 45, 67)', 'font-weight:bold']) assert.ok(html.includes(expected), expected);
  for (const forbidden of ['onclick', 'class=', 'id=', 'background-image', 'position:', 'remote.invalid', '<img', '<script', '<iframe', '<svg', 'HIDDEN_']) assert.ok(!html.includes(forbidden), forbidden);
});

test('link schemes and entity-encoded attacks are sanitized with safe link attributes', () => {
  const html = sanitizeDraftHtml('<a href="https://example.test/path?q=1&amp;x=2" target="_blank" rel="opener">Safe</a><a href="java&#x09;script:alert(1)">Bad</a><a href="data:text/html,attack">Data</a><a href="//remote.invalid">Protocol relative</a><a href="/local">Relative</a><a href="mailto:fixture@example.test">Email</a>');
  assert.ok(html.includes('href="https://example.test/path?q=1&amp;x=2"')); assert.ok(html.includes('rel="noopener noreferrer"')); assert.ok(html.includes('href="mailto:fixture@example.test"'));
  assert.ok(!html.includes('javascript:')); assert.ok(!html.includes('data:')); assert.ok(!html.includes('href="//')); assert.ok(!html.includes('href="/local"'));
  assert.equal(plainTextFromHtml(sanitizeDraftHtml('<div>A &amp; B</div><div>Line<br>two</div>')), 'A & B\nLine\ntwo');
  assert.throws(() => sanitizeDraftHtml('x'.repeat(500_001)), /too large/);
});

test('rich drafts persist both representations across restart and plain-only edits clear stale markup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'superhuman-rich-draft-')); const path = join(directory, 'mail.sqlite');
  try {
    let store = new Store(path); const draft = store.saveDraft({ to: 'recipient@example.test', body: 'Plain fallback', html: '<p><b>Rich</b> &amp; formatted<script>bad()</script></p>' }); store.close();
    store = new Store(path); const saved = store.required<Draft>('draft', draft.id); assert.equal(saved.body, 'Plain fallback'); assert.equal(saved.html, '<p><b>Rich</b> &amp; formatted</p>');
    const recipientOnly = store.saveDraft({ id: draft.id, subject: 'A subject' }); assert.equal(recipientOnly.html, saved.html);
    const plainEdit = store.saveDraft({ id: draft.id, body: 'Fresh plain text' }); assert.equal(plainEdit.html, undefined); assert.equal(plainEdit.body, 'Fresh plain text');
    const htmlOnly = store.saveDraft({ html: '<p>Visible &amp; safe</p><p>Next line</p>' }); assert.equal(htmlOnly.body, 'Visible & safe\nNext line'); store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('HTML-only draft fallback preserves PRE indentation and intentional blank lines', () => {
  const store = new Store(':memory:');
  try {
    const code = '  first line\n\n\n    second line  \n';
    assert.equal(plainTextFromHtml(sanitizeDraftHtml(`<pre><code>${code}</code></pre>`)), code);
    const draft = store.saveDraft({ html: `<pre><code>${code}</code></pre>` });
    assert.equal(draft.body, code);
    assert.equal(plainTextFromHtml(sanitizeDraftHtml('<div>Before</div><pre>  indented</pre><div>After</div>')), 'Before\n  indented\nAfter');
  } finally { store.close(); }
});

type MimeNode = { type: string; headers: Map<string, string>; children: MimeNode[]; bytes: Buffer };
// Fixture-focused MIME reader: obtains boundaries from headers and independently
// decodes transfer encodings so tests verify actual nested wire parts/content.
function readMime(raw: string): MimeNode {
  const split = raw.indexOf('\r\n\r\n'); assert.ok(split >= 0); const headerBlock = raw.slice(0, split).replace(/\r\n[ \t]+/g, ' '); const body = raw.slice(split + 4);
  const headers = new Map(headerBlock.split('\r\n').map(line => { const colon = line.indexOf(':'); return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()]; }));
  const contentType = headers.get('content-type') ?? 'text/plain'; const type = contentType.split(';')[0]; const boundary = contentType.match(/boundary="([^"]+)"/)?.[1];
  if (type.startsWith('multipart/')) { assert.ok(boundary); const segments = body.split(`--${boundary}`).slice(1); const children = segments.filter(segment => !segment.startsWith('--')).map(segment => readMime(segment.replace(/^\r\n/, '').replace(/\r\n$/, ''))); return { type, headers, children, bytes: Buffer.alloc(0) }; }
  return { type, headers, children: [], bytes: headers.get('content-transfer-encoding') === 'base64' ? Buffer.from(body.replaceAll('\r\n', ''), 'base64') : Buffer.from(body) };
}

test('rich MIME nests plain/html alternatives inside mixed attachments and keeps UTF-8 bytes intact', () => {
  const store = new Store(':memory:'); const account = store.required<Account>('account', 'demo');
  const draft = store.saveDraft({ to: 'recipient@example.test', subject: 'Unicode ✨', body: 'Hello ✨\nSecond line', html: '<div><b>Hello ✨</b><br>Second line</div><script>bad()</script>' });
  const bytes = Buffer.from([0, 127, 128, 255]); const file = { id: 'fixture', name: 'résumé.bin', mimeType: 'application/octet-stream', size: bytes.length };
  const parsed = readMime(buildMime(draft, account, undefined, [{ metadata: file, bytes }]));
  assert.equal(parsed.type, 'multipart/mixed'); assert.equal(parsed.children.length, 2); const alternatives = parsed.children[0]; assert.equal(alternatives.type, 'multipart/alternative'); assert.deepEqual(alternatives.children.map(child => child.type), ['text/plain', 'text/html']);
  assert.equal(alternatives.children[0].bytes.toString('utf8'), draft.body); assert.equal(alternatives.children[1].bytes.toString('utf8'), '<div><b>Hello ✨</b><br />Second line</div>'); assert.deepEqual(parsed.children[1].bytes, bytes); assert.ok(parsed.children[1].headers.get('content-disposition')?.includes("filename*=UTF-8''r%C3%A9sum%C3%A9.bin"));
  const noFiles = readMime(buildMime(draft, account, undefined)); assert.equal(noFiles.type, 'multipart/alternative'); assert.equal(noFiles.children.length, 2); store.close();
});

test('legacy plain drafts retain plain MIME and forward keeps only sanitized original rich context', () => {
  const store = new Store(':memory:'); const account = store.required<Account>('account', 'demo'); const plain = store.saveDraft({ body: '<literal> & unicode ✨' });
  const parsed = readMime(buildMime(plain, account, undefined)); assert.equal(parsed.type, 'text/plain'); assert.equal(parsed.bytes.toString(), plain.body);
  const thread = store.required<Thread>('thread', 'demo-thread-1'); thread.messages[0].html = '<p><strong>Rich original</strong></p><img src="https://remote.invalid/pixel"><script>bad()</script>'; store.put('thread', thread.id, thread);
  const forward = store.replyDraft(thread.id, 'forward'); assert.ok(forward.html?.includes('<blockquote><p><strong>Rich original</strong></p></blockquote>')); assert.ok(!forward.html?.includes('remote.invalid')); assert.ok(!forward.html?.includes('bad()')); assert.ok(forward.body.includes('Forwarded message')); assert.equal(store.replyDraft(thread.id, 'reply').body, ''); store.close();
});

test('forwarding an HTML-only original keeps its visible content in both MIME alternatives', () => {
  const store = new Store(':memory:');
  try {
    const account = store.required<Account>('account', 'demo'); const thread = store.required<Thread>('thread', 'demo-thread-1');
    thread.messages[0].text = ''; thread.messages[0].html = '<p>HTML-only message &amp; content ✨</p><script>NOT_VISIBLE</script>';
    store.put('thread', thread.id, thread); const forward = store.replyDraft(thread.id, 'forward');
    const parsed = readMime(buildMime(forward, account, undefined));
    assert.equal(parsed.type, 'multipart/alternative');
    assert.ok(parsed.children[0].bytes.toString('utf8').includes('HTML-only message & content ✨'));
    assert.ok(parsed.children[1].bytes.toString('utf8').includes('<p>HTML-only message &amp; content ✨</p>'));
    assert.ok(!forward.body.includes('NOT_VISIBLE')); assert.ok(!forward.html?.includes('NOT_VISIBLE'));
    thread.messages[0].html = 'x'.repeat(500_001); store.put('thread', thread.id, thread);
    assert.equal(store.replyDraft(thread.id, 'reply').body, '');
  } finally { store.close(); }
});

test('API accepts rich drafts, returns sanitized markup and rejects non-string HTML', async () => {
  const app = createApp({ databasePath: ':memory:', env: {DATABASE_PATH: ':memory:'}, runJobs: false }); await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve)); const address = app.server.address(); assert.ok(address && typeof address === 'object'); const base = `http://127.0.0.1:${address.port}`;
  try {
    const created = await fetch(`${base}/api/drafts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ html: '<div><u>Saved</u><script>bad()</script></div>' }) }); assert.equal(created.status, 201); const { draft } = await created.json(); assert.equal(draft.html, '<div><u>Saved</u></div>'); assert.equal(draft.body, 'Saved');
    const patched = await fetch(`${base}/api/drafts/${draft.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'Plain replacement' }) }); assert.equal((await patched.json()).draft.html, undefined);
    const invalid = await fetch(`${base}/api/drafts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ html: { unsafe: 'not markup' } }) }); assert.equal(invalid.status, 400);
  } finally { await app.close(); }
});
