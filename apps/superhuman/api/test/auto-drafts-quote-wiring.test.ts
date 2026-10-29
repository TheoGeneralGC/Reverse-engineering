import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { autoDraftAppFixture, AUTO_DRAFT_APP_TIME } from './auto-drafts-v2-app-fixture.ts';
import type { Draft, Thread } from '../src/types.ts';
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => resolve = r); return { promise, resolve }; };
async function until(fn: () => boolean) { for (let n = 0; n < 1000 && !fn(); n++) await new Promise(r => setImmediate(r)); assert.equal(fn(), true); }
const on = () => ({ accountId: 'a', section: 'preferences', clientRequestId: randomUUID(), expectedRevision: 0, change: { field: 'responsesEnabled', value: true } });
test('actual factory worker freezes source and effective trusted zone before model, then publishes quoted plain/HTML reply locally', async () => {
  const f = autoDraftAppFixture(':memory:', AUTO_DRAFT_APP_TIME, 'US/Pacific'), gate = deferred();
  try {
    await f.initialize(); assert.equal((await f.request('PATCH', '/api/auto-drafts/v2/preferences', on())).status, 200); f.holdModel(gate.promise); const sourceId = f.incoming(); await f.app.requestSync('a'); await until(() => f.calls().modelCalls === 1);
    const before = f.app.store.required<Thread>('thread', 'a:t1'), saved = JSON.stringify(before), input = JSON.parse(String(f.app.store.db.prepare('SELECT data FROM auto_draft_worker_inputs').get()!.data));
    assert.equal(input.replyPresentation?.timeZone, 'America/Los_Angeles'); assert.equal(input.replyPresentation.source.id, sourceId); assert.equal(input.replyPresentation.source.text, 'Fictional question'); assert.equal(input.input.context.messages.at(-1).text, 'Fictional question'); assert.equal(input.input.context.subject, undefined);
    // The local detached reader value is not an authority to alter the frozen
    // source used after the model await.
    before.messages[0].text = 'Mutated detached reader'; gate.resolve(); await f.app.waitAutoDraftIdle();
    const draft = f.app.store.list<Draft>('draft')[0]; assert.ok(draft); assert.match(draft.body, /^Fictional response\.\n\nOn Thu, Oct 29, 2026 at 3:\d{2} PM, Sender <sender@example\.test> wrote:\n> Fictional question$/); assert.match(draft.html || '', /<blockquote>/); assert.match(draft.html || '', /Sender &lt;sender@example\.test&gt; wrote:/); assert.equal(draft.subject, 'Re: Fictional question'); assert.equal(JSON.stringify(f.app.store.required<Thread>('thread', 'a:t1')), saved); assert.equal(f.calls().modelCalls, 1); assert.equal(f.app.store.db.prepare('SELECT COUNT(*) AS n FROM provider_draft_links').get()!.n, 0); assert.equal(f.paths.some(p => p.startsWith('drafts') || p.includes('messages/send')), false);
  } finally { gate.resolve(); await f.close(); }
});
test('HTML-only actual Gmail source supplies sanitized literal model context and a quoted source without changing stored Mail', async () => {
  const f = autoDraftAppFixture(':memory:'); const original = f.app.google.fetcher, model = f.app.autoDraftGeneration!.facade.runtime.worker.model, issue = model.fetcher; let context: any;
  const html = '<p>Thursday &amp; Friday: &lt;Room Maple&gt;</p><script>not model context</script><img src="https://outside.example.test/pixel">';
  f.app.google.fetcher = async (...args) => { const response = await original(...args); if (String(args[0]).includes('/threads/t1?format=full')) { const raw = await response.json(); raw.messages[0].payload = { ...raw.messages[0].payload, mimeType: 'text/html', body: { data: Buffer.from(html).toString('base64url') } }; return new Response(JSON.stringify(raw)); } return response; };
  (model as unknown as { fetcher: typeof fetch }).fetcher = async (...args) => { context = JSON.parse(JSON.parse(String(args[1]?.body)).messages[0].content); return issue(...args); };
  try {
    await f.initialize(); await f.request('PATCH', '/api/auto-drafts/v2/preferences', on()); f.incoming(); await f.app.requestSync('a'); await f.app.runAutoDraftJobs('a'); await f.app.waitAutoDraftIdle();
    assert.match(context.messages.at(-1).text, /Thursday & Friday: <Room Maple>/); assert.doesNotMatch(context.messages.at(-1).text, /script|not model context|https:|pixel|&amp;|&lt;/); assert.equal(context.subject, undefined);
    const source = f.app.store.required<Thread>('thread', 'a:t1').messages[0]; assert.equal(source.text, ''); assert.equal(source.html, html); const draft = f.app.store.list<Draft>('draft')[0]; assert.match(draft.body, /^Fictional response\.\n\nOn .*Sender <sender@example\.test> wrote:\n> Thursday & Friday: <Room Maple>/); assert.match(draft.html || '', /<blockquote>/); assert.doesNotMatch(draft.html || '', /<script|<img|https:\/\/outside/); assert.match(draft.html || '', /&lt;Room Maple&gt;/); assert.equal(f.calls().modelCalls, 1); assert.equal(f.app.store.db.prepare('SELECT COUNT(*) AS n FROM provider_draft_links').get()!.n, 0);
  } finally { await f.close(); }
});
