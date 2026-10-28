import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { GoogleProvider } from '../src/google.ts';
import { GoogleCalendarProvider, CalendarRequestError } from '../src/calendar.ts';
import { CALENDAR_REQUEST_SCOPES, CALENDAR_SCOPES, calendarCapabilities, type GoogleServiceGrant } from '../src/google-scopes.ts';
import { createApp } from '../src/server.ts';
import type { Account } from '../src/types.ts';
import type { CalendarMetadata, CalendarOperation } from '../src/calendar-types.ts';

const accountId = 'google:owner@example.test'; const calendarId = 'owner@example.test';
const env = { GOOGLE_CLIENT_ID: 'fake-client', GOOGLE_CLIENT_SECRET: 'fake-secret', TOKEN_ENCRYPTION_KEY: 'c'.repeat(64), GOOGLE_CALENDAR_ENABLED: 'true', APPROVED_CALENDAR_TEST_ACCOUNTS: 'owner@example.test', APPROVED_CALENDAR_TEST_IDS: calendarId, APPROVED_CALENDAR_TEST_ATTENDEES: 'guest@example.test' };
const range = { timeMin: '2026-10-27T00:00:00Z', timeMax: '2026-11-03T00:00:00Z', timeZone: 'America/Los_Angeles' };
const input = { summary: 'Synthetic event', start: { dateTime: '2026-10-28T10:00:00-07:00', timeZone: 'America/Los_Angeles' }, end: { dateTime: '2026-10-28T11:00:00-07:00', timeZone: 'America/Los_Angeles' } };
const response = (data: unknown, status = 200, headers?: Record<string, string>) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
function rawEvent(id = 'event-one', extra: Record<string, unknown> = {}) { return { id, etag: '"v1"', status: 'confirmed', ...input, organizer: { email: 'owner@example.test', self: true }, ...extra }; }
function setup(path = ':memory:', fetcher: typeof fetch = (async () => { throw new Error('Unexpected mocked request'); }) as typeof fetch) {
  const store = new Store(path); const google = new GoogleProvider(store, env, fetcher);
  if (!store.get('account', accountId)) store.put<Account>('account', accountId, { id: accountId, name: 'Owner', email: 'owner@example.test', color: '#888', provider: 'google' });
  const grant: GoogleServiceGrant = { accountId, service: 'calendar', requestedScopes: CALENDAR_REQUEST_SCOPES, grantedScopes: CALENDAR_REQUEST_SCOPES, scopeSource: 'response', outcome: 'granted', updatedAt: new Date().toISOString() }; store.put('googleGrant', `calendar:${accountId}`, grant);
  google.saveTokens(accountId, { access_token: 'fake-calendar-token', refresh_token: 'fake-refresh', expires_at: Date.now() + 3600_000 }, 'calendar');
  let now = Date.parse('2026-10-27T12:00:00Z'); const delays: number[] = [];
  const provider = new GoogleCalendarProvider(store, google, env, fetcher, { now: () => now, sleep: async milliseconds => { delays.push(milliseconds); now += milliseconds; }, random: () => 0 });
  if (!provider.repository.calendar(accountId, calendarId)) provider.repository.saveCalendar({ accountId, id: calendarId, summary: 'Owned', accessRole: 'owner', timeZone: 'America/Los_Angeles', updatedAt: new Date(now).toISOString() });
  return { store, google, provider, delays, advance: (milliseconds: number) => { now += milliseconds; }, now: () => now };
}

test('Calendar OAuth requests incremental service scopes, binds identity, and leaves Gmail tokens/selection intact on partial grant', async () => {
  let calls = 0; let verifier = ''; const store = new Store(':memory:'); store.put<Account>('account', accountId, { id: accountId, name: 'Owner', email: calendarId, provider: 'google', color: '#888' });
  const google = new GoogleProvider(store, env, (async (url, options) => { calls++; if (String(url).includes('/token')) { const body = new URLSearchParams(String(options?.body)); assert.equal(body.get('code_verifier'), verifier); return response({ access_token: 'calendar-access', refresh_token: 'calendar-refresh', expires_in: 3600, token_type: 'Bearer', scope: `openid email ${CALENDAR_SCOPES.list}` }); } assert.equal(String(url), 'https://openidconnect.googleapis.com/v1/userinfo'); return response({ email: calendarId, email_verified: true, sub: 'synthetic-subject' }); }) as typeof fetch);
  google.saveTokens(accountId, { access_token: 'mail-access', refresh_token: 'mail-refresh', expires_at: Date.now() + 3600_000 }); const originalMail = store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(accountId)!.value; const active = store.preferences().activeAccountId;
  try {
    const auth = google.startAuth({ service: 'calendar', accountId }); const url = new URL(auth.url); verifier = String(store.db.prepare('SELECT verifier FROM oauth_states WHERE state=?').get(auth.state)!.verifier);
    assert.deepEqual(new Set(url.searchParams.get('scope')!.split(' ')), new Set(CALENDAR_REQUEST_SCOPES)); assert.equal(url.searchParams.get('include_granted_scopes'), 'true'); assert.equal(url.searchParams.get('login_hint'), calendarId); assert.equal(url.searchParams.get('redirect_uri'), google.redirectUri);
    assert.equal(await google.finishAuth(auth.state, auth.state, 'fake-code'), accountId); assert.equal(calls, 2); assert.equal(store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(accountId)!.value, originalMail); assert.equal(store.preferences().activeAccountId, active);
    assert.equal(google.grant(accountId, 'calendar')!.outcome, 'partial'); assert.equal(calendarCapabilities(google.grant(accountId, 'calendar')!.grantedScopes).writeOwned, false); assert.equal((await google.tokens(accountId, 'calendar')).access_token, 'calendar-access');
    await assert.rejects(() => google.finishAuth(auth.state, auth.state, 'fake-code'), { code: 'invalid_oauth_state' });
  } finally { store.close(); }
});

