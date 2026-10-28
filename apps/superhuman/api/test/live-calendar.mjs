#!/usr/bin/env node
/** One explicitly authorized synthetic Calendar lifecycle. Inactive by default. */
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync, fsyncSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const origin = 'http://127.0.0.1:3001';
const actions = ['create', 'update', 'delete', 'googleMeet'];
const scopes = ['calendar.calendarlist.readonly', 'calendar.events.readonly', 'calendar.events.owned', 'calendar.events.freebusy'].map(scope => `https://www.googleapis.com/auth/${scope}`);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child) ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const etag = value => typeof value === 'string' && /^"[^"\r\n]+"$/.test(value);

export function parseCalendarFlags(args) {
  const flags = { mode: 'plan', step: '', runId: '', polls: 3, intervalMs: 2000 }; let selected = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (['--plan-only', '--verify', '--step', '--reconcile-step'].includes(flag)) {
      check(!selected, 'Choose one Calendar harness mode'); selected = true;
      flags.mode = flag === '--plan-only' ? 'plan' : flag === '--verify' ? 'verify' : flag === '--step' ? 'execute' : 'reconcile';
      if (flags.mode === 'execute' || flags.mode === 'reconcile') { flags.step = args[++index] ?? ''; check(['create', 'update', 'delete'].includes(flags.step), 'Choose create, update or delete'); }
    } else if (flag === '--run-id') flags.runId = args[++index] ?? '';
    else if (flag === '--polls' || flag === '--interval-ms') {
      const number = Number(args[++index]); check(Number.isInteger(number) && number >= (flag === '--polls' ? 1 : 0) && number <= (flag === '--polls' ? 5 : 5000), 'Invalid bounded polling option');
      flags[flag === '--polls' ? 'polls' : 'intervalMs'] = number;
    } else throw new Error('Unsupported Calendar harness option');
  }
  check(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(flags.runId), 'An explicit Calendar run ID is required');
  return flags;
}

export function calendarFixture(approval) {
  return {
    summary: `REA test — calendar + Meet — ${approval.runId}`,
    description: 'Synthetic integration test authorized by both participants. No action is needed. This event will be edited and cancelled.',
    start: approval.start, end: approval.end, attendees: [{ email: approval.attendees[0] }],
    visibility: 'private', transparency: 'transparent', conference: { provider: 'googleMeet' },
  };
}
export function createCalendarState(approval) { return { version: 1, runId: approval.runId, calendarId: approval.calendarId, approvalSha256: hash(canonical(approval)), fixture: calendarFixture(approval), operations: {}, steps: {} }; }
export function validateCalendarApproval(approval, runId, ready = true, approvedParticipants) {
  check(approval?.authorizedBy === 'user' && timestamp(approval.authorizedAt) && approval.runId === runId, 'The exact user authorization/run identity is required');
  const validEmail = value => typeof value === 'string' && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value) && value === value.toLowerCase();
  check(validEmail(approval.organizer) && Array.isArray(approval.attendees) && approval.attendees.length === 1 && validEmail(approval.attendees[0]) && approval.organizer !== approval.attendees[0] && approval.titlePrefix === 'REA test', 'Only the approved organizer and one attendee are allowed');
  check(Array.isArray(approvedParticipants) && approvedParticipants.length === 2 && approvedParticipants.every(validEmail) && equal([...approvedParticipants].sort(), [approval.organizer, approval.attendees[0]].sort()), 'Calendar roles must exactly match the separately approved private participant pair');
  check(equal([...approval.allowedActions ?? []].sort(), [...actions].sort()) && approval.invitationUpdatesApproved === true && approval.maxEvents === 1, 'Explicit single-event create, Meet, edit and cancellation authorization is required');
  check(approval.start?.timeZone === 'America/Los_Angeles' && approval.end?.timeZone === 'America/Los_Angeles', 'The approved explicit IANA zone is required');
  for (const value of [approval.start, approval.end]) check(typeof value?.dateTime === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/.test(value.dateTime), 'Explicit offset date-times are required');
  let start, end;
  try { [start, end] = [approval.start, approval.end].map(value => Temporal.ZonedDateTime.from(`${value.dateTime}[${value.timeZone}]`, { overflow: 'reject', offset: 'reject', disambiguation: 'reject' })); } catch { throw new Error('The approved date-time/zone is invalid or ambiguous'); }
  check(end.epochMilliseconds - start.epochMilliseconds === 300000, 'Only the approved five-minute event is permitted');
  if (!ready) return;
  check(typeof approval.calendarId === 'string' && approval.calendarId.length > 0 && approval.calendarId.length <= 1024 && !/[\r\n]/.test(approval.calendarId), 'The verified primary Calendar ID is required');
  const server = approval.serverApproval;
  check(server && timestamp(server.verifiedAt) && equal(server.accounts, [approval.organizer]) && equal(server.calendarIds, [approval.calendarId]) && equal(server.attendees, approval.attendees), 'Root must attest the exact deployed Calendar write allowlists before dispatch');
}

