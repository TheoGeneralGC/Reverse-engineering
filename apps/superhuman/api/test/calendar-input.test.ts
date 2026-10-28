import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCalendarEventInput as event, normalizeCalendarRange as range, requireCalendarEtag } from '../src/calendar-input.ts';

const local = (dateTime: string, timeZone = 'America/Los_Angeles') => ({ dateTime, timeZone });
const timed = { start: local('2026-10-27T10:00'), end: local('2026-10-27T11:00') };
const create = { mode: 'create' as const }; const update = { mode: 'update' as const };
const invalidEvent = { status: 400, code: 'invalid_calendar_event' }; const invalidRange = { status: 400, code: 'invalid_calendar_range' };

test('all-day dates retain their calendar days and use an exclusive end across a DST change', () => {
  const result = event({ start: { date: '2026-03-08', timeZone: 'America/Los_Angeles' }, end: { date: '2026-03-09' } }, create);
  assert.deepEqual(result, { start: { date: '2026-03-08' }, end: { date: '2026-03-09' } });
  assert.deepEqual(event({ start: { date: '2028-02-29' }, end: { date: '2028-03-01' } }, create).start, { date: '2028-02-29' });
  for (const date of ['2026-02-29', '2026-02-30', '2026-13-01', '0000-01-01', '26-01-01', '2026-1-1']) assert.throws(() => event({ start: { date }, end: { date: '2027-01-01' } }, create), invalidEvent);
});

test('create and date updates require a matching positive start/end pair without rollover', () => {
  assert.throws(() => event({ summary: 'Synthetic event' }, create), invalidEvent);
  assert.throws(() => event({ start: timed.start }, update), invalidEvent);
  assert.throws(() => event({ end: timed.end }, update), invalidEvent);
  assert.throws(() => event({ start: { date: '2026-10-27' }, end: timed.end }, create), invalidEvent);
  for (const dates of [
    { start: { date: '2026-10-27' }, end: { date: '2026-10-27' } },
    { start: { date: '2026-10-28' }, end: { date: '2026-10-27' } },
    { start: timed.start, end: timed.start }, { start: timed.end, end: timed.start },
  ]) assert.throws(() => event(dates, create), invalidEvent);
  for (const dateTime of ['2026-10-27T24:00', '2026-10-27T10:60', '2026-10-27T10:00:60', '2026-02-30T10:00']) assert.throws(() => event({ start: local(dateTime), end: timed.end }, create), invalidEvent);
});

test('wall times use an explicit or calendar fallback IANA zone, independent of host timezone', () => {
  const result = event({ start: { dateTime: '2026-10-27T10:00' }, end: { dateTime: '2026-10-27T11:00' } }, { ...create, fallbackTimeZone: 'America/Los_Angeles' });
  assert.deepEqual(result.start, { dateTime: '2026-10-27T10:00:00-07:00', timeZone: 'America/Los_Angeles' });
  assert.deepEqual(result.end, { dateTime: '2026-10-27T11:00:00-07:00', timeZone: 'America/Los_Angeles' });
  assert.throws(() => event({ start: { dateTime: '2026-10-27T10:00' }, end: { dateTime: '2026-10-27T11:00' } }, create), invalidEvent);
  for (const timeZone of ['Invalid/Zone', '+02:00', '', 'UTC\r\nInjected: value']) assert.throws(() => event({ start: local('2026-10-27T10:00', timeZone), end: timed.end }, create), invalidEvent);
});