test('denied/mismatched Calendar consent preserves existing Gmail and Calendar credentials without automatic authorization', async () => {
  const { store, google, provider } = setup(':memory:', (async url => String(url).includes('/token') ? response({ access_token: 'wrong-account', refresh_token: 'wrong-refresh', expires_in: 3600, scope: CALENDAR_REQUEST_SCOPES.join(' ') }) : response({ email: 'other@example.test', email_verified: true, sub: 'other-subject' })) as typeof fetch);
  google.saveTokens(accountId, { access_token: 'mail-access', refresh_token: 'mail-refresh', expires_at: Date.now() + 3600_000 }); const before = store.db.prepare('SELECT account_id,value FROM secrets ORDER BY account_id').all();
  try {
    const declined = google.startAuth({ service: 'calendar', accountId }); assert.equal(google.declineAuth(declined.state, declined.state), 'calendar'); assert.deepEqual(store.db.prepare('SELECT account_id,value FROM secrets ORDER BY account_id').all(), before); assert.equal(provider.status(accountId).authAttempt && (provider.status(accountId).authAttempt as { outcome: string }).outcome, 'declined');
    const mismatch = google.startAuth({ service: 'calendar', accountId }); await assert.rejects(() => google.finishAuth(mismatch.state, mismatch.state, 'fake-code'), { code: 'calendar_account_mismatch' }); assert.deepEqual(store.db.prepare('SELECT account_id,value FROM secrets ORDER BY account_id').all(), before);
  } finally { await provider.close(); store.close(); }
});

test('Calendar refresh uses its own token and publishes narrower actual capabilities without modifying Gmail', async () => {
  const { store, google, provider } = setup(':memory:', (async (_url, options) => { const body = new URLSearchParams(String(options?.body)); assert.equal(body.get('refresh_token'), 'calendar-expired-refresh'); return response({ access_token: 'calendar-new', refresh_token: 'calendar-rotated', expires_in: 3600, scope: CALENDAR_SCOPES.list }); }) as typeof fetch);
  google.saveTokens(accountId, { access_token: 'mail-stable', refresh_token: 'mail-stable-refresh', expires_at: Date.now() + 3600_000 }); google.saveTokens(accountId, { access_token: 'calendar-expired', refresh_token: 'calendar-expired-refresh', expires_at: 0 }, 'calendar'); const original = store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(accountId)!.value;
  try { const tokens = await google.tokens(accountId, 'calendar'); assert.equal(tokens.refresh_token, 'calendar-rotated'); assert.equal(provider.capabilities(accountId).writeOwned, false); assert.equal(provider.capabilities(accountId).list, true); assert.equal(store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(accountId)!.value, original); } finally { await provider.close(); store.close(); }
});

