import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import { transformWithOxc } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCalendarModel, type CalendarJournal } from '../src/calendar/model.ts';
import { layoutWeek } from '../src/calendar/time.ts';
import type { CalendarCatalog, CalendarEvent, CalendarEventInput, CalendarOperation, CalendarRangeResult, CalendarRequest } from '../src/calendar/types.ts';

const accountId = 'google:synthetic-calendar@example.test', calendarId = 'synthetic-calendar@example.test';
const timestamp = '2026-10-27T12:00:00Z';
const rawEvent = (extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ accountId, calendarId, id: 'synthetic-event', status: 'confirmed', etag: '"v1"', summary: 'Original title', description: 'Original description', location: 'Original room', start: { dateTime: '2026-10-28T10:00:30.123-07:00', timeZone: 'America/Los_Angeles' }, end: { dateTime: '2026-10-28T14:00:45.456-04:00', timeZone: 'America/New_York' }, attendees: [{ email: 'guest@example.test', displayName: 'Synthetic Guest', optional: true, responseStatus: 'accepted' }], ...extra });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(options: { writable?: boolean } = {}) {
  const catalog: CalendarCatalog = { calendars: [{ accountId, id: calendarId, summary: 'Synthetic owned calendar', accessRole: 'owner', selected: true, primary: true, timeZone: 'America/Los_Angeles', updatedAt: timestamp }], sync: { phase: 'incremental', partial: false }, providerStatus: { enabled: true, configured: true, grant: {}, capabilities: { list: true, read: true, readOwned: true, writeOwned: true, freebusy: true }, writesEnabled: options.writable !== false, liveVerified: false } };
  const saved = new Map<string, { id: string; attempted: boolean }>(); const journal: CalendarJournal = { read: account => saved.get(account) ?? null, write: (account, value) => { saved.set(account, value); return true; }, clear: account => { saved.delete(account); } };
  const requests: { path: string; body: unknown; method?: string }[] = []; const operations = new Map<string, CalendarOperation>(); const prepared: Record<string, unknown>[] = [];
  let detail = rawEvent(); let detailHook: (() => Promise<CalendarEvent>) | undefined; let executeHook: ((operation: CalendarOperation) => Promise<CalendarOperation>) | undefined; let rangeHook: ((result: CalendarRangeResult) => CalendarRangeResult) | undefined; let operationHook: ((id: string) => CalendarOperation) | undefined;
  const request = (async (path: string, body?: unknown, method?: string) => {
    requests.push({ path, body, method });
    if (path.startsWith('/calendar/calendars?')) return catalog;
    if (path.startsWith('/calendar/events?')) {
      const query = new URL(path, 'https://synthetic.example.test').searchParams;
      const result: CalendarRangeResult = { calendarId, range: { timeMin: query.get('timeMin')!, timeMax: query.get('timeMax')!, timeZone: query.get('timeZone')! }, events: [], cache: { key: 'synthetic-range', partial: false, updatedAt: timestamp, expiresAt: '2099-01-01T00:00:00Z' } };
      return rangeHook ? rangeHook(result) : result;
    }
    if (path.startsWith('/calendar/events/')) return { event: detailHook ? await detailHook() : detail };
    if (path === '/calendar/operations') {
      const input = body as Record<string, unknown>; prepared.push(input);
      const operation: CalendarOperation = { id: `synthetic-operation-${prepared.length}`, accountId, calendarId, kind: input.kind as CalendarOperation['kind'], eventId: input.kind === 'create' ? `synthetic-created-${prepared.length}` : String(input.eventId), etag: input.etag as string | undefined, input: input.event as CalendarEventInput, status: 'prepared', createdAt: timestamp, updatedAt: timestamp };
      operations.set(operation.id, operation); return { operation };
    }
    const match = path.match(/^\/calendar\/operations\/([^/]+)(?:\/(execute|reconcile))?$/);
    if (match) {
      const id = decodeURIComponent(match[1]); const operation = operations.get(id); if (!operation) throw new Error('Synthetic operation unavailable');
      if (match[2] === 'execute') { const result = executeHook ? await executeHook(operation) : { ...operation, status: 'succeeded' as const }; operations.set(id, result); return { operation: result }; }
      return { operation: operationHook ? operationHook(id) : operation };
    }
    throw new Error('Unexpected request in synthetic Calendar model audit');
  }) as CalendarRequest;
  const models: ReturnType<typeof createCalendarModel>[] = [];
  const mount = () => { const model = createCalendarModel({ accountId, timeZone: 'America/Los_Angeles', date: '2026-10-27', now: () => new Date(timestamp), request, journal, onChange: () => {} }); models.push(model); return model; };
  const model = mount();
  return { model, mount, catalog, journal, saved, requests, operations, prepared, setDetail: (value: CalendarEvent) => { detail = value; detailHook = undefined; }, holdDetail: (value: Promise<CalendarEvent>) => { detailHook = () => value; }, onExecute: (value: typeof executeHook) => { executeHook = value; }, onRange: (value: typeof rangeHook) => { rangeHook = value; }, onOperation: (value: typeof operationHook) => { operationHook = value; }, close: () => { for (const model of models) model.dispose(); } };
}

