import { Temporal } from '@js-temporal/polyfill';
import { HttpError } from './types.ts';
import type { CalendarAttendee, CalendarDateTime, CalendarEventInput, CalendarRange } from './calendar-types.ts';

type InputKind = 'event' | 'range';
const eventFields = ['summary', 'description', 'location', 'start', 'end', 'attendees', 'recurrence', 'transparency', 'visibility', 'colorId', 'conference'];
const fail = (kind: InputKind, message: string): never => { throw new HttpError(400, message, `invalid_calendar_${kind}`); };
function object(value: unknown, allowed: readonly string[], kind: InputKind): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail(kind, 'Expected a Calendar input object');
  if (Object.keys(value).some(key => !allowed.includes(key))) return fail(kind, 'Unsupported Calendar input field');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, kind: InputKind, multiline = false): string {
  if (typeof value !== 'string' || value.length > max || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) return fail(kind, 'Invalid Calendar text field');
  return value;
}
function zone(value: unknown, kind: InputKind): string {
  if (typeof value !== 'string' || !value || value.length > 128 || !/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(value)) return fail(kind, 'A valid IANA time zone is required');
  try { return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone; }
  catch { return fail(kind, 'A valid IANA time zone is required'); }
}
function plainDate(value: unknown, kind: InputKind): Temporal.PlainDate {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return fail(kind, 'Calendar dates must use YYYY-MM-DD');
  try { return Temporal.PlainDate.from(value, { overflow: 'reject' }); }
  catch { return fail(kind, 'Invalid Calendar date'); }
}
// Accept datetime-local values as well as explicit RFC3339 offsets. Never use
// the host time zone, normalize overflow, or silently pick a DST fold/gap.
function timestamp(value: unknown, kind: InputKind, requireOffset = false): string {
  if (typeof value !== 'string' || value.length > 80) return fail(kind, 'Invalid Calendar date-time');
  const parts = value.match(/^((?!0000)\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/);
  if (!parts || Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4] ?? 0) > 59 || parts[6] === '-00:00' || (requireOffset && !parts[6])) return fail(kind, 'Calendar date-time requires a valid time and explicit offset');
  plainDate(parts[1], kind);
  return `${parts[1]}T${parts[2]}:${parts[3]}:${parts[4] ?? '00'}${parts[5] ?? ''}${parts[6] ?? ''}`;
}
function dateTime(value: unknown, fallbackTimeZone: string | undefined): CalendarDateTime {
  const input = object(value, ['date', 'dateTime', 'timeZone'], 'event');
  if (('date' in input) === ('dateTime' in input)) return fail('event', 'Specify exactly one of date or dateTime');
  if ('date' in input) {
    const date = plainDate(input.date, 'event').toString();
    if (input.timeZone !== undefined) zone(input.timeZone, 'event');
    return { date }; // All-day dates have no time zone or UTC-midnight conversion.
  }
  const timeZone = zone(input.timeZone ?? fallbackTimeZone, 'event');
  const source = timestamp(input.dateTime, 'event');
  try {
    const zoned = Temporal.ZonedDateTime.from(`${source}[${timeZone}]`, { overflow: 'reject', disambiguation: 'reject', offset: 'reject' });
    return { dateTime: zoned.toString({ timeZoneName: 'never', calendarName: 'never' }), timeZone };
  } catch { return fail('event', 'Calendar time is invalid, ambiguous, or inconsistent with its time zone; supply a valid explicit offset'); }
}
function attendees(value: unknown): CalendarAttendee[] {
  if (!Array.isArray(value) || value.length > 200) return fail('event', 'Calendar attendees must be an array of at most 200 entries');
  const seen = new Set<string>();
  return value.map(item => {
    const input = object(item, ['email', 'displayName', 'optional'], 'event');
    const email = text(input.email, 320, 'event').trim();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || seen.has(email.toLowerCase())) return fail('event', 'Calendar attendee emails must be valid and unique');
    seen.add(email.toLowerCase());
    const result: CalendarAttendee = { email };
    if (input.displayName !== undefined) result.displayName = text(input.displayName, 1024, 'event');
    if (input.optional !== undefined) { if (typeof input.optional !== 'boolean') return fail('event', 'Calendar attendee optional must be a boolean'); result.optional = input.optional; }
    return result;
  });
}
function recurrence(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32) return fail('event', 'Calendar recurrence must be an array of at most 32 rules');
  return value.map(item => {
    const line = text(item, 4096, 'event');
    // Google performs full RFC5545 semantic validation. Keep property lines
    // separate and prevent embedded DTSTART/DTEND or additional header lines.
    if (!/^(?:RRULE|EXRULE):[A-Z0-9=,;+\-]+$/.test(line) && !/^(?:RDATE|EXDATE)(?:;[A-Z]+=[A-Za-z0-9_+./-]+)*:[0-9TZ,+\-]+$/.test(line)) return fail('event', 'Unsupported Calendar recurrence property');
    return line;
  });
}

