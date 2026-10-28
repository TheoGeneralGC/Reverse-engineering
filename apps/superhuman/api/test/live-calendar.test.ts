import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarFixture, createCalendarState, parseCalendarFlags, runCalendarHarness, validateCalendarApproval, validateCalendarBoundary, validateCalendarRequest } from './live-calendar.mjs';

// Intentionally mutable synthetic provider shapes exercise malformed/hostile values.
type Synthetic = Record<string, any>;
const now = () => Date.parse('2026-10-28T04:00:00Z');
function approval(): Synthetic { return { authorizedBy: 'user', authorizedAt: '2026-10-28T03:37:04.091Z', runId: 'calendar-synthetic-01', organizer: 'organizer@example.test', attendees: ['attendee@example.test'], calendarId: 'organizer@example.test', titlePrefix: 'REA test', start: { dateTime: '2026-10-30T15:00:00-07:00', timeZone: 'America/Los_Angeles' }, end: { dateTime: '2026-10-30T15:05:00-07:00', timeZone: 'America/Los_Angeles' }, allowedActions: ['create', 'update', 'delete', 'googleMeet'], invitationUpdatesApproved: true, maxEvents: 1, serverApproval: { accounts: ['organizer@example.test'], calendarIds: ['organizer@example.test'], attendees: ['attendee@example.test'], verifiedAt: '2026-10-28T03:50:00Z' } }; }
const scopeNames = ['calendar.calendarlist.readonly', 'calendar.events.readonly', 'calendar.events.owned', 'calendar.events.freebusy'];
function setup() {
  const approved = approval(); const state = createCalendarState(approved); const accounts = [{ id: 'google:organizer', email: approved.organizer, provider: 'google' }, { id: 'google:attendee', email: approved.attendees[0], provider: 'google' }];
  const statuses = Object.fromEntries(accounts.map(account => [account.id, { enabled: true, configured: true, writesEnabled: account.id === accounts[0].id, grant: { accountId: account.id, service: 'calendar', grantedScopes: scopeNames.map(name => `https://www.googleapis.com/auth/${name}`) }, capabilities: { list: true, read: true, readOwned: true, writeOwned: true, freebusy: true } }]));
  const calendars = [{ accountId: accounts[0].id, id: approved.calendarId, primary: true, accessRole: 'owner', allowedConferenceSolutionTypes: ['hangoutsMeet'] }];
  const records: Record<string, Synthetic> = {}; const requests: { route: string; method: string; body: any }[] = []; const snapshots: Synthetic[] = []; let event: Synthetic | undefined; let prepareFailure = false; let executeFailure = false; let onPrepare: ((operation: Synthetic) => void) | undefined;
  const persist = (value: Synthetic) => snapshots.push(structuredClone(value));
  async function request(route: string, body?: Synthetic): Promise<any> {
    const url = new URL(route, 'http://127.0.0.1:3001'); const method = body === undefined ? 'GET' : 'POST'; requests.push({ route, method, body: structuredClone(body) });
    if (url.pathname === '/api/accounts') return { accounts: structuredClone(accounts) };
    if (url.pathname === '/api/calendar/status') return { calendar: structuredClone(statuses[url.searchParams.get('accountId')!]) };
    if (url.pathname === '/api/calendar/calendars') return { calendars: structuredClone(calendars) };
    if (url.pathname === '/api/calendar/operations') {
      assert.ok(body); const { kind } = body; const operation: Synthetic = { id: `operation-${kind}`, kind, accountId: body.accountId, calendarId: body.calendarId, eventId: kind === 'create' ? 'abcdef012345' : body.eventId, ...(body.etag ? { etag: body.etag } : {}), ...(body.event ? { input: structuredClone(body.event) } : {}), ...(kind === 'create' ? { conferenceRequestId: 'owned-meet-request' } : {}), status: 'prepared' };
      records[operation.id] = operation; onPrepare?.(operation); if (prepareFailure) throw new Error('Synthetic lost prepare response'); return { operation: structuredClone(operation) };
    }
    const operationMatch = url.pathname.match(/^\/api\/calendar\/operations\/([^/]+)(?:\/(execute|reconcile))?$/);
    if (operationMatch) {
      const operation = records[operationMatch[1]]; assert.ok(operation);
      if (operationMatch[2] === 'execute') {
        const last = snapshots.at(-1); assert.ok(last); assert.ok(last.steps[operation.kind].executeAttemptedAt, 'attempt must be durable before dispatch'); assert.equal(last.operations[operation.kind].id, operation.id);
        if (executeFailure) { operation.status = 'unknown'; throw Object.assign(new Error('Synthetic ambiguous dispatch'), { code: 'calendar_delivery_unknown' }); }
        operation.status = 'succeeded';
        if (operation.kind === 'delete') event = { accountId: operation.accountId, calendarId: operation.calendarId, id: operation.eventId, status: 'cancelled' };
        else event = { ...event, ...(operation.input ?? {}), id: operation.eventId, accountId: operation.accountId, calendarId: operation.calendarId, organizer: { email: approved.organizer }, etag: `"revision-${operation.kind}"`, status: 'confirmed', extendedProperties: { private: { reaCalendarOperation: operation.id } }, meetingLink: { provider: 'googleMeet', status: 'pending', requestId: 'owned-meet-request' } };
        operation.result = structuredClone(event);
      }
      return operationMatch[2] === 'reconcile' ? { resolved: operation.status === 'succeeded', operation: structuredClone(operation) } : { operation: structuredClone(operation) };
    }
    if (url.pathname === `/api/calendar/events/${state.eventId}`) return { event: structuredClone(event) };
    throw new Error('Unexpected synthetic request');
  }
  const run = (mode: string, step = '', options: Synthetic = {}) => runCalendarHarness({ flags: { mode, step, runId: approved.runId, polls: 2, intervalMs: 0 }, approval: approved, approvedParticipants: [approved.organizer, approved.attendees[0]], state, persist, request, now, sleep: async () => {}, ...options });
  return { approved, state, accounts, statuses, calendars, records, requests, snapshots, run, get event() { return event as Synthetic; }, set event(value: Synthetic) { event = value; }, set prepareFailure(value: boolean) { prepareFailure = value; }, set executeFailure(value: boolean) { executeFailure = value; }, set onPrepare(value: (operation: Synthetic) => void) { onPrepare = value; } };
}

