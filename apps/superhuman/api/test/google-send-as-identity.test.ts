import test from 'node:test';
import assert from 'node:assert/strict';
import { GOOGLE_IDENTITY_LIMITS, projectGoogleSendAsIdentity, type GoogleIdentityProjection } from '../src/google-send-as-identity.ts';

const now = Date.parse('2026-10-29T12:00:00.000Z');
const account = { id: 'google:primary@example.test', provider: 'google', email: 'primary@example.test' };
const primary = { sendAsEmail: 'primary@example.test', isPrimary: true };
const observe = (sendAs: unknown, extra: Record<string, unknown> = {}) => ({ state: 'complete', accountId: account.id, fetchedAt: new Date(now).toISOString(), response: { sendAs }, ...extra });
const project = (input: unknown, selected: unknown = account, timing: unknown = { now, maxAgeMs: 300_000 }) => projectGoogleSendAsIdentity(selected, input, timing);
const available = (value: GoogleIdentityProjection) => { assert.equal(value.availability, 'available'); if (value.availability !== 'available') throw Error('expected available'); return value.identity; };
const refused = (value: GoogleIdentityProjection, reason?: string) => { assert.equal(value.availability, 'unavailable'); assert.equal(value.identity, null); if (reason && value.availability === 'unavailable') assert.equal(value.reason, reason); };

test('complete primary and accepted/pending/unknown custom aliases retain distinct authority', () => {
  const identity = available(project(observe([primary, { sendAsEmail: 'accepted@example.test', verificationStatus: 'accepted' }, { sendAsEmail: 'pending@example.test', isPrimary: false, verificationStatus: 'pending' }, { sendAsEmail: 'unknown@example.test' }, { sendAsEmail: 'unspecified@example.test', verificationStatus: 'verificationStatusUnspecified' }])));
  assert.deepEqual(identity.selfAddresses, ['accepted@example.test', 'pending@example.test', 'primary@example.test', 'unknown@example.test', 'unspecified@example.test']);
  assert.deepEqual(identity.eligibleFrom, ['accepted@example.test', 'primary@example.test']);
  assert.deepEqual(identity.entries.map(entry => [entry.email, entry.verificationStatus]), [['accepted@example.test', 'accepted'], ['pending@example.test', 'pending'], ['primary@example.test', 'unknown'], ['unknown@example.test', 'unknown'], ['unspecified@example.test', 'unknown']]);
});

test('primary needs no verification enum; omitted false equals false, unspecified custom equals omitted', () => {
  const a = available(project(observe([primary, { sendAsEmail: 'custom@example.test' }])));
  const b = available(project(observe([{ ...primary, verificationStatus: 'verificationStatusUnspecified' }, { sendAsEmail: 'custom@example.test', isPrimary: false, verificationStatus: 'verificationStatusUnspecified' }])));
  assert.deepEqual(a, b);
  assert.deepEqual(a.eligibleFrom, [account.email]);
});

test('primary authority is its exact account match, while an explicit primary enum is retained without inventing alias verification', () => {
  for (const verificationStatus of ['accepted', 'pending']) {
    const identity = available(project(observe([{ ...primary, verificationStatus }])));
    assert.deepEqual(identity.eligibleFrom, [account.email]);
    assert.equal(identity.entries[0].verificationStatus, verificationStatus);
  }
});

test('order, ASCII case and fetch/token timestamps do not change identity version; alias verification does', () => {
  const a = available(project(observe([primary, { sendAsEmail: 'alias@example.test', verificationStatus: 'pending' }])));
  const changedFetch = { ...account, email: 'PRIMARY@EXAMPLE.TEST', lastSyncedAt: 'irrelevant', tokenRefreshedAt: 'irrelevant' };
  const b = available(project(observe([{ sendAsEmail: 'ALIAS@EXAMPLE.TEST', isPrimary: false, verificationStatus: 'pending' }, { sendAsEmail: 'PRIMARY@EXAMPLE.TEST', isPrimary: true }], { fetchedAt: new Date(now - 1).toISOString() }), changedFetch));
  assert.equal(a.identityVersion, b.identityVersion);
  const c = available(project(observe([primary, { sendAsEmail: 'alias@example.test', verificationStatus: 'accepted' }])));
  assert.notEqual(a.identityVersion, c.identityVersion);
});

