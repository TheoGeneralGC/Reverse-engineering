import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReadOnlyFlags, validateControlledSnapshot, createReadOnlyGmailFetcher } from './live-gmail-reconcile.mjs';
import { richFixture } from './live-gmail.mjs';
import type { Account, Draft, DeliveryAttempt } from '../src/types.ts';

const runId = 'offline-marker-readonly-01'; const fixture = richFixture(runId); const participants = ['a@example.test', 'b@example.test']; const account: Account = { id: 'google:probe', provider: 'google', email: participants[0], name: 'Probe', color: '#888' };
const draft: Draft = { id: 'draft-probe', accountId: account.id, to: participants[1], cc: '', bcc: '', subject: fixture.subject, body: fixture.body, html: fixture.html, status: 'sent', updatedAt: '2026-10-28T00:00:00Z', deliveryAttemptId: 'attempt-probe', deliveryMessageId: '<rea-00000000-0000-0000-0000-000000000000@reconstruction.invalid>', deliveryMarker: 'k'.repeat(32), providerMessageId: 'acknowledged', attachments: [{ id: 'attachment', name: fixture.attachment.name, mimeType: fixture.attachment.mimeType, size: fixture.attachment.bytes.length }] };
const attempt: DeliveryAttempt = { id: draft.deliveryAttemptId!, draftId: draft.id, status: 'sent', messageId: draft.deliveryMessageId!, marker: draft.deliveryMarker, providerMessageId: draft.providerMessageId, startedAt: '2026-10-28T00:00:00Z' };
const state = { runId, fixture: JSON.parse(JSON.stringify(fixture)), participants, messages: [{ draftId: draft.id, accountId: account.id, sender: participants[0], recipient: participants[1], subject: fixture.subject, fixtureHash: fixture.fixtureHash, status: 'sent', providerMessageId: 'acknowledged', sendStartedAt: '2026-10-28T00:00:00Z', sentAt: '2026-10-28T00:00:01Z' }] };
const auth = { authorization: 'Bearer synthetic-cached-access' };
const profile = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';
const search = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=after%3A123&labelIds=SENT&includeSpamTrash=true&maxResults=25';
const detail = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/candidate?format=metadata&metadataHeaders=X-Reconstruction-Delivery-ID&metadataHeaders=Message-ID&metadataHeaders=From';

test('read-only probe requires a named existing run and no send/refresh mode exists', () => {
  assert.deepEqual(parseReadOnlyFlags(['--run-id', runId]), { runId, verify: false }); assert.equal(parseReadOnlyFlags(['--verify', '--run-id', runId]).verify, true); assert.throws(() => parseReadOnlyFlags([])); assert.throws(() => parseReadOnlyFlags(['--send', '--run-id', runId])); assert.throws(() => parseReadOnlyFlags(['--verify', '--plan-only', '--run-id', runId]));
});

test('only the exact confirmed approved synthetic fixture is eligible; legacy/missing marker refuses', () => {
  validateControlledSnapshot(state, draft, attempt, account, participants, runId);
  for (const changed of [{ status: 'delivery_unknown' }, { deliveryMarker: undefined }, { providerMessageId: undefined }, { body: 'Existing user mail' }, { to: 'outsider@example.test' }, { cc: 'outsider@example.test' }, { providerDraftId: 'existing-provider' }]) assert.throws(() => validateControlledSnapshot(state, { ...draft, ...changed } as Draft, attempt, account, participants, runId));
  assert.throws(() => validateControlledSnapshot(state, draft, { ...attempt, marker: 'different' }, account, participants, runId)); assert.throws(() => validateControlledSnapshot(state, draft, attempt, { ...account, email: 'outsider@example.test' }, participants, runId)); assert.throws(() => validateControlledSnapshot({ ...state, messages: [{ ...state.messages[0], status: 'send-unconfirmed' }] }, draft, attempt, account, participants, runId));
});

test('guard forwards only exact account profile/listed candidate metadata GETs and blocks OAuth/writes/body/raw', async () => {
  let calls = 0; const fake = (async url => { calls++; return new Response(JSON.stringify(String(url).includes('messages?') ? { messages: [{ id: 'candidate' }] } : {}), { status: 200 }); }) as typeof fetch; const guard = createReadOnlyGmailFetcher('synthetic-cached-access', 123, fake);
  await guard.fetcher(profile, { headers: auth }); await guard.fetcher(search, { headers: auth }); await guard.fetcher(detail, { headers: auth }); assert.equal(calls, 3); assert.deepEqual(guard.counters, { getAttempts: 3, blockedAttempts: 0, profile: 1, lists: 1, metadata: 1 });
  for (const [url, options] of [['https://oauth2.googleapis.com/token', { method: 'POST', headers: auth }], ['https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: auth }], [detail.replace('metadata&', 'raw&'), { headers: auth }], [detail.replace('/candidate?', '/unlisted?'), { headers: auth }], [profile.replace('/users/me/', '/users/other/'), { headers: auth }], [profile.replace('gmail.googleapis.com', 'outside.example.test'), { headers: auth }], [profile, { headers: { authorization: 'Bearer wrong' } }], [search+'&q=anything', { headers: auth }]] as [string, RequestInit][]) await assert.rejects(() => guard.fetcher(url, options), /outside exact Gmail metadata scope/);
  assert.equal(calls, 3); assert.equal(guard.counters.blockedAttempts, 8);
});

test('guard enforces page/candidate bounds and a hard total GET attempt ceiling independently of provider code', async () => {
  const fake = (async () => new Response(JSON.stringify({ messages: [] }), { status: 200 })) as typeof fetch; const pages = createReadOnlyGmailFetcher('synthetic-cached-access', 123, fake); await pages.fetcher(search, { headers: auth }); await pages.fetcher(search+'&pageToken=second', { headers: auth }); await assert.rejects(() => pages.fetcher(search+'&pageToken=third', { headers: auth }));
  const ceiling = createReadOnlyGmailFetcher('synthetic-cached-access', 123, fake); for (let index = 0; index < 60; index++) await ceiling.fetcher(profile, { headers: auth }); await assert.rejects(() => ceiling.fetcher(profile, { headers: auth })); assert.equal(ceiling.counters.getAttempts, 60);
  const oversized = createReadOnlyGmailFetcher('synthetic-cached-access', 123, (async () => new Response(JSON.stringify({ messages: Array.from({ length: 26 }, (_, index) => ({ id: String(index) })) }))) as typeof fetch); await assert.rejects(() => oversized.fetcher(search, { headers: auth }));
});
