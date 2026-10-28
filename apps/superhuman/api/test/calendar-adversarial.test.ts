import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { GoogleProvider } from '../src/google.ts';
import { GoogleCalendarProvider, CalendarRequestError } from '../src/calendar.ts';
import { CALENDAR_REQUEST_SCOPES, CALENDAR_SCOPES } from '../src/google-scopes.ts';
import type { Account } from '../src/types.ts';

const accountId = 'google:audit@example.test'; const calendarId = 'audit@example.test';
const env = { GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-secret', TOKEN_ENCRYPTION_KEY: 'd'.repeat(64), GOOGLE_CALENDAR_ENABLED: 'true', APPROVED_CALENDAR_TEST_ACCOUNTS: calendarId, APPROVED_CALENDAR_TEST_IDS: calendarId, APPROVED_CALENDAR_TEST_ATTENDEES: '' };
const range = { timeMin: '2026-10-27T00:00:00Z', timeMax: '2026-11-03T00:00:00Z', timeZone: 'America/Los_Angeles' };
const input = { summary: 'Synthetic audit event', start: { dateTime: '2026-10-28T10:00:00-07:00', timeZone: 'America/Los_Angeles' }, end: { dateTime: '2026-10-28T11:00:00-07:00', timeZone: 'America/Los_Angeles' } };
const rawEvent = (id = 'event-one', extra: Record<string, unknown> = {}) => ({ id, status: 'confirmed', etag: '"v1"', ...input, organizer: { email: calendarId, self: true }, ...extra });
function fixture(fetcher: typeof fetch = (async () => { throw new Error('Unexpected external request in offline audit'); }) as typeof fetch) {
  const store = new Store(':memory:', false); store.put<Account>('account', accountId, { id: accountId, name: 'Synthetic Audit', email: calendarId, provider: 'google', color: '#888' });
  const google = new GoogleProvider(store, env, fetcher);
  google.saveTokens(accountId, { access_token: 'synthetic-calendar-token', refresh_token: 'synthetic-calendar-refresh', expires_at: Date.now() + 3600_000 }, 'calendar');
  store.put('googleGrant', `calendar:${accountId}`, { accountId, service: 'calendar', requestedScopes: CALENDAR_REQUEST_SCOPES, grantedScopes: CALENDAR_REQUEST_SCOPES, scopeSource: 'response', outcome: 'granted', updatedAt: '2026-10-27T12:00:00Z' });
  const provider = new GoogleCalendarProvider(store, google, env, fetcher, { now: () => Date.parse('2026-10-27T12:00:00Z'), sleep: async () => {}, random: () => 0 });
  provider.repository.saveCalendar({ accountId, id: calendarId, summary: 'Synthetic owned calendar', accessRole: 'owner', timeZone: 'America/Los_Angeles', updatedAt: '2026-10-27T12:00:00Z' });
  return { store, google, provider, close: async () => { await provider.close(); store.close(); } };
}
async function unknownDelete(provider: GoogleCalendarProvider) {
  const operation = provider.prepareOperation({ accountId, calendarId, kind: 'delete', eventId: 'event-one', etag: '"v1"' });
  provider.request = async (_account, _path, options = {}) => { if (!options.method) return rawEvent(); assert.equal(options.method, 'DELETE'); throw new CalendarRequestError(502, 'Synthetic lost delete response', 'calendar_transport_failed', true); };
  await assert.rejects(() => provider.executeOperation(operation.id), { code: 'calendar_delivery_unknown' });
  return operation;
}

test('operation kinds cannot coerce arrays or objects into a destructive dispatch', async () => {
  const f = fixture(); try {
    for (const kind of [['delete'], ['update'], ['create'], [], {}, null, 1]) assert.throws(() => f.provider.prepareOperation({ accountId, calendarId, kind, eventId: 'event-one', etag: '"v1"', event: input }), { status: 400, code: 'invalid_calendar_operation' });
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM calendar_operations').get()!.count, 0);
  } finally { await f.close(); }
});

test('an uncertain delete stays unknown on 404 because calendar access may have disappeared', async () => {
  const f = fixture(); try {
    const operation = await unknownDelete(f.provider); let reads = 0;
    f.provider.request = async (_account, _path, options = {}) => { reads++; assert.equal(options.method, undefined); throw new CalendarRequestError(404, 'Synthetic inaccessible calendar', 'calendar_not_found'); };
    const missing = await f.provider.reconcileOperation(operation.id); assert.equal(missing.resolved, false); assert.equal(missing.operation.status, 'unknown'); assert.equal(reads, 1);
    await assert.rejects(() => f.provider.executeOperation(operation.id), { code: 'calendar_operation_locked' }); assert.equal(reads, 1);
    f.provider.request = async (_account, _path, options = {}) => { assert.equal(options.method, undefined); throw new CalendarRequestError(410, 'Synthetic deleted resource', 'calendar_sync_expired'); };
    const gone = await f.provider.reconcileOperation(operation.id); assert.equal(gone.resolved, true); assert.equal(gone.operation.result!.id, 'event-one'); assert.equal(gone.operation.result!.status, 'cancelled');
  } finally { await f.close(); }
});

test('delete reconciliation cannot confirm a cancelled event with a different identity', async () => {
  const f = fixture(); try {
    const operation = await unknownDelete(f.provider);
    f.provider.request = async () => ({ id: 'different-event', status: 'cancelled' });
    const wrong = await f.provider.reconcileOperation(operation.id); assert.equal(wrong.resolved, false); assert.equal(wrong.operation.status, 'unknown'); assert.equal(f.provider.repository.event(accountId, calendarId, 'different-event'), undefined);
    f.provider.request = async () => ({ id: 'event-one', status: 'cancelled' });
    const matching = await f.provider.reconcileOperation(operation.id); assert.equal(matching.resolved, true); assert.equal(matching.operation.status, 'succeeded');
  } finally { await f.close(); }
});

test('visible timed events retain chronological order when their RFC3339 offsets differ', async () => {
  const f = fixture(); try {
    const early = rawEvent('early', { start: { dateTime: '2026-10-28T10:00:00+01:00', timeZone: 'Europe/London' }, end: { dateTime: '2026-10-28T11:00:00+01:00', timeZone: 'Europe/London' } });
    const late = rawEvent('late', { start: { dateTime: '2026-10-28T09:00:00-07:00', timeZone: 'America/Los_Angeles' }, end: { dateTime: '2026-10-28T10:00:00-07:00', timeZone: 'America/Los_Angeles' } });
    f.provider.request = async () => ({ items: [early, late] });
    const result = await f.provider.visibleRange(accountId, calendarId, range); assert.deepEqual(result.events.map(event => event.id), ['early', 'late']);
  } finally { await f.close(); }
});

test('availability never trusts offsetless or normalized-invalid provider busy timestamps', async () => {
  const f = fixture(); try {
    for (const start of ['2026-10-28T12:00:00', '2026-02-30T12:00:00Z', '2026-10-28T12:00:60Z']) {
      f.provider.request = async () => ({ ...range, calendars: { selected: { busy: [{ start, end: '2026-10-28T13:00:00Z' }] } } });
      const result = await f.provider.freeBusy(accountId, { ...range, items: ['selected'] }); assert.equal(result.complete, false, start); assert.equal(result.calendars.selected.status, 'unknown', start);
    }
  } finally { await f.close(); }
});

test('requested availability IDs cannot disappear through inherited dictionary properties', async () => {
  const f = fixture(); try {
    const ids = ['toString', 'constructor', '__proto__'];
    f.provider.request = async () => ({ ...range, calendars: {}, groups: {} });
    const result = await f.provider.freeBusy(accountId, { ...range, items: ids }); assert.equal(result.complete, false);
    for (const id of ids) { assert.equal(Object.hasOwn(result.calendars, id), true, id); assert.equal(result.calendars[id].status, 'unknown', id); }
    const serialized = JSON.parse(JSON.stringify(result)); assert.deepEqual(Object.keys(serialized.calendars).sort(), [...ids].sort());
  } finally { await f.close(); }
});

test('a narrower token refresh is enforced before the Calendar request and leaves mail credentials intact', async () => {
  let refreshes = 0; let calendarRequests = 0;
  const f = fixture((async url => {
    if (String(url) === 'https://oauth2.googleapis.com/token') { refreshes++; return new Response(JSON.stringify({ access_token: 'synthetic-narrow-token', refresh_token: 'synthetic-rotated-calendar-refresh', expires_in: 3600, scope: CALENDAR_SCOPES.list }), { status: 200 }); }
    calendarRequests++; throw new Error('Calendar read must fail before provider access after grant narrows');
  }) as typeof fetch);
  try {
    f.google.saveTokens(accountId, { access_token: 'synthetic-mail-stable', refresh_token: 'synthetic-mail-refresh', expires_at: Date.now() + 3600_000 });
    const originalMail = f.store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(accountId)!.value;
    f.google.saveTokens(accountId, { access_token: 'synthetic-expired-calendar', refresh_token: 'synthetic-old-calendar-refresh', expires_at: 0 }, 'calendar');
    await assert.rejects(() => f.provider.visibleRange(accountId, calendarId, range), { status: 403, code: 'calendar_scope_required' });
    assert.equal(refreshes, 1); assert.equal(calendarRequests, 0); assert.equal(f.store.db.prepare('SELECT value FROM secrets WHERE account_id=?').get(accountId)!.value, originalMail); assert.equal(f.provider.capabilities(accountId).read, false);
  } finally { await f.close(); }
});

test('local commit failure after provider success remains unknown and reconciles without a second write', async () => {
  const f = fixture(); let writes = 0; let remote: Record<string, unknown> | undefined;
  try {
    f.provider.request = async (_account, _path, options = {}) => { if (options.method === 'POST') { writes++; remote = { ...JSON.parse(String(options.body)), etag: '"created"', status: 'confirmed' }; return remote; } assert.equal(options.method, undefined); return remote; };
    const saveEvent = f.provider.repository.saveEvent.bind(f.provider.repository);
    f.provider.repository.saveEvent = () => { throw new Error('Synthetic local disk failure after provider commit'); };
    const operation = f.provider.prepareOperation({ accountId, calendarId, kind: 'create', event: input });
    await assert.rejects(() => f.provider.executeOperation(operation.id), { code: 'calendar_delivery_unknown' }); assert.equal(f.provider.operation(operation.id).status, 'unknown'); assert.equal(writes, 1); assert.equal(f.provider.repository.event(accountId, calendarId, operation.eventId), undefined);
    await assert.rejects(() => f.provider.executeOperation(operation.id), { code: 'calendar_operation_locked' }); assert.equal(writes, 1);
    f.provider.repository.saveEvent = saveEvent;
    const result = await f.provider.reconcileOperation(operation.id); assert.equal(result.resolved, true); assert.equal(result.operation.status, 'succeeded'); assert.equal(writes, 1);
  } finally { await f.close(); }
});