test('DST gaps and ambiguous wall times reject rather than silently shifting an appointment', () => {
  for (const start of ['2026-03-08T02:30', '2026-03-08T02:30:00-08:00', '2026-03-08T02:30:00-07:00']) assert.throws(() => event({ start: local(start), end: local('2026-03-08T04:00') }, create), invalidEvent);
  assert.throws(() => event({ start: local('2026-11-01T01:30'), end: local('2026-11-01T02:30') }, create), invalidEvent);
  const early = event({ start: local('2026-11-01T01:30:00-07:00'), end: local('2026-11-01T02:30:00-08:00') }, create);
  const late = event({ start: local('2026-11-01T01:30:00-08:00'), end: local('2026-11-01T02:30:00-08:00') }, create);
  assert.equal(Date.parse(early.end!.dateTime!) - Date.parse(early.start!.dateTime!), 2 * 3_600_000);
  assert.equal(Date.parse(late.end!.dateTime!) - Date.parse(late.start!.dateTime!), 3_600_000);
});

test('explicit zone offsets must agree; UTC instants convert to the chosen zone and travel retains distinct zones', () => {
  assert.throws(() => event({ start: local('2026-07-15T10:00:00-08:00'), end: local('2026-07-15T11:00:00-07:00') }, create), invalidEvent);
  const utc = event({ start: local('2026-07-15T17:00:00Z'), end: local('2026-07-15T18:00:00Z') }, create);
  assert.deepEqual(utc.start, { dateTime: '2026-07-15T10:00:00-07:00', timeZone: 'America/Los_Angeles' });
  const travel = event({ start: local('2026-07-15T23:00:00-04:00', 'America/New_York'), end: local('2026-07-15T21:30:00-07:00') }, create);
  assert.equal(Date.parse(travel.end!.dateTime!) - Date.parse(travel.start!.dateTime!), 90 * 60_000);
  const precise = event({ start: local('2026-10-27T10:00:00.000000001'), end: local('2026-10-27T10:00:00.000000002') }, create);
  assert.match(precise.start!.dateTime!, /\.000000001-07:00$/);
});

test('metadata-only updates preserve omission and reject provider-controlled fields or unsupported nested data', () => {
  const input = { summary: 'Synthetic title', description: '', location: 'Synthetic room' };
  assert.deepEqual(event(input, update), input); assert.equal('start' in event(input, update), false);
  for (const field of ['id', 'etag', 'status', 'organizer', 'extendedProperties', 'conferenceData', 'htmlLink']) assert.throws(() => event({ ...timed, [field]: 'provider-controlled' }, create), invalidEvent);
  assert.throws(() => event({ start: { ...timed.start, date: '2026-10-27' }, end: timed.end }, create), invalidEvent);
  assert.throws(() => event({ start: { ...timed.start, unsafe: true }, end: timed.end }, create), invalidEvent);
  for (const value of [null, [], {}, new Date(), { description: null }, { visibility: ['private'] }, { transparency: ['opaque'] }]) assert.throws(() => event(value, update), invalidEvent);
  assert.deepEqual(event({ description: '<p>Synthetic description</p>\nSecond line' }, update), { description: '<p>Synthetic description</p>\nSecond line' });
});

test('attendee input cannot smuggle RSVP/provider fields and rejects malformed or duplicate recipients', () => {
  const result = event({ ...timed, attendees: [{ email: ' attendee@example.test ', displayName: 'Synthetic Attendee', optional: true }] }, create);
  assert.deepEqual(result.attendees, [{ email: 'attendee@example.test', displayName: 'Synthetic Attendee', optional: true }]);
  assert.deepEqual(event({ attendees: [] }, update), { attendees: [] });
  for (const attendees of [
    [{ email: 'one@example.test' }, { email: 'ONE@example.test' }],
    [{ email: 'one@example.test\r\nBcc:other@example.test' }], [{ email: 'not-an-email' }],
    [{ email: 'one@example.test', responseStatus: 'accepted' }], [{ email: 'one@example.test', optional: 'true' }],
    Array.from({ length: 201 }, (_, index) => ({ email: `synthetic-${index}@example.test` })),
  ]) assert.throws(() => event({ attendees }, update), invalidEvent);
});