test('literal plus/dot aliases remain separate without guessed Gmail normalization', () => {
  const identity = available(project(observe([primary, { sendAsEmail: 'p.rimary@example.test', verificationStatus: 'accepted' }, { sendAsEmail: 'primary+tag@example.test', verificationStatus: 'pending' }])));
  assert.equal(new Set(identity.selfAddresses).size, 3);
  assert(identity.selfAddresses.includes('primary+tag@example.test'));
  assert(!identity.eligibleFrom.includes('primary+tag@example.test'));
});

test('one exact selected-account primary required; duplicates and ambiguous primary refuse', () => {
  for (const entries of [[], [{ sendAsEmail: account.email }], [{ sendAsEmail: 'foreign@example.test', isPrimary: true }], [primary, { sendAsEmail: 'other@example.test', isPrimary: true }], [primary, { sendAsEmail: 'PRIMARY@EXAMPLE.TEST' }]]) refused(project(observe(entries)), 'invalid-response');
  available(project(observe([primary])));
});

test('malformed masked fields, partial/list envelopes, unsafe addresses and enum values never mean no aliases', () => {
  for (const entries of [null, {}, [null], [{ ...primary, isPrimary: 1 }], [{ ...primary, verificationStatus: null }], [{ ...primary, verificationStatus: 'future-unknown' }], [{ ...primary, displayName: 'not requested' }], [{ ...primary, sendAsEmail: 'Name <primary@example.test>' }], [{ ...primary, sendAsEmail: 'primary@example.test\r\nBcc: x@example.test' }], [{ ...primary, sendAsEmail: ' primary@example.test' }], [{ ...primary, sendAsEmail: 'primary@localhost' }]]) refused(project(observe(entries)), 'invalid-response');
  refused(project({ ...observe([primary]), response: { sendAs: [primary], nextPageToken: 'not complete' } }), 'invalid-response');
  refused(project({ ...observe([primary]), response: {} }), 'invalid-response');
  refused(project({ ...observe([primary]), extra: true }), 'invalid-observation');
});

test('foreign response is scoped out before payload access; account scope binds the version', () => {
  const foreign = { state: 'complete', accountId: 'google:other@example.test', fetchedAt: new Date(now).toISOString(), get response(): never { throw Error('foreign payload read'); } };
  refused(project(foreign), 'scope-mismatch');
  for (const selected of [null, { ...account, provider: 'demo' }, { ...account, id: '' }, { ...account, email: 'bad' }]) refused(project(observe([primary]), selected), 'invalid-account');
  const other = { ...account, id: 'google:another-incarnation' };
  const a = available(project(observe([primary])));
  const b = available(project(observe([primary], { accountId: other.id }), other));
  assert.notEqual(a.identityVersion, b.identityVersion);
});

test('unavailable/stale/future/invalid freshness never exposes empty positive snapshot', () => {
  refused(project({ state: 'unavailable', accountId: account.id }), 'unavailable');
  refused(project(observe([primary], { fetchedAt: new Date(now - 300_001).toISOString() })), 'stale');
  refused(project(observe([primary], { fetchedAt: new Date(now + 1).toISOString() })), 'stale');
  refused(project(observe([primary], { fetchedAt: '2026-10-29T12:00:00Z' })), 'invalid-observation');
  for (const timing of [null, { now: Infinity, maxAgeMs: 1 }, { now, maxAgeMs: -1 }, { now, maxAgeMs: GOOGLE_IDENTITY_LIMITS.maximumAgeMs + 1 }, { now, maxAgeMs: null }]) refused(project(observe([primary]), account, timing), 'invalid-observation');
  available(project(observe([primary], { fetchedAt: new Date(now - 300_000).toISOString() })));
});

test('bounded complete array and immutable copy; reordered input cannot change stored projection', () => {
  const rows = [primary, ...Array.from({ length: GOOGLE_IDENTITY_LIMITS.aliases - 1 }, (_, index) => ({ sendAsEmail: `alias${index}@example.test`, verificationStatus: 'accepted' }))];
  const result = available(project(observe(rows))), before = JSON.stringify(result);
  rows[1].sendAsEmail = 'changed@example.test';
  assert.equal(JSON.stringify(result), before);
  rows.push({ sendAsEmail: 'too-many@example.test', verificationStatus: 'accepted' });
  refused(project(observe(rows)), 'invalid-response');
});
