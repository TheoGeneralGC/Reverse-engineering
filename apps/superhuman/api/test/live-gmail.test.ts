import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHarnessFlags, validateHarnessRequest, richFixture, validateRichFixturePlan, validateRichDraft, validateRichDraftBase, richMessageChecks, validateSendBoundary } from './live-gmail.mjs';
import { sanitizeDraftHtml } from '../src/rich-text.ts';

const runId = 'offline-rich-fixture-01'; const fixture = richFixture(runId);
const entry = { accountId: 'google:sender@example.test', sender: 'sender@example.test', recipient: 'recipient@example.test', subject: fixture.subject, draftId: 'own-test-draft', attachmentId: 'own-test-attachment', fixtureHash: fixture.fixtureHash, deliveryMessageId: '<rea-synthetic@reconstruction.invalid>' };
const draft = { id: entry.draftId, accountId: entry.accountId, to: entry.recipient, cc: '', bcc: '', subject: fixture.subject, body: fixture.body, html: fixture.html, status: 'draft', attachments: [{ id: entry.attachmentId, name: fixture.attachment.name, mimeType: fixture.attachment.mimeType, size: fixture.attachment.bytes.length }] };
const message = { id: 'received-message', sender: { email: entry.sender }, to: [{ email: entry.recipient }], cc: [], internetMessageId: entry.deliveryMessageId, text: fixture.body, html: fixture.html, attachments: draft.attachments };

test('plan-only rich mode cannot request mutation/sync and requires a reviewed named run before sending', () => {
  const plan = parseHarnessFlags(['--rich', '--plan-only', '--run-id', runId]); assert.equal(plan.send, false); assert.equal(plan.verify, false); assert.equal(plan.rich, true); validateHarnessRequest(plan, '/accounts', 'GET'); validateHarnessRequest(plan, '/provider/status', 'GET');
  for (const path of ['/drafts', '/drafts/id/send', '/drafts/id/attachments', '/accounts/id/sync']) assert.throws(() => validateHarnessRequest(plan, path, 'POST'), /Plan-only/);
  assert.throws(() => parseHarnessFlags(['--rich', '--send']), /existing reviewed plan/); assert.throws(() => parseHarnessFlags(['--rich', '--plan-only', '--send', '--run-id', runId]), /cannot be combined/);
  const verify = parseHarnessFlags(['--rich', '--verify', '--run-id', runId]); validateHarnessRequest(verify, '/accounts/id/sync', 'POST'); assert.throws(() => validateHarnessRequest(verify, '/drafts/id/send', 'POST'));
});

test('rich fixture is deterministic, sanitizer-stable, contains distinct MIME alternatives and exact tiny UTF-8 bytes', () => {
  assert.equal(richFixture(runId).fixtureHash, fixture.fixtureHash); assert.notEqual(richFixture(`${runId}-other`).fixtureHash, fixture.fixtureHash); assert.equal(sanitizeDraftHtml(fixture.html), fixture.html); assert.ok(fixture.body.includes(`REA-PLAIN-${runId}`)); assert.ok(fixture.html.includes(`REA-HTML-${runId}`)); assert.equal(fixture.body.includes(`REA-HTML-${runId}`), false); assert.equal(fixture.html.includes(`REA-PLAIN-${runId}`), false); assert.ok(fixture.attachment.bytes.length < 1024); assert.ok(fixture.attachment.bytes.toString('utf8').includes('café — 東京 😀')); assert.equal(fixture.hashes.attachment.length, 64);
});

test('persisted rich plan binds reviewed content and binary bytes instead of trusting an editable hash field', () => {
  const saved = JSON.parse(JSON.stringify(fixture)); validateRichFixturePlan(saved, runId);
  for (const change of [{ body: 'Edited plan body' }, { html: '<p>Edited</p>' }, { subject: 'Edited subject' }, { attachment: { ...saved.attachment, bytes: { type: 'Buffer', data: [0] } } }]) assert.throws(() => validateRichFixturePlan({ ...saved, ...change }, runId), /plan changed/);
});

test('draft validation protects real/changed drafts before attachment upload and requires exact one-fixture content', () => {
  validateRichDraftBase({ ...draft, attachments: [] }, entry, runId); validateRichDraft(draft, entry, runId);
  for (const changed of [{ accountId: 'other' }, { to: 'outsider@example.test' }, { cc: 'outsider@example.test' }, { subject: 'Existing user draft' }, { body: 'User-authored content' }, { html: '<p>Changed</p>' }, { status: 'sending' }, { providerDraftId: 'existing-provider-draft' }, { threadId: 'existing-thread' }]) assert.throws(() => validateRichDraftBase({ ...draft, ...changed }, entry, runId), /preserved/);
  assert.throws(() => validateRichDraft({ ...draft, attachments: [] }, entry, runId)); assert.throws(() => validateRichDraft({ ...draft, attachments: [...draft.attachments, ...draft.attachments] }, entry, runId)); assert.throws(() => validateRichDraft(draft, { ...entry, fixtureHash: 'changed' }, runId));
});

test('receipt proof requires exact decoded plain/html, Message-ID, approved route and downloaded attachment bytes', () => {
  const accepted = richMessageChecks(message, entry, runId, fixture.attachment.bytes); assert.equal(accepted.passed, true); assert.ok(Object.values(accepted.checks).every(Boolean)); assert.deepEqual(accepted.actualHashes, fixture.hashes);
  for (const changed of [{ sender: { email: 'outsider@example.test' } }, { to: [{ email: entry.recipient }, { email: 'outsider@example.test' }] }, { cc: [{ email: 'outsider@example.test' }] }, { internetMessageId: 'wrong' }, { text: `${fixture.body}changed` }, { html: '<p>Lost alternative</p>' }, { attachments: [] }]) assert.equal(richMessageChecks({ ...message, ...changed }, entry, runId, fixture.attachment.bytes).passed, false);
  assert.equal(richMessageChecks(message, { ...entry, deliveryMessageId: undefined }, runId, fixture.attachment.bytes).passed, false); assert.equal(richMessageChecks(message, entry, runId, Buffer.from('different bytes')).passed, false); assert.equal(richMessageChecks(message, entry, runId).passed, false);
});

test('rich mode preserves the exact two-participant sender/recipient boundary', () => {
  const participants = ['recipient@example.test', 'sender@example.test']; const status = { google: { configured: true, deliveryEnabled: true, approvedTestRecipients: participants, approvedTestSenders: participants } }; validateSendBoundary(status, participants, entry.sender);
  assert.throws(() => validateSendBoundary({ google: { ...status.google, approvedTestRecipients: [...participants, 'outsider@example.test'] } }, participants)); assert.throws(() => validateSendBoundary(status, participants, 'outsider@example.test')); assert.throws(() => validateSendBoundary({ google: { ...status.google, deliveryEnabled: false } }, participants));
});