export function validateCalendarBoundary(approval, accounts, statuses, calendars) {
  const pair = [approval.organizer, approval.attendees[0]].map(email => {
    const found = accounts.filter(account => account.provider === 'google' && account.email === email); check(found.length === 1, 'Each approved Google identity must be connected exactly once'); return found[0];
  });
  for (const account of pair) {
    const status = statuses[account.id]; const grant = status?.grant;
    check(status?.enabled === true && status.configured === true && grant?.accountId === account.id && grant.service === 'calendar' && scopes.every(scope => grant.grantedScopes?.includes(scope)), 'Both accounts require the four explicitly approved Calendar service grants');
    check(['list', 'read', 'readOwned', 'writeOwned', 'freebusy'].every(capability => status.capabilities?.[capability] === true), 'Calendar capabilities do not match the approved grant');
  }
  check(statuses[pair[0].id].writesEnabled === true, 'Organizer Calendar writes are disabled');
  const matches = calendars.filter(calendar => calendar.id === approval.calendarId);
  check(matches.length === 1, 'The exact approved Calendar must appear once in the catalog'); const calendar = matches[0];
  check(calendar.accountId === pair[0].id && calendar.primary === true && calendar.accessRole === 'owner' && !calendar.deleted && calendar.allowedConferenceSolutionTypes?.includes('hangoutsMeet'), 'The destination must be the organizer primary owned Calendar with Meet support');
  return pair[0];
}

export function validateOwnedCalendarEvent(event, state, approval, expectedSummary) {
  const known = Object.values(state.operations).filter(operation => operation?.status === 'succeeded' && operation.kind !== 'delete').map(operation => operation.id);
  check(event?.id === state.eventId && event.accountId === state.accountId && event.calendarId === approval.calendarId && event.status === 'confirmed', 'The exact owned synthetic event identity is required');
  check(event.organizer?.email === approval.organizer && Array.isArray(event.attendees) && event.attendees.length === 1 && event.attendees[0].email === approval.attendees[0], 'The exact organizer and sole approved attendee must be unchanged');
  check(event.summary === expectedSummary && event.summary.startsWith(`${approval.titlePrefix} — `) && known.includes(event.extendedProperties?.private?.reaCalendarOperation), 'The owned synthetic title and confirmed operation marker must be unchanged');
  const expectedDescription = state.operations.update?.status === 'succeeded' ? `${state.fixture.description}\nEdit verified by the controlled test.` : state.fixture.description;
  check(event.description === expectedDescription && event.visibility === 'private' && event.transparency === 'transparent' && !event.location, 'Synthetic notes, privacy, availability and location must remain unchanged');
  check(etag(event.etag) && !event.recurrence?.length && !event.recurringEventId, 'A strong current ETag and nonrecurring owned event are required');
  for (const key of ['start', 'end']) check(event[key]?.timeZone === approval[key].timeZone && event[key]?.dateTime && Temporal.Instant.compare(Temporal.Instant.from(event[key].dateTime), Temporal.Instant.from(approval[key].dateTime)) === 0, 'The approved five-minute interval must be unchanged');
  return event;
}

function validateOperation(operation, state, approval, kind, payload, previous) {
  check(operation?.accountId === state.accountId && operation.calendarId === approval.calendarId && operation.kind === kind && typeof operation.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(operation.id), 'The durable operation identity does not match');
  check(typeof operation.eventId === 'string' && /^[0-9a-v]{5,1024}$/.test(operation.eventId) && (!state.eventId || operation.eventId === state.eventId), 'The operation must retain its one generated event ID');
  check(!previous || operation.id === previous.id, 'A different operation cannot replace the durable attempted ID');
  check(!previous || operation.conferenceRequestId === previous.conferenceRequestId, 'The durable Meet request identity must not change');
  check(canonical(operation.input ?? null) === canonical(payload ?? null), 'The durable operation payload changed');
  if (kind !== 'create') check(operation.etag === state.steps[kind].etag, 'The operation must retain the exact reviewed ETag');
  if (kind === 'create') check(typeof operation.conferenceRequestId === 'string' && operation.conferenceRequestId.length > 0, 'The Meet request identity must be durable before dispatch');
}