test('manifest requires exact participants, explicit complete approval, future interval shape and deployed allowlist attestation', () => {
  const valid = approval(); assert.doesNotThrow(() => validateCalendarApproval(valid, valid.runId, true, [valid.organizer, valid.attendees[0]]));
  for (const change of [(value: Synthetic) => value.attendees.push('outsider@example.test'), (value: Synthetic) => value.organizer = 'other@example.test', (value: Synthetic) => value.serverApproval.attendees.push(value.organizer), (value: Synthetic) => value.calendarId = null, (value: Synthetic) => value.maxEvents = 2, (value: Synthetic) => value.invitationUpdatesApproved = false, (value: Synthetic) => value.end.dateTime = '2026-10-30T15:06:00-07:00', (value: Synthetic) => value.start.dateTime = '2026-10-30T15:00:00-08:00']) { const value = structuredClone(valid); change(value); assert.throws(() => validateCalendarApproval(value, valid.runId, true, [valid.organizer, valid.attendees[0]])); }
  const incomplete = { ...valid, calendarId: null, serverApproval: null }; assert.doesNotThrow(() => validateCalendarApproval(incomplete, valid.runId, false, [valid.organizer, valid.attendees[0]]));
  assert.equal(parseCalendarFlags(['--run-id', valid.runId]).mode, 'plan'); assert.throws(() => parseCalendarFlags(['--run-id', valid.runId, '--step', 'create', '--verify'])); assert.throws(() => parseCalendarFlags(['--run-id', valid.runId, '--step', 'invite']));
});