test('a late event GET cannot replace a newer created and edited draft', async () => {
  const f = fixture(); try {
    await f.model.initialize(); const held = deferred<CalendarEvent>(); f.holdDetail(held.promise);
    const opening = f.model.open(rawEvent()); f.model.create(); f.model.updateDraft({ summary: 'New unsaved title' }); const key = f.model.getSnapshot().editor!.draft.key;
    held.resolve(rawEvent()); await opening;
    assert.equal(f.model.getSnapshot().editor!.draft.key, key); assert.equal(f.model.getSnapshot().editor!.draft.kind, 'create'); assert.equal(f.model.getSnapshot().editor!.draft.summary, 'New unsaved title');
  } finally { f.close(); }
});

test('canceling a pending detail GET prevents a late response from reopening the editor', async () => {
  const f = fixture(); try {
    await f.model.initialize(); const held = deferred<CalendarEvent>(); f.holdDetail(held.promise); const opening = f.model.open(rawEvent());
    assert.equal(f.model.getSnapshot().detailLoading, true); f.model.cancel(); held.resolve(rawEvent()); await opening;
    assert.equal(f.model.getSnapshot().detailLoading, false); assert.equal(f.model.getSnapshot().editor, null);
  } finally { f.close(); }
});

test('a title-only update preserves exact remote timestamps, end zone and attendee metadata by omitting untouched fields', async () => {
  const f = fixture(); try {
    await f.model.initialize(); await f.model.open(rawEvent()); f.model.startEditing(); f.model.updateDraft({ summary: 'Only my title changed' }); await f.model.save('update');
    const event = f.prepared[0].event as Record<string, unknown>; assert.equal(event.summary, 'Only my title changed');
    for (const field of ['start', 'end', 'attendees', 'recurrence', 'location', 'description']) assert.equal(Object.hasOwn(event, field), false, field);
  } finally { f.close(); }
});

test('conflict reload refreshes untouched fields, preserves user edits and sends the latest ETag without clobbering concurrent changes', async () => {
  const f = fixture(); try {
    await f.model.initialize(); await f.model.open(rawEvent()); f.model.startEditing(); f.model.updateDraft({ summary: 'My edited title' });
    f.onExecute(async operation => ({ ...operation, status: 'conflict', error: 'Synthetic concurrent edit' })); await f.model.save('update'); assert.equal(f.model.getSnapshot().editor!.phase, 'conflict');
    f.setDetail(rawEvent({ etag: '"v2"', location: 'New remote room', description: 'New remote description' })); await f.model.reloadConflict();
    const draft = f.model.getSnapshot().editor!.draft; assert.equal(draft.summary, 'My edited title'); assert.equal(draft.location, 'New remote room'); assert.equal(draft.description, 'New remote description'); assert.equal(draft.etag, '"v2"');
    f.onExecute(undefined); await f.model.save('update'); const prepared = f.prepared.at(-1)!; assert.equal(prepared.etag, '"v2"'); assert.deepEqual(prepared.event, { summary: 'My edited title' });
  } finally { f.close(); }
});

test('an unknown operation survives disposal and range changes with its exact operation locked against duplicate dispatch', async () => {
  const f = fixture(); const held = deferred<CalendarOperation>(); const entered = deferred<void>(); try {
    const first = f.model; await first.initialize(); first.create(); first.updateDraft({ summary: 'Synthetic uncertain event' });
    f.onExecute(async operation => { f.operations.set(operation.id, { ...operation, status: 'unknown' }); entered.resolve(); return held.promise; }); const saving = first.save(); await entered.promise;
    const saved = f.journal.read(accountId)!; assert.equal(saved.attempted, true); first.dispose(); const second = f.mount(); await second.initialize();
    const key = second.getSnapshot().editor!.draft.key; assert.equal(second.getSnapshot().editor!.phase, 'unknown');
    second.setDate('2026-11-10'); second.setTimeZone('America/New_York'); second.toggleCalendar(calendarId); second.create(); second.updateDraft({ summary: 'Must stay locked' }); await second.save(); assert.equal(second.cancel(), false);
    assert.equal(second.getSnapshot().editor!.operation!.id, saved.id); assert.equal(second.getSnapshot().editor!.draft.key, key); assert.equal(second.getSnapshot().editor!.draft.summary, 'Synthetic uncertain event'); assert.equal(f.prepared.length, 1); assert.equal(f.requests.filter(item => item.path.endsWith('/execute')).length, 1);
    held.reject(new TypeError('Synthetic lost dispatch response')); await saving; assert.equal(f.journal.read(accountId)!.id, saved.id);
  } finally { held.reject(new Error('Synthetic fixture cleanup')); f.close(); }
});