/** Request surface is local-only; no generic URL, provider token, auth or mail access. */
export function validateCalendarRequest(flags, path, method, state) {
  const url = new URL(path, origin); check(url.origin === origin && !url.username && !url.password && !url.hash && path.startsWith('/api/'), 'Only the fixed local API is allowed');
  if (method === 'GET' && url.pathname === '/api/accounts' && !url.search) return;
  const keys = [...url.searchParams.keys()];
  if (method === 'GET' && url.pathname === '/api/calendar/status' && equal(keys, ['accountId']) && state.connectedAccountIds?.includes(url.searchParams.get('accountId'))) return;
  if (method === 'GET' && url.pathname === '/api/calendar/calendars' && equal(keys, ['accountId']) && url.searchParams.get('accountId') === state.accountId) return;
  if (method === 'GET' && state.eventId && url.pathname === `/api/calendar/events/${encodeURIComponent(state.eventId)}` && equal([...keys].sort(), ['accountId', 'calendarId']) && url.searchParams.get('accountId') === state.accountId && url.searchParams.get('calendarId') === state.calendarId) return;
  const ids = Object.values(state.operations ?? {}).map(operation => operation?.id);
  if (method === 'GET' && !url.search && ids.some(id => url.pathname === `/api/calendar/operations/${encodeURIComponent(id)}`)) return;
  if (method === 'POST' && !url.search && flags.mode === 'execute' && url.pathname === '/api/calendar/operations') return;
  if (method === 'POST' && !url.search && ['execute', 'reconcile'].includes(flags.mode)) {
    const operation = state.operations?.[flags.step];
    if (operation && url.pathname === `/api/calendar/operations/${encodeURIComponent(operation.id)}/${flags.mode === 'execute' ? 'execute' : 'reconcile'}`) return;
  }
  throw new Error('The request is outside the explicit Calendar harness mode');
}