test('fixed local request guard rejects provider/auth/mail access, wrong context, fresh operation IDs and write calls in read-only modes', () => {
  const state = { accountId: 'google:organizer', connectedAccountIds: ['google:organizer', 'google:attendee'], calendarId: 'owned', eventId: 'abcde', operations: { create: { id: 'own-op' } } }; const verify = { mode: 'verify' };
  assert.doesNotThrow(() => validateCalendarRequest(verify, '/api/calendar/events/abcde?accountId=google%3Aorganizer&calendarId=owned', 'GET', state));
  for (const [route, method] of [['https://googleapis.com/api/accounts', 'GET'], ['/api/auth/google/start', 'GET'], ['/api/accounts?extra=true', 'GET'], ['/api/calendar/events/abcde?accountId=other&calendarId=owned', 'GET'], ['/api/calendar/events/abcde?accountId=google%3Aorganizer&calendarId=foreign', 'GET'], ['/api/calendar/events/other?accountId=google%3Aorganizer&calendarId=owned', 'GET'], ['/api/calendar/operations/other', 'GET'], ['/api/calendar/operations/own-op/execute', 'POST'], ['/api/calendar/operations', 'POST'], ['/api/drafts/anything/send', 'POST']]) assert.throws(() => validateCalendarRequest(verify, route, method, state));
  assert.doesNotThrow(() => validateCalendarRequest({ mode: 'reconcile', step: 'create' }, '/api/calendar/operations/own-op/reconcile', 'POST', state));
  assert.throws(() => validateCalendarRequest({ mode: 'reconcile', step: 'create' }, '/api/calendar/operations/own-op/execute', 'POST', state));
});

test('ready plan reads both grants and primary owner/Meet metadata without preparing or dispatching', async () => {
  const value = setup(); const result = await value.run('plan'); assert.equal(result.status, 'ready'); assert.equal(result.fixture.summary, `REA test — calendar + Meet — ${value.approved.runId}`); assert.deepEqual(result.fixture.attendees, [{ email: 'attendee@example.test' }]); assert.deepEqual(value.requests.filter(request => request.method === 'POST'), []);
  value.statuses[value.accounts[1].id].grant.grantedScopes.pop(); await assert.rejects(() => value.run('plan'), /four explicitly approved/);
});

test('one create, read-only pending Meet check, one conditional edit and one conditional cleanup use the same owned ID', async () => {
  const value = setup(); assert.equal((await value.run('execute', 'create')).status, 'succeeded'); assert.equal(value.state.operations.create.conferenceRequestId, 'owned-meet-request');
  assert.equal((await value.run('verify')).meetingStatus, 'pending');
  assert.equal((await value.run('execute', 'update')).status, 'succeeded'); assert.equal((await value.run('execute', 'delete')).status, 'succeeded'); assert.equal((await value.run('verify')).status, 'cancelled');
  const prepared = value.requests.filter(request => request.route === '/api/calendar/operations'); assert.equal(prepared.length, 3); assert.deepEqual(prepared.map(request => request.body.kind), ['create', 'update', 'delete']);
  assert.equal(prepared[0].body.event.attendees.length, 1); assert.deepEqual(prepared[0].body.event.conference, { provider: 'googleMeet' }); assert.equal(prepared[1].body.etag, '"revision-create"'); assert.equal(prepared[2].body.etag, '"revision-update"'); assert.equal(prepared[1].body.eventId, prepared[2].body.eventId); assert.equal(prepared[2].body.event, undefined);
  const before = value.requests.length; const repeated = await value.run('execute', 'create'); assert.equal(repeated.dispatchedAgain, false); assert.equal(repeated.writes, 0); assert.equal(value.requests.slice(before).some(request => request.method === 'POST'), false);
});

test('ambiguous execution stays locked across repeated commands and read-only reconciliation never dispatches again', async () => {
  const value = setup(); value.executeFailure = true; await assert.rejects(() => value.run('execute', 'create'), /single Calendar dispatch was attempted/); assert.ok(value.state.steps.create.executeAttemptedAt);
  assert.equal((await value.run('execute', 'create')).status, 'unknown'); assert.equal((await value.run('reconcile', 'create')).resolved, false); await assert.rejects(() => value.run('execute', 'update'), /unresolved operation/);
  assert.equal(value.requests.filter(request => request.route.endsWith('/execute')).length, 1); assert.equal(value.requests.filter(request => request.route === '/api/calendar/operations').length, 1);
});