test('restoring an operation rejects a different same-account identity and preserves the unresolved journal', async () => {
  const f = fixture(); try {
    const original: CalendarOperation = { id: 'journal-operation', accountId, calendarId, kind: 'create', eventId: 'uncertain-created', input: { summary: 'Synthetic pending event', start: rawEvent().start!, end: rawEvent().end! }, status: 'unknown', createdAt: timestamp, updatedAt: timestamp };
    f.operations.set(original.id, original); f.journal.write(accountId, { id: original.id, attempted: true }); f.onOperation(() => ({ ...original, id: 'wrong-operation', status: 'succeeded' }));
    await f.model.initialize(); assert.equal(f.journal.read(accountId)!.id, original.id); assert.equal(f.model.getSnapshot().editor, null); assert.match(f.model.getSnapshot().error, /unconfirmed|identity|different|match/i);
    f.model.create(); await f.model.save(); assert.equal(f.prepared.length, 0);
  } finally { f.close(); }
});

test('restoring a failed metadata-only update preserves its identity and input without turning it into event creation', async () => {
  const f = fixture(); try {
    const original: CalendarOperation = { id: 'partial-update-operation', accountId, calendarId, kind: 'update', eventId: 'synthetic-event', etag: '"v1"', input: { summary: 'My pending edited title' }, status: 'failed', error: 'Synthetic confirmed preflight failure', createdAt: timestamp, updatedAt: timestamp };
    f.operations.set(original.id, original); f.journal.write(accountId, { id: original.id, attempted: true });
    await f.model.initialize(); const restored = f.model.getSnapshot().editor!.draft;
    assert.equal(restored.kind, 'update'); assert.equal(restored.eventId, original.eventId); assert.equal(restored.summary, 'My pending edited title');
    await f.model.save(); assert.equal(f.prepared.some(item => item.kind === 'create'), false);
  } finally { f.close(); }
});

test('range response identity includes its requested week, and read-only event details never prepare writes', async () => {
  const f = fixture({ writable: false }); try {
    f.onRange(result => ({ ...result, range: { ...result.range, timeMin: '2027-01-01T00:00:00Z' }, events: [rawEvent()] })); await f.model.initialize();
    assert.deepEqual(f.model.getSnapshot().ranges[calendarId].events, []); assert.match(f.model.getSnapshot().ranges[calendarId].error, /identity|range|match/i);
    await f.model.open(rawEvent()); const before = f.model.getSnapshot().editor!.draft.summary; f.model.updateDraft({ summary: 'Forbidden read-only edit' }); await f.model.save('update');
    assert.equal(f.model.getSnapshot().editor!.draft.summary, before); assert.equal(f.prepared.length, 0);
  } finally { f.close(); }
});

test('all-day end dates stay exclusive across week boundaries and the fall daylight transition', () => {
  const event = rawEvent({ start: { date: '2026-10-30' }, end: { date: '2026-11-02' }, attendees: [] });
  const before = layoutWeek([event], '2026-10-27', 'America/Los_Angeles'); assert.deepEqual(before.allDay.map(item => ({ day: item.day, span: item.span })), [{ day: 5, span: 2 }]);
  const after = layoutWeek([event], '2026-11-01', 'America/Los_Angeles'); assert.deepEqual(after.allDay.map(item => ({ day: item.day, span: item.span })), [{ day: 0, span: 1 }]); assert.deepEqual(after.invalid, []);
});

const compiled = new Map<string, string>();
await Promise.all(['../src/calendar/CalendarEventCard.tsx', '../src/calendar/RepeatDialog.tsx', '../src/Icon.tsx'].map(async relative => {
  const url = new URL(relative, import.meta.url), path = fileURLToPath(url);
  compiled.set(url.href, (await transformWithOxc(readFileSync(path, 'utf8'), path, { jsx: { runtime: 'automatic' } })).code);
}));
const hook = registerHooks({ load(url, context, next) { const source = compiled.get(url); return source === undefined ? next(url, context) : { format: 'module', shortCircuit: true, source }; } });
const { default: CalendarEventCard } = await import('../src/calendar/CalendarEventCard.tsx'); hook.deregister();

test('an unknown delete from event details renders its error and a usable read-only status check', async () => {
  const f = fixture(); try {
    await f.model.initialize(); await f.model.open(rawEvent()); assert.equal(f.model.getSnapshot().editor!.viewing, true);
    f.onExecute(async operation => ({ ...operation, status: 'unknown', errorCode: 'calendar_delivery_unknown', error: 'Synthetic event change is unconfirmed' })); await f.model.save('delete');
    const editor = f.model.getSnapshot().editor!; assert.equal(editor.phase, 'unknown');
    const html = renderToStaticMarkup(createElement(CalendarEventCard, { editor, calendars: f.catalog.calendars, model: f.model, displayZone: 'America/Los_Angeles', now: () => new Date(timestamp) }));
    assert.match(html, /Synthetic event change is unconfirmed/); assert.match(html, /Check event status/);
  } finally { f.close(); }
});