export async function runCalendarHarness({ flags, approval, approvedParticipants, state, persist, request, now = Date.now, sleep = milliseconds => new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds)) }) {
  validateCalendarApproval(approval, flags.runId, true, approvedParticipants); const fixture = calendarFixture(approval); const digest = hash(canonical(approval));
  check(state.version === 1 && state.runId === flags.runId && state.calendarId === approval.calendarId && state.approvalSha256 === digest && canonical(state.fixture) === canonical(fixture), 'The reviewed authorization and payload must remain unchanged');
  const query = accountId => new URLSearchParams({ accountId, calendarId: approval.calendarId });
  async function boundary() {
    const { accounts } = await request('/api/accounts'); check(Array.isArray(accounts), 'Connected account metadata is unavailable');
    const pair = [approval.organizer, approval.attendees[0]].map(email => { const matches = accounts.filter(item => item.email === email && item.provider === 'google'); check(matches.length === 1, 'Each approved account must be connected exactly once'); return matches[0]; });
    check(!state.accountId || state.accountId === pair[0].id, 'The organizer account identity changed'); state.accountId = pair[0].id; state.connectedAccountIds = pair.map(account => account.id); persist(state);
    const statuses = {};
    for (const email of [approval.organizer, approval.attendees[0]]) { const account = accounts.find(item => item.email === email && item.provider === 'google'); check(account, 'An approved account is missing'); statuses[account.id] = (await request(`/api/calendar/status?${new URLSearchParams({ accountId: account.id })}`)).calendar; }
    const account = accounts.find(item => item.email === approval.organizer && item.provider === 'google');
    const catalog = await request(`/api/calendar/calendars?${new URLSearchParams({ accountId: account.id })}`); const verified = validateCalendarBoundary(approval, accounts, statuses, catalog.calendars ?? []);
    check(!state.accountId || state.accountId === verified.id, 'The organizer account identity changed'); state.accountId = verified.id; persist(state); return verified;
  }
  const detail = () => request(`/api/calendar/events/${encodeURIComponent(state.eventId)}?${query(state.accountId)}`).then(value => value.event);
  const summary = state.operations.update?.status === 'succeeded' ? `${fixture.summary} (edited)` : fixture.summary;
  await boundary();
  if (flags.mode === 'plan') return { status: 'ready', fixture, update: { summary: `${fixture.summary} (edited)`, description: `${fixture.description}\nEdit verified by the controlled test.` }, writes: 0 };
  if (flags.mode === 'verify') {
    for (const kind of ['create', 'update', 'delete']) if (state.operations[kind]) { const saved = state.operations[kind]; const { operation } = await request(`/api/calendar/operations/${encodeURIComponent(saved.id)}`); validateOperation(operation, state, approval, kind, state.steps[kind].payload, saved); state.operations[kind] = operation; persist(state); }
    if (!state.eventId) return { status: 'not-created', writes: 0 };
    if (state.operations.delete?.status === 'succeeded') {
      let observation;
      try { const event = await detail(); check(event.id === state.eventId && event.status === 'cancelled', 'The acknowledged deletion still has an active or mismatched provider event'); observation = 'matching-cancelled-event'; }
      catch (error) { if (![404, 410].includes(error.status)) throw error; observation = error.status === 410 ? 'gone-410' : 'not-found-404-after-ack'; }
      state.cleanupVerification = { at: new Date(now()).toISOString(), cancellationAcknowledged: true, observation }; persist(state); return { status: 'cancelled', cancellationAcknowledged: true, observation, writes: 0 };
    }
    let event;
    for (let poll = 0; poll < flags.polls; poll++) { event = validateOwnedCalendarEvent(await detail(), state, approval, state.operations.update?.status === 'succeeded' ? `${fixture.summary} (edited)` : fixture.summary); state.lastVerification = { at: new Date(now()).toISOString(), meetingLink: event.meetingLink ?? null }; persist(state); if (event.meetingLink?.status !== 'pending' || poll === flags.polls - 1) break; await sleep(flags.intervalMs); }
    if (event.meetingLink?.status === 'success') { const uri = new URL(event.meetingLink.uri); check(uri.protocol === 'https:' && uri.hostname === 'meet.google.com' && !uri.username && !uri.password && uri.pathname.length > 1, 'A successful Meet link requires a validated Google Meet URI'); }
    return { status: 'verified', meetingStatus: event.meetingLink?.status ?? 'unknown', writes: 0 };
  }
  const kind = flags.step; const entry = state.steps[kind] ??= {};
  if (flags.mode === 'reconcile') {
    const operation = state.operations[kind]; check(operation && entry.executeAttemptedAt, 'Only a durable previously attempted operation can be reconciled');
    const current = (await request(`/api/calendar/operations/${encodeURIComponent(operation.id)}`)).operation; validateOperation(current, state, approval, kind, entry.payload, operation); state.operations[kind] = current; persist(state);
    if (current.status === 'succeeded') return { status: 'succeeded', writes: 0 };
    check(['unknown', 'dispatching'].includes(current.status), 'This operation is pending/preflight-failed; never dispatch it again from recovery');
    const result = await request(`/api/calendar/operations/${encodeURIComponent(operation.id)}/reconcile`, {}); validateOperation(result.operation, state, approval, kind, entry.payload, operation); state.operations[kind] = result.operation; persist(state); return { status: result.operation.status, resolved: result.resolved, writes: 0 };
  }
  check(flags.mode === 'execute', 'Unsupported Calendar harness mode');
  if (entry.executeAttemptedAt) {
    const saved = state.operations[kind]; check(saved, 'An attempted operation has no durable identity; manual review is required'); const current = (await request(`/api/calendar/operations/${encodeURIComponent(saved.id)}`)).operation; validateOperation(current, state, approval, kind, entry.payload, saved); state.operations[kind] = current; persist(state);
    return { status: current.status, dispatchedAgain: false, writes: 0 };
  }
  check(!entry.prepareAttemptedAt, 'A prior prepare response is unconfirmed; inspect it rather than making another operation');
  check(!Object.values(state.operations).some(operation => ['dispatching', 'unknown'].includes(operation.status)) && !Object.entries(state.steps).some(([name, step]) => step.executeAttemptedAt && !['succeeded', 'failed', 'conflict'].includes(state.operations[name]?.status) || step.prepareAttemptedAt && !state.operations[name]), 'An unresolved operation locks this entire synthetic lifecycle');
  if (kind === 'create') check(!state.eventId && !state.operations.create && Date.parse(approval.start.dateTime) > now() + 300000, 'Only one future synthetic event may be created');
  else {
    check(state.eventId && state.operations.create?.status === 'succeeded' && state.operations.delete?.status !== 'succeeded', 'A confirmed active event created by this run is required');
    if (kind === 'update') check(!state.operations.update, 'Only one approved edit is allowed');
    const event = validateOwnedCalendarEvent(await detail(), state, approval, summary); entry.etag = event.etag;
  }
  entry.payload = kind === 'create' ? fixture : kind === 'update' ? { summary: `${fixture.summary} (edited)`, description: `${fixture.description}\nEdit verified by the controlled test.` } : undefined;
  entry.prepareAttemptedAt = new Date(now()).toISOString(); persist(state);
  const { operation } = await request('/api/calendar/operations', { accountId: state.accountId, calendarId: approval.calendarId, kind, ...(kind === 'create' ? {} : { eventId: state.eventId, etag: entry.etag }), ...(entry.payload ? { event: entry.payload } : {}) });
  validateOperation(operation, state, approval, kind, entry.payload); check(operation.status === 'prepared', 'A fresh operation must be prepared'); state.operations[kind] = operation; state.eventId = operation.eventId; persist(state);
  await boundary();
  if (kind !== 'create') { const fresh = validateOwnedCalendarEvent(await detail(), state, approval, summary); check(fresh.etag === entry.etag, 'The event changed after review; do not execute this operation'); }
  entry.executeAttemptedAt = new Date(now()).toISOString(); persist(state);
  try { const result = await request(`/api/calendar/operations/${encodeURIComponent(operation.id)}/execute`, {}); validateOperation(result.operation, state, approval, kind, entry.payload, operation); state.operations[kind] = result.operation; persist(state); return { status: result.operation.status, writes: 1 }; }
  catch (error) { entry.error = { code: /^[a-z0-9_]+$/.test(error.code ?? '') ? error.code : 'request_failed', at: new Date(now()).toISOString() }; persist(state); throw new Error('The single Calendar dispatch was attempted. Preserve this run; use status/readonly reconciliation before any further write.'); }
}

function saveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${randomUUID()}.tmp`; const file = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); fsyncSync(file); } finally { closeSync(file); }
  renameSync(temporary, path);
  // Include newly created run/calendar directory entries in the durable journal.
  for (let directory = dirname(path), depth = 0; depth < 3; depth++, directory = dirname(directory)) { const descriptor = openSync(directory, 'r'); try { fsyncSync(descriptor); } finally { closeSync(descriptor); } }
}
async function main() {
  const flags = parseCalendarFlags(process.argv.slice(2)); const approval = JSON.parse(readFileSync(resolve(root, '.local/live-tests/calendar-approval.json'), 'utf8'));
  const participantApproval = JSON.parse(readFileSync(resolve(root, '.local/live-tests/approved-participants.json'), 'utf8')); check(participantApproval.authorizedBy === 'user', 'The separate private participant approval is required'); const approvedParticipants = participantApproval.participants;
  validateCalendarApproval(approval, flags.runId, flags.mode !== 'plan', approvedParticipants); const directory = resolve(root, '.local/live-tests/calendar', flags.runId); mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (flags.mode === 'plan' && (!approval.calendarId || !approval.serverApproval)) { const proposal = { runId: flags.runId, status: 'awaiting-verified-calendar-and-server-allowlists', fixture: calendarFixture(approval), providerCalls: 0, writes: 0 }; saveJson(resolve(directory, 'proposal.json'), proposal); console.log(JSON.stringify({ ...proposal, fixture: undefined, reportPath: resolve(directory, 'proposal.json') }, null, 2)); return; }
  validateCalendarApproval(approval, flags.runId, true, approvedParticipants); const lockPath = resolve(directory, 'run.lock'); const lock = openSync(lockPath, 'wx', 0o600); let state;
  try {
    writeFileSync(lock, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); fsyncSync(lock);
    const path = resolve(directory, 'state.json'); check(flags.mode === 'plan' || existsSync(path), 'Review a ready plan before any live Calendar operation');
    state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : createCalendarState(approval);
    const persist = value => saveJson(path, value);
    const request = async (route, body) => { const method = body === undefined ? 'GET' : 'POST'; validateCalendarRequest(flags, route, method, state); const response = await fetch(`${origin}${route}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000), redirect: 'error' }); const value = await response.json(); if (!response.ok) { const error = new Error('Local Calendar API request failed'); error.code = value.error?.code; error.status = response.status; throw error; } return value; };
    const result = await runCalendarHarness({ flags, approval, approvedParticipants, state, persist, request }); saveJson(resolve(directory, `report-${Date.now()}-${flags.mode}${flags.step ? `-${flags.step}` : ''}.json`), { runId: flags.runId, mode: flags.mode, step: flags.step, at: new Date().toISOString(), result });
    console.log(JSON.stringify({ runId: flags.runId, mode: flags.mode, step: flags.step || undefined, status: result.status, writes: result.writes, meetingStatus: result.meetingStatus, statePath: path }, null, 2));
  } finally { closeSync(lock); unlinkSync(lockPath); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Calendar harness refused or stopped. Preserve the private journal; never repeat an uncertain write or make a replacement run.'); process.exitCode = 1; });