test('lost prepare response cannot create a replacement operation or event on rerun', async () => {
  const value = setup(); value.prepareFailure = true; await assert.rejects(() => value.run('execute', 'create'), /lost prepare response/); assert.ok(value.state.steps.create.prepareAttemptedAt); assert.equal(value.state.eventId, undefined); await assert.rejects(() => value.run('execute', 'create'), /prior prepare response/);
  assert.equal(value.requests.filter(request => request.route === '/api/calendar/operations').length, 1); assert.equal(value.requests.filter(request => request.route.endsWith('/execute')).length, 0);
});

test('queued prepared status plus attempted journal cannot be submitted twice', async () => {
  const value = setup(); value.executeFailure = true; await assert.rejects(() => value.run('execute', 'create')); value.records['operation-create'].status = 'prepared'; const result = await value.run('execute', 'create'); assert.equal(result.status, 'prepared'); assert.equal(result.dispatchedAgain, false); await assert.rejects(() => value.run('reconcile', 'create'), /pending\/preflight-failed/); assert.equal(value.requests.filter(request => request.route.endsWith('/execute')).length, 1);
});

test('an attempted update still locally prepared locks cleanup until its durable server outcome is read', async () => {
  const value = setup(); await value.run('execute', 'create'); value.executeFailure = true; await assert.rejects(() => value.run('execute', 'update')); assert.equal(value.state.operations.update.status, 'prepared'); assert.ok(value.state.steps.update.executeAttemptedAt);
  const before = value.requests.filter(request => request.method === 'POST').length; await assert.rejects(() => value.run('execute', 'delete'), /unresolved operation/); assert.equal(value.requests.filter(request => request.method === 'POST').length, before);
  assert.equal((await value.run('execute', 'update')).status, 'unknown'); await assert.rejects(() => value.run('execute', 'delete'), /unresolved operation/);
});

test('unapproved participant, edited notes/privacy/availability/location, identity, time or ETag drift prevents edit preparation', async () => {
  for (const change of [(event: Synthetic) => event.attendees.push({ email: 'outsider@example.test' }), (event: Synthetic) => event.organizer.email = 'outsider@example.test', (event: Synthetic) => event.summary = 'Existing unrelated event', (event: Synthetic) => event.description = 'New user notes', (event: Synthetic) => event.visibility = 'public', (event: Synthetic) => event.transparency = 'opaque', (event: Synthetic) => event.location = 'New user location', (event: Synthetic) => event.extendedProperties.private.reaCalendarOperation = 'foreign', (event: Synthetic) => event.start.dateTime = '2026-10-30T16:00:00-07:00', (event: Synthetic) => event.recurrence = ['RRULE:FREQ=DAILY'], (event: Synthetic) => event.etag = '*']) {
    const value = setup(); await value.run('execute', 'create'); change(value.event); const before = value.requests.filter(request => request.route === '/api/calendar/operations').length; await assert.rejects(() => value.run('execute', 'update')); assert.equal(value.requests.filter(request => request.route === '/api/calendar/operations').length, before);
  }
});

test('grant/role loss between prepare and execute blocks dispatch while preserving the prepared ID', async () => {
  const value = setup(); value.onPrepare = () => { value.calendars[0].accessRole = 'reader'; }; await assert.rejects(() => value.run('execute', 'create'), /primary owned Calendar/); assert.equal(value.state.operations.create.id, 'operation-create'); assert.equal(value.state.steps.create.executeAttemptedAt, undefined); assert.equal(value.requests.filter(request => request.route.endsWith('/execute')).length, 0);
  assert.throws(() => validateCalendarBoundary(value.approved, value.accounts, value.statuses, value.calendars));
});

test('future creation is required but the exact already-created event can be cancelled after its start', async () => {
  const value = setup(); const afterStart = () => Date.parse(value.approved.start.dateTime) + 60000; await assert.rejects(() => value.run('execute', 'create', { now: afterStart }), /future synthetic/); assert.equal(value.requests.some(request => request.method === 'POST'), false); await value.run('execute', 'create'); assert.equal((await value.run('execute', 'delete', { now: afterStart })).status, 'succeeded');
});