test('recurrence keeps property lines separate and disallows conflicting timed expansion zones', () => {
  const recurrence = ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5', 'EXDATE;TZID=America/Los_Angeles:20261102T100000'];
  assert.deepEqual(event({ ...timed, recurrence }, create).recurrence, recurrence);
  assert.deepEqual(event({ recurrence: [] }, update), { recurrence: [] });
  for (const recurrence of [['DTSTART:20261027T100000'], ['RRULE:FREQ=DAILY\r\nDTSTART:20261027T100000'], [123], 'RRULE:FREQ=DAILY']) assert.throws(() => event({ recurrence }, update), invalidEvent);
  assert.throws(() => event({ start: timed.start, end: local('2026-10-27T15:00', 'America/New_York'), recurrence: ['RRULE:FREQ=DAILY'] }, create), invalidEvent);
});

test('range bounds require exact instants, normalize UTC and enforce positive at-most-62-day spans', () => {
  assert.deepEqual(range({ timeMin: '2026-10-27T00:00:00-07:00', timeMax: '2026-10-28T00:00:00-07:00', timeZone: 'America/Los_Angeles' }), { timeMin: '2026-10-27T07:00:00Z', timeMax: '2026-10-28T07:00:00Z', timeZone: 'America/Los_Angeles' });
  assert.equal(range({ timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-03-04T00:00:00Z' }).timeZone, 'UTC');
  for (const value of [
    { timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-03-04T00:00:00.000000001Z' },
    { timeMin: '2026-10-27T10:00:00Z', timeMax: '2026-10-27T11:00:00+01:00' },
    { timeMin: '2026-10-28T00:00:00Z', timeMax: '2026-10-27T00:00:00Z' },
    { timeMin: '2026-10-27T00:00', timeMax: '2026-10-28T00:00Z' },
    { timeMin: '2026-10-27T00:00:00-00:00', timeMax: '2026-10-28T00:00Z' },
    { timeMin: '2026-10-27T00:00:60Z', timeMax: '2026-10-28T00:00Z' },
    { timeMin: '2026-10-27T00:00Z', timeMax: '2026-10-28T00:00Z', timeZone: '+03:00' },
    { timeMin: '2026-10-27T00:00Z', timeMax: '2026-10-28T00:00Z', q: 'unsupported' },
  ]) assert.throws(() => range(value), invalidRange);
});

test('writes require exactly one strong quoted ETag, never a wildcard, weak tag or injected header', () => {
  for (const value of [undefined, null, '']) assert.throws(() => requireCalendarEtag(value), { status: 428, code: 'calendar_etag_required' });
  for (const value of ['*', 'W/"synthetic"', 'synthetic', '"first", "second"', ' "synthetic" ', '"synthetic\r\nIf-Match: *"', '"tab\tvalue"', { etag: '"synthetic"' }]) assert.throws(() => requireCalendarEtag(value), { status: 400, code: 'invalid_calendar_etag' });
  assert.equal(requireCalendarEtag('"synthetic-version"'), '"synthetic-version"');
  assert.equal(requireCalendarEtag('""'), '""');
});

test('meeting creation accepts only an explicit Google Meet intent and cannot import custom conference data', () => {
  const marker = { provider: 'googleMeet' };
  const result = event({ ...timed, conference: marker }, create);
  assert.deepEqual(result.conference, marker); assert.notEqual(result.conference, marker); assert.equal('conferenceData' in result, false);
  assert.deepEqual(event({ conference: marker }, update), { conference: marker });
  assert.equal('conference' in event({ summary: 'Preserve existing conference' }, update), false);
  for (const conference of [null, 'googleMeet', {}, { provider: 'zoom' }, { provider: ['googleMeet'] }, { provider: 'googleMeet', requestId: 'caller-controlled' }, { provider: 'googleMeet', uri: 'https://untrusted.example.test' }, { provider: 'googleMeet', entryPoints: [] }]) assert.throws(() => event({ ...timed, conference }, create), invalidEvent);
  assert.throws(() => event({ ...timed, conferenceData: { createRequest: { requestId: 'caller-controlled' } } }, create), invalidEvent);
});