export function normalizeCalendarEventInput(raw: unknown, options: { mode: 'create' | 'update'; fallbackTimeZone?: string }): CalendarEventInput {
  const input = object(raw, eventFields, 'event');
  const result: CalendarEventInput = {};
  if (!Object.keys(input).length) return fail('event', 'Calendar event input is empty');
  for (const [key, max, multiline] of [['summary', 2048, false], ['description', 100_000, true], ['location', 8192, false]] as const) if (input[key] !== undefined) result[key] = text(input[key], max, 'event', multiline);
  const hasStart = 'start' in input; const hasEnd = 'end' in input;
  if (hasStart !== hasEnd || (options.mode === 'create' && !hasStart)) return fail('event', 'Calendar events require both start and exclusive end');
  if (hasStart) {
    result.start = dateTime(input.start, options.fallbackTimeZone); result.end = dateTime(input.end, options.fallbackTimeZone);
    if (('date' in result.start) !== ('date' in result.end)) return fail('event', 'Calendar start and end must both be all-day or timed');
    if ('date' in result.start && 'date' in result.end) {
      if (Temporal.PlainDate.compare(result.start.date!, result.end.date!) >= 0) return fail('event', 'Calendar exclusive end must be after start');
    } else if ('dateTime' in result.start && 'dateTime' in result.end) {
      if (Temporal.Instant.compare(result.start.dateTime!, result.end.dateTime!) >= 0) return fail('event', 'Calendar exclusive end must be after start');
    }
  }
  if (input.attendees !== undefined) result.attendees = attendees(input.attendees);
  if (input.recurrence !== undefined) result.recurrence = recurrence(input.recurrence);
  if (result.recurrence?.length && result.start && result.end && 'dateTime' in result.start && 'dateTime' in result.end && result.start.timeZone !== result.end.timeZone) return fail('event', 'Recurring Calendar events require one time zone');
  if (input.transparency !== undefined) { if (typeof input.transparency !== 'string' || !['opaque', 'transparent'].includes(input.transparency)) return fail('event', 'Invalid Calendar transparency'); result.transparency = input.transparency as CalendarEventInput['transparency']; }
  if (input.visibility !== undefined) { if (typeof input.visibility !== 'string' || !['default', 'public', 'private'].includes(input.visibility)) return fail('event', 'Invalid Calendar visibility'); result.visibility = input.visibility as CalendarEventInput['visibility']; }
  if (input.colorId !== undefined) { const color = text(input.colorId, 64, 'event'); if (!/^[A-Za-z0-9_-]+$/.test(color)) return fail('event', 'Invalid Calendar color'); result.colorId = color; }
  if (input.conference !== undefined) {
    const conference = object(input.conference, ['provider'], 'event');
    if (conference.provider !== 'googleMeet') return fail('event', 'Only a new Google Meet request is supported');
    // This is an application intent marker, never a Google conference payload.
    // The provider owns request IDs and constructs conferenceData separately.
    result.conference = { provider: 'googleMeet' };
  }
  if (!Object.keys(result).length) return fail('event', 'Calendar event input is empty');
  return result;
}

export function normalizeCalendarRange(raw: { timeMin: unknown; timeMax: unknown; timeZone?: unknown }): CalendarRange {
  const input = object(raw, ['timeMin', 'timeMax', 'timeZone'], 'range');
  const timeZone = zone(input.timeZone ?? 'UTC', 'range');
  try {
    const start = Temporal.Instant.from(timestamp(input.timeMin, 'range', true));
    const end = Temporal.Instant.from(timestamp(input.timeMax, 'range', true));
    const span = end.epochNanoseconds - start.epochNanoseconds;
    if (span <= 0n || span > 62n * 24n * 60n * 60n * 1_000_000_000n) return fail('range', 'Calendar range must be positive and no longer than 62 elapsed days');
    return { timeMin: start.toString(), timeMax: end.toString(), timeZone };
  } catch (error) { if (error instanceof HttpError) throw error; return fail('range', 'Invalid Calendar range date-time'); }
}

export function requireCalendarEtag(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') throw new HttpError(428, 'A current strong Calendar event ETag is required', 'calendar_etag_required');
  if (typeof raw !== 'string' || raw.length > 1024 || !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(raw)) throw new HttpError(400, 'A single strong quoted Calendar event ETag is required', 'invalid_calendar_etag');
  return raw;
}