test('canonical event sync checkpoints pages durably, keeps original token until final page and persists cancellation tombstones', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'superhuman-calendar-sync-')); const path = join(directory, 'synthetic.sqlite'); let current = setup(path);
  try {
    current.provider.request = async (_account, path) => { const url = new URL(path, 'https://calendar.invalid/'); assert.equal(url.searchParams.get('singleEvents'), 'false'); assert.equal(url.searchParams.get('showDeleted'), 'true'); for (const key of ['timeMin', 'timeMax', 'orderBy', 'q']) assert.equal(url.searchParams.has(key), false); return { items: [rawEvent()], nextPageToken: 'page-two' }; };
    await current.provider.syncEvents(accountId, calendarId); assert.equal(current.provider.repository.state(accountId, calendarId, 'events').pageToken, 'page-two'); assert.equal(current.provider.repository.state(accountId, calendarId, 'events').syncToken, undefined); await current.provider.close(); current.store.close(); current = setup(path);
    current.provider.request = async (_account, path) => { assert.equal(new URL(path, 'https://calendar.invalid/').searchParams.get('pageToken'), 'page-two'); return { items: [rawEvent('second')], nextSyncToken: 'sync-one' }; }; await current.provider.syncEvents(accountId, calendarId); assert.equal(current.provider.repository.state(accountId, calendarId, 'events').syncToken, 'sync-one');
    current.provider.request = async (_account, path) => { const url = new URL(path, 'https://calendar.invalid/'); assert.equal(url.searchParams.get('syncToken'), 'sync-one'); return { items: [{ id: 'event-one', status: 'cancelled' }, { id: 'exception', status: 'cancelled', recurringEventId: 'series', originalStartTime: { date: '2026-10-28' } }], nextPageToken: 'incremental-two' }; }; await current.provider.syncEvents(accountId, calendarId);
    let state = current.provider.repository.state(accountId, calendarId, 'events'); assert.equal(state.syncToken, 'sync-one'); assert.equal(state.pageToken, 'incremental-two'); const tombstone = current.provider.repository.event(accountId, calendarId, 'event-one')!; assert.equal(tombstone.status, 'cancelled'); assert.equal(tombstone.summary, undefined); assert.equal(current.provider.repository.event(accountId, calendarId, 'exception')!.recurringEventId, 'series');
    current.provider.request = async () => { throw new CalendarRequestError(502, 'Synthetic read failure', 'calendar_transport_failed'); }; await assert.rejects(() => current.provider.syncEvents(accountId, calendarId)); state = current.provider.repository.state(accountId, calendarId, 'events'); assert.equal(state.pageToken, 'incremental-two'); assert.equal(state.syncToken, 'sync-one');
    current.provider.request = async (_account, path) => { const url = new URL(path, 'https://calendar.invalid/'); assert.equal(url.searchParams.get('syncToken'), 'sync-one'); assert.equal(url.searchParams.get('pageToken'), 'incremental-two'); return { items: [], nextSyncToken: 'sync-two' }; }; await current.provider.syncEvents(accountId, calendarId); state = current.provider.repository.state(accountId, calendarId, 'events'); assert.equal(state.syncToken, 'sync-two'); assert.equal(state.pageToken, undefined);
  } finally { await current.provider.close(); current.store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('expired sync wipes only its calendar collection and starts a full scan; a failed page is atomic', async () => {
  const { store, provider } = setup();
  provider.repository.saveEvent({ accountId, calendarId, id: 'old', status: 'confirmed', summary: 'old' }); provider.repository.saveEvent({ accountId, calendarId: 'other-calendar', id: 'other', status: 'confirmed' }); provider.repository.saveEvent({ accountId: 'other-account', calendarId, id: 'other-owner', status: 'confirmed' }); provider.repository.saveState(accountId, calendarId, 'events', { phase: 'incremental', partial: false, syncToken: 'expired' });
  try {
    provider.request = async () => { throw new CalendarRequestError(410, 'Expired', 'calendar_sync_expired'); }; assert.equal((await provider.syncEvents(accountId, calendarId)).partial, true); assert.equal(provider.repository.events(accountId, calendarId).length, 0); assert.equal(provider.repository.events(accountId, 'other-calendar').length, 1); assert.equal(provider.repository.events('other-account', calendarId).length, 1); assert.equal(provider.repository.state(accountId, calendarId, 'events').syncToken, undefined);
    provider.request = async (_account, path) => { assert.equal(new URL(path, 'https://calendar.invalid/').searchParams.has('syncToken'), false); return { items: [rawEvent('first'), rawEvent('second')], nextSyncToken: 'new' }; };
    const saveEvent = provider.repository.saveEvent.bind(provider.repository); provider.repository.saveEvent = event => { if (event.id === 'second') throw new Error('Synthetic DB failure'); return saveEvent(event); }; await assert.rejects(() => provider.syncEvents(accountId, calendarId), /Synthetic DB failure/); assert.equal(provider.repository.events(accountId, calendarId).length, 0); assert.equal(provider.repository.state(accountId, calendarId, 'events').syncToken, undefined);
    provider.repository.saveEvent = saveEvent; await provider.syncEvents(accountId, calendarId); assert.equal(provider.repository.events(accountId, calendarId).length, 2); assert.equal(provider.repository.state(accountId, calendarId, 'events').syncToken, 'new');
  } finally { await provider.close(); store.close(); }
});

test('calendar list roles, deletions and periodic full refresh prevent stale shared/removed access', async () => {
  const { store, provider, advance, now } = setup(); const publicId = 'holidays@example.test'; provider.repository.saveCalendar({ accountId, id: publicId, summary: 'Holidays', accessRole: 'reader', updatedAt: new Date(now()).toISOString() });
  try {
    provider.request = async (_account, path) => { assert.ok(path.startsWith('users/me/calendarList?')); return { items: [{ id: calendarId, summary: 'Owned', accessRole: 'owner', primary: true, timeZone: 'America/Los_Angeles' }, { id: publicId, summary: 'Holidays', accessRole: 'reader' }], nextSyncToken: 'list-one' }; }; await provider.syncCalendarList(accountId); assert.equal(provider.repository.calendars(accountId).length, 2);
    provider.repository.saveEvent({ accountId, calendarId, id: 'stale-private', status: 'confirmed', summary: 'old details' }); provider.repository.saveState(accountId, calendarId, 'events', { phase: 'incremental', partial: false, syncToken: 'events-old' });
    provider.request = async () => ({ items: [{ id: calendarId, accessRole: 'freeBusyReader' }, { id: publicId, deleted: true }], nextSyncToken: 'list-two' }); await provider.syncCalendarList(accountId); assert.equal(provider.repository.events(accountId, calendarId).length, 0); assert.equal(provider.repository.state(accountId, calendarId, 'events').syncToken, undefined); assert.equal(provider.repository.calendars(accountId).length, 1); await assert.rejects(() => provider.visibleRange(accountId, calendarId, range), { code: 'calendar_events_not_visible' });
    advance(6 * 60 * 60_000); provider.request = async (_account, path) => { assert.equal(new URL(path, 'https://calendar.invalid/').searchParams.has('syncToken'), false); return { items: [{ id: calendarId, accessRole: 'owner', timeZone: 'America/Los_Angeles' }], nextSyncToken: 'list-full' }; }; await provider.syncCalendarList(accountId); assert.equal(provider.repository.calendar(accountId, calendarId)!.accessRole, 'owner'); assert.equal(provider.repository.calendar(accountId, publicId)!.deleted, true);
  } finally { await provider.close(); store.close(); }
});

test('new read-capable role is preserved while versioned event-label updates stop before mutation', async () => {
  const { store, provider } = setup(); let writes = 0;
  try {
    provider.request = async () => ({ items: [{ id: calendarId, accessRole: 'owner', timeZone: 'America/Los_Angeles' }, { id: 'restricted-shared', accessRole: 'writerWithoutPrivateAccess', timeZone: 'UTC' }], nextSyncToken: 'roles' }); await provider.syncCalendarList(accountId); assert.equal(provider.repository.calendar(accountId, 'restricted-shared')!.accessRole, 'writerWithoutPrivateAccess');
    provider.request = async () => ({ items: [rawEvent()], nextSyncToken: 'shared-events' }); await provider.syncEvents(accountId, 'restricted-shared'); assert.equal(provider.repository.events(accountId, 'restricted-shared').length, 1); assert.throws(() => provider.prepareOperation({ accountId, calendarId: 'restricted-shared', kind: 'create', event: input }), { code: 'calendar_owned_write_required' });
    provider.request = async (_account, _path, options = {}) => { if (options.method) writes++; return rawEvent('versioned', { eventLabelId: 'provider-event-label' }); }; const operation = provider.prepareOperation({ accountId, calendarId, kind: 'update', eventId: 'versioned', etag: '"v1"', event: { summary: 'Do not lose label' } }); await assert.rejects(() => provider.executeOperation(operation.id), { code: 'calendar_event_labels_unsupported' }); assert.equal(writes, 0);
  } finally { await provider.close(); store.close(); }
});

test('visible range pages are separate from canonical tokens, bounded, cached and invalidated by sync', async () => {
  const { store, provider, advance } = setup(); let calls = 0; provider.repository.saveState(accountId, calendarId, 'events', { phase: 'incremental', partial: false, syncToken: 'canonical-token' });
  try {
    provider.request = async (_account, path) => { calls++; const query = new URL(path, 'https://calendar.invalid/').searchParams; assert.equal(query.get('singleEvents'), 'true'); assert.equal(query.get('orderBy'), 'startTime'); assert.equal(query.has('syncToken'), false); assert.ok(query.get('timeMin')); return calls === 1 ? { items: [rawEvent('instance-one', { recurringEventId: 'series' })], nextPageToken: 'range-next' } : { items: [rawEvent('instance-two', { recurringEventId: 'series' })] }; };
    const first = await provider.visibleRange(accountId, calendarId, range); assert.equal(first.cache.partial, true); assert.equal(first.events.length, 1); assert.equal('nextPageToken' in first, false);
    const second = await provider.visibleRange(accountId, calendarId, range); assert.equal(second.cache.partial, false); assert.equal(second.events.length, 2); await provider.visibleRange(accountId, calendarId, range); assert.equal(calls, 2); assert.equal(provider.repository.state(accountId, calendarId, 'events').syncToken, 'canonical-token');
    advance(61_000); await provider.visibleRange(accountId, calendarId, range); assert.equal(calls, 3);
    provider.request = async () => ({ items: [{ id: 'instance-one', status: 'cancelled' }], nextSyncToken: 'canonical-next' }); await provider.syncEvents(accountId, calendarId); assert.equal(provider.repository.range(accountId, calendarId, first.cache.key), undefined);
    await assert.rejects(() => provider.visibleRange(accountId, calendarId, { ...range, timeMax: '2027-10-27T00:00:00Z' }), { code: 'invalid_calendar_range' });
  } finally { await provider.close(); store.close(); }
});

test('singleton malformed provider dates fail before canonical checkpoint or range caching', async () => {
  const { store, provider } = setup();
  try {
    for (const times of [{ start: { dateTime: 'bad' }, end: input.end }, { start: { dateTime: '2026-10-28T10:00:00' }, end: input.end }, { start: { date: '2026-02-30' }, end: { date: '2026-03-02' } }]) {
      provider.repository.saveState(accountId, calendarId, 'events', { phase: 'incremental', partial: false, syncToken: 'unchanged' }); provider.request = async () => ({ items: [rawEvent('invalid', times)], nextSyncToken: 'must-not-commit' });
      await assert.rejects(() => provider.syncEvents(accountId, calendarId), { code: 'calendar_invalid_response' }); assert.equal(provider.repository.state(accountId, calendarId, 'events').syncToken, 'unchanged'); assert.equal(provider.repository.event(accountId, calendarId, 'invalid'), undefined);
      await assert.rejects(() => provider.visibleRange(accountId, calendarId, range), { code: 'calendar_invalid_response' }); assert.equal(provider.repository.db.prepare('SELECT COUNT(*) AS count FROM calendar_ranges').get()!.count, 0);
    }
  } finally { await provider.close(); store.close(); }
});

test('freebusy retains unknown calendars/group errors and distinguishes known empty availability', async () => {
  const { store, provider } = setup();
  try {
    provider.request = async () => ({ ...range, calendars: { free: { busy: [] }, failed: { errors: [{ reason: 'notFound' }], busy: [] }, busy: { busy: [{ start: '2026-10-28T12:00:00Z', end: '2026-10-28T13:00:00Z' }] } }, groups: { tooBig: { errors: [{ reason: 'groupTooBig' }] } } }); const result = await provider.freeBusy(accountId, { ...range, items: ['free', 'failed', 'busy', 'missing', 'tooBig'] }); assert.equal(result.complete, false); assert.equal(result.calendars.free.status, 'known'); assert.equal(result.calendars.failed.status, 'unknown'); assert.equal(result.calendars.missing.status, 'unknown'); assert.equal(result.groups.tooBig.errors[0], 'groupTooBig');
    provider.request = async () => ({ ...range, groups: { team: { calendars: ['member'] } }, calendars: { member: { busy: [] } } }); const group = await provider.freeBusy(accountId, { ...range, items: ['team'] }); assert.equal(group.complete, true); assert.deepEqual(group.groups.team.calendarIds, ['member']); assert.equal(group.calendars.team, undefined);
    assert.equal(calendarCapabilities([CALENDAR_SCOPES.read]).freebusy, false); assert.equal(calendarCapabilities([CALENDAR_SCOPES.freebusy]).freebusy, true);
  } finally { await provider.close(); store.close(); }
});

test('write guards default empty and forbid shared writes/unapproved attendees before any network dispatch', async () => {
  let calls = 0; const { store, google, provider } = setup(':memory:', (async () => { calls++; throw new Error('No network expected'); }) as typeof fetch); const disabled = new GoogleCalendarProvider(store, google, { ...env, APPROVED_CALENDAR_TEST_ACCOUNTS: '', APPROVED_CALENDAR_TEST_IDS: '' });
  try {
    assert.throws(() => disabled.prepareOperation({ accountId, calendarId, kind: 'create', event: input }), { code: 'calendar_test_write_disabled' }); assert.throws(() => provider.prepareOperation({ accountId, calendarId, kind: 'create', event: { ...input, attendees: [{ email: 'unapproved@example.test' }] } }), { code: 'calendar_attendee_not_approved' });
    provider.repository.saveCalendar({ accountId, id: 'shared', summary: 'Shared writer', accessRole: 'writer', updatedAt: new Date().toISOString() }); assert.throws(() => provider.prepareOperation({ accountId, calendarId: 'shared', kind: 'create', event: input }), { code: 'calendar_owned_write_required' }); assert.equal(calls, 0);
    assert.throws(() => provider.prepareOperation({ accountId, calendarId, kind: 'update', eventId: 'event', event: { summary: 'Changed' } }), { code: 'calendar_etag_required', status: 428 });
  } finally { await provider.close(); await disabled.close(); store.close(); }
});

test('create dispatch is durable and idempotent; uncertain writes require marker reconciliation without resending', async () => {
  const { store, provider } = setup(); let writes = 0; let sent: Record<string, unknown> | undefined;
  provider.request = async (_account, _path, options = {}) => { if (options.method === 'POST') { writes++; sent = JSON.parse(String(options.body)); assert.match(String(sent!.id), /^[a-v0-9]{32}$/); const durable = provider.operation(String((sent!.extendedProperties as { private: { reaCalendarOperation: string } }).private.reaCalendarOperation)); assert.equal(durable.status, 'dispatching'); throw new CalendarRequestError(502, 'Ambiguous mock transport', 'calendar_transport_failed', true); } return sent; };
  try {
    const operation = provider.prepareOperation({ accountId, calendarId, kind: 'create', event: input }); await assert.rejects(() => provider.executeOperation(operation.id), { code: 'calendar_delivery_unknown' }); assert.equal(provider.operation(operation.id).status, 'unknown'); await assert.rejects(() => provider.executeOperation(operation.id), { code: 'calendar_operation_locked' }); assert.equal(writes, 1);
    const resolved = await provider.reconcileOperation(operation.id); assert.equal(resolved.resolved, true); assert.equal(resolved.operation.status, 'succeeded'); await provider.executeOperation(operation.id); assert.equal(writes, 1);
  } finally { await provider.close(); store.close(); }
});

test('ETag update preserves existing properties, sends If-Match once and refuses stale/foreign organizer edits', async () => {
  const { store, provider } = setup(); let writes = 0; let current = rawEvent('event-one', { extendedProperties: { private: { unrelated: 'preserve' }, shared: { team: 'preserve' } } });
  provider.request = async (_account, _path, options = {}) => { if (!options.method) return current; writes++; assert.equal(options.method, 'PUT'); assert.equal((options.headers as Record<string, string>)['if-match'], '"v1"'); const body = JSON.parse(String(options.body)); assert.equal(body.extendedProperties.private.unrelated, 'preserve'); assert.equal(body.extendedProperties.shared.team, 'preserve'); assert.equal(body.summary, 'Changed'); return { ...body, etag: '"v2"' }; };
  try {
    const operation = provider.prepareOperation({ accountId, calendarId, kind: 'update', eventId: 'event-one', etag: '"v1"', event: { summary: 'Changed' } }); const result = await provider.executeOperation(operation.id); assert.equal(result.status, 'succeeded'); assert.equal(writes, 1);
    current = { ...current, etag: '"v3"' }; const stale = provider.prepareOperation({ accountId, calendarId, kind: 'update', eventId: 'event-one', etag: '"v1"', event: { summary: 'Changed' } }); await assert.rejects(() => provider.executeOperation(stale.id), { code: 'calendar_etag_conflict' }); assert.equal(provider.operation(stale.id).status, 'conflict'); assert.equal(writes, 1);
    current = { ...current, organizer: { email: 'external@example.test', self: false } }; const foreign = provider.prepareOperation({ accountId, calendarId, kind: 'delete', eventId: 'event-one', etag: '"v3"' }); await assert.rejects(() => provider.executeOperation(foreign.id), { code: 'calendar_external_organizer_unsupported' }); assert.equal(writes, 1);
  } finally { await provider.close(); store.close(); }
});

test('adding an approved attendee preserves retained guests RSVP/provider fields without allowing input to author them', async () => {
  const { store, google, provider: base } = setup(); const provider = new GoogleCalendarProvider(store, google, { ...env, APPROVED_CALENDAR_TEST_ATTENDEES: 'guest@example.test,new@example.test' });
  try {
    provider.request = async (_account, _path, options = {}) => { if (!options.method) return rawEvent('event-one', { attendees: [{ email: 'GUEST@example.test', displayName: 'Existing name', optional: true, responseStatus: 'accepted', self: false, comment: 'Keep provider field' }] }); const payload = JSON.parse(String(options.body)); assert.deepEqual(payload.attendees[0], { email: 'guest@example.test', displayName: 'Existing name', optional: true, responseStatus: 'accepted', self: false, comment: 'Keep provider field' }); assert.deepEqual(payload.attendees[1], { email: 'new@example.test' }); return { ...payload, etag: '"v2"' }; };
    const operation = provider.prepareOperation({ accountId, calendarId, kind: 'update', eventId: 'event-one', etag: '"v1"', event: { attendees: [{ email: 'guest@example.test' }, { email: 'new@example.test' }] } }); assert.equal((await provider.executeOperation(operation.id)).status, 'succeeded');
  } finally { await provider.close(); await base.close(); store.close(); }
});

test('interrupted operation is recovered unknown after reopening; 404 does not prove an uncertain create failed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'superhuman-calendar-operation-')); const path = join(directory, 'synthetic.sqlite'); let current = setup(path); let operation: CalendarOperation;
  try { operation = current.provider.prepareOperation({ accountId, calendarId, kind: 'create', event: input }); current.provider.repository.saveOperation({ ...operation, status: 'dispatching' }); await current.provider.close(); current.store.close(); current = setup(path); assert.equal(current.provider.operation(operation.id).status, 'unknown'); current.provider.request = async () => { throw new CalendarRequestError(404, 'Not found', 'calendar_not_found'); }; const result = await current.provider.reconcileOperation(operation.id); assert.equal(result.resolved, false); assert.equal(result.operation.status, 'unknown'); await assert.rejects(() => current.provider.executeOperation(operation.id), { code: 'calendar_operation_locked' }); } finally { await current.provider.close(); current.store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('Calendar GET reads pace/retry separately while writes and freebusy POST are never automatically retried', async () => {
  let calls = 0; const { store, provider, delays } = setup(':memory:', (async (_url, options) => { calls++; if (options?.method === 'POST') return response({ error: { errors: [{ reason: 'backendError' }] } }, 503); return calls < 3 ? response({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, 403) : response({ items: [], nextSyncToken: 'done' }); }) as typeof fetch);
  try { await provider.request(accountId, 'users/me/calendarList', {}, 'list'); assert.equal(calls, 3); assert.ok(delays.length >= 2); calls = 0; await assert.rejects(() => provider.request(accountId, 'freeBusy', { method: 'POST', body: '{}' }, 'freebusy')); assert.equal(calls, 1); } finally { await provider.close(); store.close(); }
});

test('Calendar background pages are bounded, backoff prevents repeated polling and jobs never initiate OAuth', async () => {
  const { store, google, provider, advance } = setup(); let calls = 0; google.startAuth = () => { throw new Error('No automatic auth'); }; provider.request = async () => { calls++; return { items: [], nextPageToken: 'more' }; };
  provider.repository.saveState(accountId, calendarId, 'events', { phase: 'incremental', partial: false, nextSyncAt: '2099-01-01T00:00:00Z' });
  try {
    assert.equal(provider.runJobs(), 1); await Promise.all(provider.jobs.values()); assert.equal(calls, 1); assert.equal(provider.runJobs(), 0); advance(1500); provider.request = async () => { calls++; throw new CalendarRequestError(429, 'Rate limited', 'calendar_rate_limited', false, 120_000); }; assert.equal(provider.runJobs(), 1); await Promise.all(provider.jobs.values()); const state = provider.syncStatus(accountId); assert.ok(state.nextSyncAt); assert.equal(state.errorCode, 'calendar_rate_limited'); assert.equal(state.requiresReconnect, false); assert.equal(provider.runJobs(), 0); await assert.rejects(() => provider.syncCalendarList(accountId), { code: 'calendar_sync_retry_pending' }); assert.equal(calls, 2);
    const disabled = new GoogleCalendarProvider(store, google, {}); assert.equal(disabled.runJobs(), 0); assert.equal(disabled.status().enabled, false); await disabled.close();
  } finally { await provider.close(); store.close(); }
});

test('account-wide Calendar quota backoff survives restart and never delays the independent Gmail transport', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'superhuman-calendar-backoff-')); const path = join(directory, 'synthetic.sqlite'); let calls = 0;
  const fetcher = (async url => { if (String(url).includes('gmail.googleapis.com')) return response({ messagesTotal: 1 }); calls++; return response({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, 403, { 'retry-after': '120' }); }) as typeof fetch; let current = setup(path, fetcher);
  try {
    await assert.rejects(() => current.provider.syncCalendarList(accountId), { code: 'calendar_rate_limited', status: 429 }); assert.equal(calls, 1); assert.ok(current.store.get('calendarBackoff', accountId)); await current.provider.close(); current.store.close(); current = setup(path, fetcher);
    assert.equal(current.provider.runJobs(), 0); await assert.rejects(() => current.provider.freeBusy(accountId, { ...range, items: [calendarId] }), { code: 'calendar_retry_pending' }); assert.equal(calls, 1);
    current.google.saveTokens(accountId, { access_token: 'independent-mail', refresh_token: 'independent-refresh', expires_at: Date.now() + 3600_000 }); assert.deepEqual(await current.google.request(accountId, 'profile'), { messagesTotal: 1 }); assert.equal(calls, 1);
  } finally { await current.provider.close(); current.store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('visible cache has eight-window/twenty-page bounds and refuses dense ranges without claiming completeness', async () => {
  const { store, provider } = setup(); let calls = 0;
  try {
    provider.request = async () => ({ items: [] });
    for (let day = 1; day <= 9; day++) await provider.visibleRange(accountId, calendarId, { timeMin: `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`, timeMax: `2026-10-${String(day + 1).padStart(2, '0')}T00:00:00Z`, timeZone: 'UTC' });
    assert.equal(provider.repository.db.prepare('SELECT COUNT(*) AS count FROM calendar_ranges WHERE account_id=? AND calendar_id=?').get(accountId, calendarId)!.count, 8);
    provider.request = async () => { calls++; return { items: [rawEvent(`dense-${calls}`)], nextPageToken: `page-${calls}` }; };
    for (let page = 0; page < 20; page++) assert.equal((await provider.visibleRange(accountId, calendarId, range)).cache.partial, true);
    await assert.rejects(() => provider.visibleRange(accountId, calendarId, range), { code: 'calendar_range_too_dense', status: 413 }); assert.equal(calls, 20);
  } finally { await provider.close(); store.close(); }
});

test('write transport never retries server errors or malformed success and delete reconciliation is read-only', async () => {
  for (const status of [503, 200]) {
    let calls = 0; const { store, provider } = setup(':memory:', (async () => { calls++; return response({}, status); }) as typeof fetch);
    try { const operation = provider.prepareOperation({ accountId, calendarId, kind: 'create', event: input }); await assert.rejects(() => provider.executeOperation(operation.id), { code: 'calendar_delivery_unknown' }); assert.equal(provider.operation(operation.id).status, 'unknown'); assert.equal(calls, 1); await assert.rejects(() => provider.executeOperation(operation.id), { code: 'calendar_operation_locked' }); assert.equal(calls, 1); } finally { await provider.close(); store.close(); }
  }
  const { store, provider } = setup(); let writes = 0;
  try {
    provider.request = async (_account, _path, options = {}) => { if (!options.method) return rawEvent(); writes++; assert.equal(options.method, 'DELETE'); assert.equal((options.headers as Record<string, string>)['if-match'], '"v1"'); throw new CalendarRequestError(502, 'Uncertain delete', 'calendar_transport_failed', true); };
    const operation = provider.prepareOperation({ accountId, calendarId, kind: 'delete', eventId: 'event-one', etag: '"v1"' }); await assert.rejects(() => provider.executeOperation(operation.id), { code: 'calendar_delivery_unknown' }); assert.throws(() => provider.prepareOperation({ accountId, calendarId, kind: 'update', eventId: 'event-one', etag: '"v1"', event: { summary: 'Changed' } }), { code: 'calendar_operation_locked' });
    provider.request = async (_account, _path, options = {}) => { assert.equal(options.method, undefined); throw new CalendarRequestError(404, 'Not found or unavailable', 'calendar_not_found'); }; assert.equal((await provider.reconcileOperation(operation.id)).resolved, false);
    provider.request = async () => ({ id: operation.eventId, status: 'cancelled' }); const result = await provider.reconcileOperation(operation.id); assert.equal(result.resolved, true); assert.equal(writes, 1);
  } finally { await provider.close(); store.close(); }
});

test('Google Meet intent persists a stable request ID and reports asynchronous pending/failure/success without another write', async () => {
  const { store, provider } = setup(); let writes = 0; let created: Record<string, unknown> = {};
  try {
    provider.request = async (_account, path, options = {}) => { writes++; assert.equal(options.method, 'POST'); assert.equal(new URL(path, 'https://calendar.invalid/').searchParams.get('conferenceDataVersion'), '1'); created = JSON.parse(String(options.body)); assert.equal('conference' in created, false); const request = (created.conferenceData as { createRequest: { requestId: string; conferenceSolutionKey: { type: string } } }).createRequest; assert.equal(request.conferenceSolutionKey.type, 'hangoutsMeet'); const operationId = (created.extendedProperties as { private: { reaCalendarOperation: string } }).private.reaCalendarOperation; assert.equal(provider.operation(operationId).conferenceRequestId, request.requestId); return { ...created, etag: '"saved"', conferenceData: { createRequest: { ...request, status: { statusCode: 'pending' } } } }; };
    const operation = provider.prepareOperation({ accountId, calendarId, kind: 'create', event: { ...input, conference: { provider: 'googleMeet' } } }); assert.ok(operation.conferenceRequestId); const result = await provider.executeOperation(operation.id); assert.equal(result.status, 'succeeded'); assert.equal(result.result!.meetingLink!.status, 'pending'); assert.equal(result.result!.meetingLink!.uri, undefined); await provider.executeOperation(operation.id); assert.equal(writes, 1);
    provider.request = async () => ({ ...created, etag: '"failure"', conferenceData: { createRequest: { requestId: operation.conferenceRequestId, conferenceSolutionKey: { type: 'hangoutsMeet' }, status: { statusCode: 'failure' } } } }); assert.equal((await provider.getEvent(accountId, calendarId, operation.eventId)).meetingLink!.status, 'failure');
    provider.request = async () => ({ ...created, etag: '"success"', conferenceData: { conferenceSolution: { key: { type: 'hangoutsMeet' } }, entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] } }); const complete = await provider.getEvent(accountId, calendarId, operation.eventId); assert.equal(complete.meetingLink!.status, 'success'); assert.equal(complete.meetingLink!.uri, 'https://meet.google.com/abc-defg-hij'); assert.equal(writes, 1);
  } finally { await provider.close(); store.close(); }
});

test('existing conferences are preserved, unsupported Meet/replacement are blocked, and unconfirmed conference response stays unknown', async () => {
  const { store, provider } = setup(); let writes = 0; const conferenceData = { conferenceId: 'existing-meet', conferenceSolution: { key: { type: 'hangoutsMeet' } }, entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] };
  try {
    provider.request = async (_account, path, options = {}) => { if (!options.method) return rawEvent('existing', { conferenceData }); writes++; assert.equal(new URL(path, 'https://calendar.invalid/').searchParams.get('conferenceDataVersion'), '1'); const payload = JSON.parse(String(options.body)); assert.deepEqual(payload.conferenceData, conferenceData); return { ...payload, etag: '"v2"' }; };
    const update = provider.prepareOperation({ accountId, calendarId, kind: 'update', eventId: 'existing', etag: '"v1"', event: { summary: 'Keep link' } }); await provider.executeOperation(update.id); assert.equal(writes, 1);
    const replace = provider.prepareOperation({ accountId, calendarId, kind: 'update', eventId: 'existing', etag: '"v1"', event: { conference: { provider: 'googleMeet' } } }); await assert.rejects(() => provider.executeOperation(replace.id), { code: 'calendar_meeting_link_exists' }); assert.equal(writes, 1);
    const metadata = provider.repository.calendar(accountId, calendarId)!; provider.repository.saveCalendar({ ...metadata, allowedConferenceSolutionTypes: ['addOn'] }); assert.throws(() => provider.prepareOperation({ accountId, calendarId, kind: 'create', event: { ...input, conference: { provider: 'googleMeet' } } }), { code: 'calendar_meet_unavailable' }); provider.repository.saveCalendar({ ...metadata, allowedConferenceSolutionTypes: ['hangoutsMeet'] });
    provider.request = async (_account, _path, options = {}) => { const payload = JSON.parse(String(options.body)); delete payload.conferenceData; return { ...payload, etag: '"saved-no-ack"' }; }; const unknown = provider.prepareOperation({ accountId, calendarId, kind: 'create', event: { ...input, conference: { provider: 'googleMeet' } } }); const result = await provider.executeOperation(unknown.id); assert.equal(result.status, 'succeeded'); assert.equal(result.result!.meetingLink!.status, 'unknown'); assert.equal(result.result!.meetingLink!.uri, undefined);
  } finally { await provider.close(); store.close(); }
});

test('Calendar HTTP readiness stays explicit/off by default and existing Gmail/summary endpoints keep working', async () => {
  const app = createApp({ databasePath: ':memory:', env: {}, runJobs: false }); await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve)); const address = app.server.address(); assert.ok(address && typeof address === 'object'); const base = `http://127.0.0.1:${address.port}`;
  try {
    const status = await (await fetch(`${base}/api/calendar/status`)).json(); assert.equal(status.calendar.enabled, false); assert.equal(status.calendar.liveVerified, false); assert.ok(status.calendar.missing.includes('GOOGLE_CALENDAR_ENABLED'));
    const calendars = await (await fetch(`${base}/api/calendar/calendars`)).json(); assert.deepEqual(calendars.calendars, []); assert.equal(calendars.sync.partial, true);
    const sync = await fetch(`${base}/api/calendar/calendars/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(sync.status, 503);
    const auth = await fetch(`${base}/api/auth/google/start?service=calendar`, { redirect: 'manual' }); assert.equal(auth.status, 503);
    const summaries = await (await fetch(`${base}/api/thread-summaries?limit=2`)).json(); assert.equal(summaries.threads.length, 2); assert.equal(summaries.threads[0].messages, undefined); const bootstrap = await (await fetch(`${base}/api/bootstrap`)).json(); assert.equal(bootstrap.threads.length, 12); assert.equal(bootstrap.providerStatus.calendar.enabled, false);
    Object.assign(app.google.env, env); app.store.put<Account>('account', accountId, { id: accountId, name: 'Owner', email: calendarId, provider: 'google', color: '#888' }); app.store.put<GoogleServiceGrant>('googleGrant', `calendar:${accountId}`, { accountId, service: 'calendar', requestedScopes: CALENDAR_REQUEST_SCOPES, grantedScopes: CALENDAR_REQUEST_SCOPES, scopeSource: 'response', outcome: 'granted', updatedAt: new Date().toISOString() }); app.calendar.repository.saveCalendar({ accountId, id: calendarId, summary: 'Owned', accessRole: 'owner', timeZone: 'America/Los_Angeles', updatedAt: new Date().toISOString() }); app.calendar.request = async () => rawEvent('moved-event', { etag: '"authoritative"' }); const detail = await (await fetch(`${base}/api/calendar/events/moved-event?accountId=${encodeURIComponent(accountId)}&calendarId=${encodeURIComponent(calendarId)}`)).json(); assert.equal(detail.event.etag, '"authoritative"'); assert.equal(app.calendar.repository.events(accountId, calendarId).length, 0);
  } finally { await app.close(); }
});
