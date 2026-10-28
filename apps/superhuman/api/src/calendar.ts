import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Temporal } from '@js-temporal/polyfill';
import { Store } from './store.ts';
import { GoogleProvider } from './google.ts';
import { CalendarStore } from './calendar-store.ts';
import { calendarCapabilities, CALENDAR_REQUEST_SCOPES } from './google-scopes.ts';
import { OperationQueue } from './operation-queue.ts';
import { normalizeCalendarEventInput, normalizeCalendarRange, requireCalendarEtag } from './calendar-input.ts';
import { HttpError, type Account } from './types.ts';
import type { CalendarDateTime, CalendarEvent, CalendarEventInput, CalendarMetadata, CalendarOperation, CalendarRangeResult, CalendarFreeBusy, CalendarSyncState, CalendarMeetingLink } from './calendar-types.ts';

type Capability = keyof ReturnType<typeof calendarCapabilities>;
type Page = { items?: Record<string, unknown>[]; nextPageToken?: string; nextSyncToken?: string; timeZone?: string };
type Timing = { now: () => number; sleep: (milliseconds: number) => Promise<void>; random: () => number };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown) => typeof value === 'string' ? value : undefined;
const encoded = (value: string) => encodeURIComponent(value);
const list = (value?: string) => (value ?? '').split(',').map(item => item.trim()).filter(Boolean);
function providerInstant(value: unknown): number | undefined { if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return undefined; try { return Temporal.Instant.from(value).epochMilliseconds; } catch { return undefined; } }
const safeReasons = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded', 'accessNotConfigured', 'insufficientPermissions', 'forbidden', 'notFound', 'backendError', 'conditionNotMet']);
export class CalendarRequestError extends HttpError {
  readonly ambiguous: boolean; readonly retryAfterMs: number;
  constructor(status: number, message: string, code: string, ambiguous = false, retryAfterMs = 0) { super(status, message, code); this.ambiguous = ambiguous; this.retryAfterMs = retryAfterMs; }
}
export class GoogleCalendarProvider {
  readonly repository: CalendarStore;
  readonly operations = new OperationQueue();
  readonly jobs = new Map<string, Promise<unknown>>();
  readonly syncRequests = new Map<string, Promise<unknown>>();
  readonly readTails = new Map<string, Promise<void>>();
  readonly readStarts = new Map<string, number>();
  readonly timing: Timing;
  private closing = false;
  readonly store: Store; readonly google: GoogleProvider; readonly env: NodeJS.ProcessEnv; readonly fetcher: typeof fetch;
  constructor(store: Store, google: GoogleProvider, env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = google.fetcher, timing: Partial<Timing> = {}) { this.store = store; this.google = google; this.env = env; this.fetcher = fetcher; this.repository = new CalendarStore(store.db); this.timing = { now: Date.now, sleep, random: Math.random, ...timing }; }
  capabilities(accountId: string) { return calendarCapabilities(this.google.grant(accountId, 'calendar')?.grantedScopes ?? []); }
  status(accountId?: string) {
    const enabled = this.env.GOOGLE_CALENDAR_ENABLED === 'true'; const base = this.google.status();
    const account = accountId ? this.store.get<Account>('account', accountId) : undefined; const capabilities = accountId ? this.capabilities(accountId) : calendarCapabilities([]); const approvedCalendars = list(this.env.APPROVED_CALENDAR_TEST_IDS);
    const writesEnabled = enabled && base.configured && !!account && capabilities.writeOwned && list(this.env.APPROVED_CALENDAR_TEST_ACCOUNTS).map(value => value.toLowerCase()).includes(account.email.toLowerCase()) && this.repository.calendars(account.id).some(calendar => calendar.accessRole === 'owner' && approvedCalendars.includes(calendar.id));
    return { provider: 'google-calendar', implemented: true, liveVerified: false, enabled, configured: enabled && base.configured, missing: [...(!enabled ? ['GOOGLE_CALENDAR_ENABLED'] : []), ...base.missing], requestedScopes: CALENDAR_REQUEST_SCOPES, grant: accountId ? this.google.grant(accountId, 'calendar') ?? null : null, authAttempt: accountId ? this.store.get('googleOAuthAttempt', `calendar:${accountId}`) ?? null : null, capabilities, writesEnabled, limitations: ['Calendar API activation and additional consent require explicit setup. Existing Gmail grants are unchanged.', 'Writes are restricted to owned test calendars and explicitly approved attendees. Shared-calendar editing, booking pages, Zoom and replacing existing conferences are not implemented.', 'Visible ranges are fetched separately from canonical sync; polling is used without push channels. Google Meet links are created asynchronously only when explicitly requested.'] };
  }
  syncStatus(accountId: string, calendarId = '*') { const state = this.repository.state(accountId, calendarId, calendarId === '*' ? 'list' : 'events'); const { syncToken: _sync, pageToken: _page, generation: _generation, ...status } = state; return status; }
  private backoff(accountId: string) { const value = this.store.get<{ until: string }>('calendarBackoff', accountId); if (value && Date.parse(value.until) > this.timing.now()) throw new HttpError(429, 'Calendar requests are waiting for provider backoff', 'calendar_retry_pending'); }
  private trackedSync<T>(accountId: string, calendarId: string, kind: 'list' | 'events', action: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([accountId, calendarId, kind]); const existing = this.syncRequests.get(key); if (existing) return existing as Promise<T>;
    this.backoff(accountId);
    const previous = this.repository.state(accountId, calendarId, kind);
    if (previous.nextSyncAt && Date.parse(previous.nextSyncAt) > this.timing.now() && ['calendar_rate_limited', 'calendar_daily_quota_exceeded'].includes(previous.errorCode ?? '')) return Promise.reject(new HttpError(429, 'Calendar synchronization is waiting for provider backoff', 'calendar_sync_retry_pending'));
    const promise = action().catch(error => {
      const state = this.repository.state(accountId, calendarId, kind); const attempts = Math.min((state.failureCount ?? 0) + 1, 30); const retry = error instanceof CalendarRequestError ? error.retryAfterMs : 0; const requiresReconnect = error instanceof HttpError && [401, 403].includes(error.status);
      this.repository.saveState(accountId, calendarId, kind, { ...state, failureCount: attempts, errorCode: error instanceof HttpError ? error.code : 'calendar_sync_failed', error: error instanceof HttpError ? error.message : 'Calendar synchronization failed', requiresReconnect, ...(!requiresReconnect ? { nextSyncAt: new Date(this.timing.now() + Math.max(retry, Math.min(30_000 * 2 ** Math.min(attempts - 1, 5), 15 * 60_000), error instanceof HttpError && error.code === 'calendar_daily_quota_exceeded' ? 24 * 60 * 60_000 : 0)).toISOString() } : { nextSyncAt: undefined }) }); throw error;
    }).finally(() => this.syncRequests.delete(key)); this.syncRequests.set(key, promise); return promise;
  }
  private ready(accountId: string, capability: Capability) {
    if (this.closing) throw new HttpError(503, 'Calendar service is shutting down', 'calendar_closing');
    const status = this.status(accountId); if (!status.configured) throw new HttpError(503, 'Calendar integration requires setup and explicit consent', 'calendar_setup_required');
    const account = this.store.required<Account>('account', accountId); if (account.provider !== 'google') throw new HttpError(400, 'Demo accounts do not connect to Google Calendar', 'calendar_account_required');
    if (!this.capabilities(accountId)[capability]) throw new HttpError(403, 'This Calendar capability was not granted; existing Gmail access is unchanged', 'calendar_scope_required');
    return account;
  }
  private calendar(accountId: string, calendarId: string) { const calendar = this.repository.calendar(accountId, calendarId); if (!calendar || calendar.deleted || calendar.accessRole === 'none') throw new HttpError(404, 'Calendar is unavailable; synchronize the calendar list first', 'calendar_not_found'); return calendar; }
  private readCapability(calendar: CalendarMetadata): Capability { if (!['reader', 'writer', 'writerWithoutPrivateAccess', 'owner'].includes(calendar.accessRole)) throw new HttpError(403, 'This calendar grants availability access only', 'calendar_events_not_visible'); return calendar.accessRole === 'owner' && !this.capabilities(calendar.accountId).read ? 'readOwned' : 'read'; }
  private async pace(accountId: string) {
    const previous = this.readTails.get(accountId) ?? Promise.resolve();
    const turn = previous.then(async () => { const rate = Number(this.env.CALENDAR_READS_PER_MINUTE ?? 60); const interval = 60_000 / (Number.isFinite(rate) && rate >= 1 && rate <= 300 ? rate : 60); const delay = Math.max(0, (this.readStarts.get(accountId) ?? 0) - this.timing.now()); if (delay) await this.timing.sleep(delay); this.readStarts.set(accountId, this.timing.now() + interval); });
    const tail = turn.catch(() => {}); this.readTails.set(accountId, tail); void tail.then(() => { if (this.readTails.get(accountId) === tail) this.readTails.delete(accountId); }); await turn;
  }
  async request(accountId: string, path: string, options: RequestInit = {}, capability: Capability = 'read'): Promise<unknown> {
    this.ready(accountId, capability); this.backoff(accountId); const token = await this.google.tokens(accountId, 'calendar'); this.ready(accountId, capability); this.backoff(accountId);
    const method = (options.method ?? 'GET').toUpperCase(); const attempts = method === 'GET' ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (method === 'GET') await this.pace(accountId);
      let response: Response;
      try { response = await this.fetcher(`https://www.googleapis.com/calendar/v3/${path}`, { ...options, signal: AbortSignal.timeout(20_000), headers: { 'content-type': 'application/json', ...options.headers, authorization: `Bearer ${token.access_token}` } }); }
      catch { if (method === 'GET' && attempt < attempts - 1) { await this.timing.sleep(500 * 2 ** attempt); continue; } throw new CalendarRequestError(502, 'Calendar transport failed; the outcome could not be confirmed', 'calendar_transport_failed', method !== 'GET'); }
      if (response.ok) { if (response.status === 204) return null; try { return await response.json(); } catch { throw new CalendarRequestError(502, 'Calendar returned an invalid response', 'calendar_invalid_response', method !== 'GET'); } }
      let details: Record<string, unknown> = {}; try { details = object((await response.json() as { error?: unknown }).error); } catch { /* Never expose raw response text. */ }
      const reasons = Array.isArray(details.errors) ? details.errors.map(value => str(object(value).reason)).filter((value): value is string => !!value && safeReasons.has(value)) : [];
      const retryHeader = response.headers.get('retry-after'); const retryAfterMs = retryHeader ? /^\d+$/.test(retryHeader) ? Number(retryHeader) * 1000 : Math.max(0, Date.parse(retryHeader) - this.timing.now()) : 0;
      const rateLimited = response.status === 429 || reasons.some(reason => ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded'].includes(reason)); const retryable = rateLimited || response.status >= 500;
      if (method === 'GET' && retryable && attempt < attempts - 1 && (!retryAfterMs || retryAfterMs <= 5000)) { await this.timing.sleep(Math.max(retryAfterMs || 0, 500 * 2 ** attempt + Math.floor(this.timing.random() * 250))); continue; }
      const code = response.status === 410 ? /\/events\/[^/?]+(?:\?|$)/.test(path) ? 'calendar_event_gone' : 'calendar_sync_expired' : response.status === 412 ? 'calendar_etag_conflict' : response.status === 404 ? 'calendar_not_found' : response.status === 401 ? 'calendar_reconnect_required' : reasons.includes('accessNotConfigured') ? 'calendar_api_not_enabled' : reasons.includes('dailyLimitExceeded') ? 'calendar_daily_quota_exceeded' : rateLimited ? 'calendar_rate_limited' : response.status === 403 ? 'calendar_permission_denied' : 'calendar_request_failed';
      if (rateLimited || code === 'calendar_daily_quota_exceeded') this.store.put('calendarBackoff', accountId, { until: new Date(this.timing.now() + Math.max(Number.isFinite(retryAfterMs) ? retryAfterMs : 0, code === 'calendar_daily_quota_exceeded' ? 24 * 60 * 60_000 : 30_000)).toISOString(), code });
      throw new CalendarRequestError(rateLimited || code === 'calendar_daily_quota_exceeded' ? 429 : response.status >= 500 ? 502 : response.status, code === 'calendar_etag_conflict' ? 'The event changed; reload it before editing' : 'Google Calendar rejected the request; check setup, access or retry status', code, method !== 'GET' && (response.status >= 500 || response.status === 408 || response.status === 409), Number.isFinite(retryAfterMs) ? retryAfterMs : 0);
    }
    throw new HttpError(502, 'Calendar request did not complete', 'calendar_request_failed');
  }
  private normalizeCalendar(accountId: string, raw: Record<string, unknown>): CalendarMetadata {
    if (typeof raw.id !== 'string' || !raw.id) throw new HttpError(502, 'Invalid Calendar metadata', 'calendar_invalid_response');
    const role = ['freeBusyReader', 'reader', 'writer', 'writerWithoutPrivateAccess', 'owner'].includes(String(raw.accessRole)) ? raw.accessRole as CalendarMetadata['accessRole'] : 'none';
    const conferenceTypes = object(raw.conferenceProperties).allowedConferenceSolutionTypes;
    return { accountId, id: raw.id, summary: str(raw.summary) ?? '', description: str(raw.description), timeZone: str(raw.timeZone), etag: str(raw.etag), accessRole: raw.deleted ? 'none' : role, primary: raw.primary === true, selected: raw.selected === true, hidden: raw.hidden === true, deleted: raw.deleted === true, backgroundColor: str(raw.backgroundColor), foregroundColor: str(raw.foregroundColor), colorId: str(raw.colorId), allowedConferenceSolutionTypes: Array.isArray(conferenceTypes) ? conferenceTypes.filter((value): value is string => typeof value === 'string') : undefined, updatedAt: new Date(this.timing.now()).toISOString() };
  }
  private meetingLink(raw: Record<string, unknown>): CalendarMeetingLink | undefined {
    const conference = object(raw.conferenceData); const request = object(conference.createRequest); const solution = object(object(conference.conferenceSolution).key).type ?? object(request.conferenceSolutionKey).type;
    const points = Array.isArray(conference.entryPoints) ? conference.entryPoints.map(object) : []; const candidate = str(points.find(point => point.entryPointType === 'video')?.uri) ?? str(raw.hangoutLink); let uri: string | undefined;
    if (candidate) try { const url = new URL(candidate); if (url.protocol === 'https:' && url.hostname === 'meet.google.com' && !url.username && !url.password) uri = url.toString(); } catch { /* Untrusted provider URLs are never promoted to a meeting action. */ }
    if (solution !== 'hangoutsMeet' && !uri) return undefined; const status = object(request.status).statusCode;
    return { provider: 'googleMeet', status: status === 'failure' ? 'failure' : status === 'pending' ? 'pending' : uri ? 'success' : 'unknown', requestId: str(request.requestId), ...(status === 'pending' || status === 'failure' ? {} : { uri }) };
  }
  private normalizeEvent(accountId: string, calendarId: string, raw: Record<string, unknown>, timeZone = 'UTC'): CalendarEvent {
    if (typeof raw.id !== 'string' || !raw.id) throw new HttpError(502, 'Invalid Calendar event', 'calendar_invalid_response');
    const time = (value: unknown): CalendarDateTime | undefined => {
      if (value === undefined) return undefined; const item = object(value);
      try {
        if (typeof item.date === 'string' && item.dateTime === undefined && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(item.date)) return { date: Temporal.PlainDate.from(item.date, { overflow: 'reject' }).toString() };
        if (typeof item.dateTime === 'string' && item.date === undefined && providerInstant(item.dateTime) !== undefined) { const zone = str(item.timeZone) ?? timeZone; if (!/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(zone)) throw new Error(); const canonical = new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone; return { dateTime: item.dateTime, timeZone: canonical }; }
      } catch { /* Convert malformed provider data into an explicit read failure. */ }
      throw new HttpError(502, 'Calendar returned an invalid event time', 'calendar_invalid_response');
    };
    if (raw.status === 'cancelled') return { accountId, calendarId, id: raw.id, status: 'cancelled', etag: str(raw.etag), recurringEventId: str(raw.recurringEventId), originalStartTime: time(raw.originalStartTime) };
    const start = time(raw.start); const end = time(raw.end); if (!start || !end || !!start.date !== !!end.date || (start.date && end.date ? Temporal.PlainDate.compare(start.date, end.date) >= 0 : Temporal.Instant.compare(start.dateTime!, end.dateTime!) >= 0)) throw new HttpError(502, 'Calendar returned an invalid start/end pair', 'calendar_invalid_response');
    return { accountId, calendarId, id: raw.id, status: raw.status === 'tentative' ? 'tentative' : 'confirmed', etag: str(raw.etag), summary: str(raw.summary), description: str(raw.description), location: str(raw.location), start: time(raw.start), end: time(raw.end), attendees: Array.isArray(raw.attendees) ? raw.attendees.map(item => object(item)).filter(item => typeof item.email === 'string').map(item => ({ email: String(item.email), displayName: str(item.displayName), optional: item.optional === true, responseStatus: str(item.responseStatus), self: item.self === true, organizer: item.organizer === true })) : undefined, organizer: raw.organizer as CalendarEvent['organizer'], creator: raw.creator as CalendarEvent['creator'], recurrence: Array.isArray(raw.recurrence) ? raw.recurrence.filter((value): value is string => typeof value === 'string') : undefined, recurringEventId: str(raw.recurringEventId), originalStartTime: time(raw.originalStartTime), transparency: str(raw.transparency), visibility: str(raw.visibility), htmlLink: str(raw.htmlLink), hangoutLink: str(raw.hangoutLink), conferenceData: raw.conferenceData, meetingLink: this.meetingLink(raw), colorId: str(raw.colorId), updated: str(raw.updated), extendedProperties: raw.extendedProperties as CalendarEvent['extendedProperties'] };
  }
  private page(raw: unknown): Page { const value = object(raw); if ((value.items !== undefined && !Array.isArray(value.items)) || (value.nextPageToken !== undefined && typeof value.nextPageToken !== 'string') || (value.nextSyncToken !== undefined && typeof value.nextSyncToken !== 'string')) throw new HttpError(502, 'Invalid Calendar page response', 'calendar_invalid_response'); return value as Page; }
  async syncCalendarList(accountId: string) {
    return this.trackedSync(accountId, '*', 'list', () => this.operations.run(accountId, async () => {
      this.ready(accountId, 'list'); let state = this.repository.state(accountId, '*', 'list'); const now = this.timing.now();
      // CalendarList incremental tokens omit some ACL/read-only property
      // changes; periodically refresh the whole list to revalidate roles.
      if (!state.pageToken && state.phase === 'incremental' && (!state.lastFullSyncAt || now - Date.parse(state.lastFullSyncAt) >= 6 * 60 * 60_000)) state = { phase: 'initial', partial: true, generation: randomUUID() };
      if (!state.generation) state.generation = randomUUID();
      const query = new URLSearchParams({ maxResults: '100', showDeleted: 'true', showHidden: 'true', ...(state.syncToken ? { syncToken: state.syncToken } : {}), ...(state.pageToken ? { pageToken: state.pageToken } : {}) });
      let page: Page;
      try { page = this.page(await this.request(accountId, `users/me/calendarList?${query}`, {}, 'list')); }
      catch (error) { if (error instanceof CalendarRequestError && error.status === 410) { this.repository.transaction(() => { for (const calendar of this.repository.calendars(accountId, true)) this.repository.saveCalendar({ accountId, id: calendar.id, summary: '', accessRole: 'none', deleted: true, updatedAt: new Date(now).toISOString() }); this.repository.saveState(accountId, '*', 'list', { phase: 'initial', partial: true, generation: randomUUID(), resetReason: 'sync_token_expired', nextSyncAt: new Date(now).toISOString() }); }); return { imported: 0, partial: true, reset: true }; } throw error; }
      if (!page.nextPageToken && !page.nextSyncToken) throw new HttpError(502, 'Calendar list omitted its final sync token', 'calendar_invalid_response');
      const calendars = (page.items ?? []).map(raw => this.normalizeCalendar(accountId, raw)); const completedAt = new Date(now).toISOString();
      const next: CalendarSyncState = { ...state, phase: page.nextPageToken ? state.phase : 'incremental', pageToken: page.nextPageToken, syncToken: page.nextPageToken ? state.syncToken : page.nextSyncToken, partial: !!page.nextPageToken, updatedAt: completedAt, lastCompletedAt: page.nextPageToken ? state.lastCompletedAt : completedAt, lastFullSyncAt: !page.nextPageToken && state.phase === 'initial' ? completedAt : state.lastFullSyncAt, nextSyncAt: new Date(now + (page.nextPageToken ? 1500 : 5 * 60_000)).toISOString(), failureCount: 0, requiresReconnect: false, error: undefined, errorCode: undefined };
      this.repository.transaction(() => { for (const calendar of calendars) this.repository.saveCalendar(calendar, state.generation); if (!page.nextPageToken && state.phase === 'initial') this.repository.reconcileCalendarGeneration(accountId, state.generation!, completedAt); this.repository.saveState(accountId, '*', 'list', next); });
      return { imported: calendars.length, partial: next.partial, phase: next.phase };
    }));
  }
  async syncEvents(accountId: string, calendarId: string) {
    return this.trackedSync(accountId, calendarId, 'events', () => this.operations.run(accountId, async () => {
      const calendar = this.calendar(accountId, calendarId); const capability = this.readCapability(calendar); this.ready(accountId, capability);
      const state = this.repository.state(accountId, calendarId, 'events'); const now = this.timing.now();
      const query = new URLSearchParams({ maxResults: '100', singleEvents: 'false', showDeleted: 'true', ...(state.syncToken ? { syncToken: state.syncToken } : {}), ...(state.pageToken ? { pageToken: state.pageToken } : {}) });
      let page: Page; try { page = this.page(await this.request(accountId, `calendars/${encoded(calendarId)}/events?${query}`, {}, capability)); }
      catch (error) { if (error instanceof CalendarRequestError && error.status === 410) { this.repository.transaction(() => { this.repository.clearEvents(accountId, calendarId); this.repository.saveState(accountId, calendarId, 'events', { phase: 'initial', partial: true, resetReason: 'sync_token_expired', nextSyncAt: new Date(now).toISOString() }); }); return { imported: 0, partial: true, reset: true }; } throw error; }
      if (!page.nextPageToken && !page.nextSyncToken) throw new HttpError(502, 'Calendar events omitted their final sync token', 'calendar_invalid_response');
      const events = (page.items ?? []).map(raw => this.normalizeEvent(accountId, calendarId, raw, calendar.timeZone)); const timestamp = new Date(now).toISOString();
      const next: CalendarSyncState = { ...state, phase: page.nextPageToken ? state.phase : 'incremental', pageToken: page.nextPageToken, syncToken: page.nextPageToken ? state.syncToken : page.nextSyncToken, partial: !!page.nextPageToken, updatedAt: timestamp, lastCompletedAt: page.nextPageToken ? state.lastCompletedAt : timestamp, lastFullSyncAt: !page.nextPageToken && state.phase === 'initial' ? timestamp : state.lastFullSyncAt, nextSyncAt: new Date(now + (page.nextPageToken ? 1500 : 30_000)).toISOString(), failureCount: 0, requiresReconnect: false, error: undefined, errorCode: undefined };
      this.repository.transaction(() => { for (const event of events) this.repository.saveEvent(event); if (events.length) this.repository.invalidateRanges(accountId, calendarId); this.repository.saveState(accountId, calendarId, 'events', next); });
      return { imported: events.length, partial: next.partial, phase: next.phase };
    }));
  }
  async visibleRange(accountId: string, calendarId: string, raw: { timeMin: unknown; timeMax: unknown; timeZone?: unknown }, refresh = false): Promise<CalendarRangeResult> {
    const range = normalizeCalendarRange(raw); const key = createHash('sha256').update(JSON.stringify(range)).digest('hex');
    return this.operations.run(accountId, async () => {
      const calendar = this.calendar(accountId, calendarId); const capability = this.readCapability(calendar); this.ready(accountId, capability); const now = this.timing.now();
      let cached = this.repository.range(accountId, calendarId, key); if (refresh || (cached && Date.parse(cached.cache.expiresAt) <= now)) cached = undefined;
      if (cached && !cached.cache.partial) { const { nextPageToken: _token, pageCount: _pages, ...result } = cached; return result; }
      if ((cached?.pageCount ?? 0) >= 20) throw new HttpError(413, 'This range is too dense; choose a smaller date range', 'calendar_range_too_dense');
      const query = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', showDeleted: 'false', maxResults: '100', ...range, ...(cached?.nextPageToken ? { pageToken: cached.nextPageToken } : {}) });
      const page = this.page(await this.request(accountId, `calendars/${encoded(calendarId)}/events?${query}`, {}, capability));
      const events = new Map((cached?.events ?? []).map(event => [event.id, event])); for (const rawEvent of page.items ?? []) { const event = this.normalizeEvent(accountId, calendarId, rawEvent, calendar.timeZone); if (event.status === 'cancelled') events.delete(event.id); else events.set(event.id, event); }
      if (events.size > 2000) throw new HttpError(413, 'This range is too dense; choose a smaller date range', 'calendar_range_too_dense');
      const startInstant = (event: CalendarEvent) => { try { return event.start?.dateTime ? Temporal.Instant.from(event.start.dateTime).epochMilliseconds : Temporal.PlainDate.from(event.start!.date!).toZonedDateTime({ timeZone: calendar.timeZone ?? range.timeZone, plainTime: '00:00' }).epochMilliseconds; } catch { throw new HttpError(502, 'Calendar returned an invalid event time', 'calendar_invalid_response'); } };
      const next = { calendarId, range, events: [...events.values()].sort((left, right) => startInstant(left) - startInstant(right) || left.id.localeCompare(right.id)), cache: { key, partial: !!page.nextPageToken, updatedAt: new Date(now).toISOString(), expiresAt: page.nextPageToken ? cached?.cache.expiresAt ?? new Date(now + 10 * 60_000).toISOString() : new Date(now + 60_000).toISOString() }, nextPageToken: page.nextPageToken, pageCount: (cached?.pageCount ?? 0) + 1 };
      this.repository.saveRange(accountId, calendarId, next, now); const { nextPageToken: _token, pageCount: _pages, ...result } = next; return result;
    });
  }
  async getEvent(accountId: string, calendarId: string, eventId: string) {
    if (!eventId || eventId.length > 1024 || /[\r\n]/.test(eventId)) throw new HttpError(400, 'eventId is required', 'invalid_calendar_event');
    return this.operations.run(accountId, async () => { const calendar = this.calendar(accountId, calendarId); const capability = this.readCapability(calendar); this.ready(accountId, capability); const raw = object(await this.request(accountId, `calendars/${encoded(calendarId)}/events/${encoded(eventId)}`, {}, capability)); if (raw.id !== eventId) throw new HttpError(502, 'Calendar returned an unexpected event identity', 'calendar_invalid_response'); return this.normalizeEvent(accountId, calendarId, raw, calendar.timeZone); });
  }
  async freeBusy(accountId: string, raw: { timeMin: unknown; timeMax: unknown; timeZone?: unknown; items: unknown }): Promise<CalendarFreeBusy> {
    const range = normalizeCalendarRange({ timeMin: raw.timeMin, timeMax: raw.timeMax, timeZone: raw.timeZone }); if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 50 || raw.items.some(item => typeof item !== 'string' || !item || item.length > 1024 || /[\r\n]/.test(item))) throw new HttpError(400, 'Choose 1–50 calendar IDs for availability', 'invalid_calendar_freebusy');
    const ids = [...new Set(raw.items as string[])]; const response = object(await this.request(accountId, 'freeBusy', { method: 'POST', body: JSON.stringify({ ...range, items: ids.map(id => ({ id })), groupExpansionMax: 100, calendarExpansionMax: 50 }) }, 'freebusy')); const calendars = object(response.calendars); const groups = object(response.groups);
    const errors = (value: unknown) => value === undefined ? [] : Array.isArray(value) ? value.map(item => { const reason = str(object(item).reason); return reason && ['groupTooBig', 'tooManyCalendarsRequested', 'notFound', 'internalError', 'forbidden'].includes(reason) ? reason : 'unknownError'; }) : ['unknownError'];
    const result: CalendarFreeBusy = { timeMin: range.timeMin, timeMax: range.timeMax, calendars: Object.create(null), groups: Object.create(null), complete: true };
    const calendarIds = new Set(Object.keys(calendars));
    for (const [id, value] of Object.entries(groups)) { const group = object(value); const failures = errors(group.errors); const members = Array.isArray(group.calendars) && group.calendars.every(item => typeof item === 'string') ? group.calendars as string[] : undefined; if (!members && !failures.length) failures.push('availabilityUnknown'); result.groups[id] = { errors: failures, calendarIds: members }; if (failures.length) result.complete = false; for (const member of members ?? []) calendarIds.add(member); }
    for (const id of ids) if (!Object.hasOwn(groups, id)) calendarIds.add(id);
    const boundsKnown = providerInstant(response.timeMin) !== undefined && providerInstant(response.timeMax) !== undefined && providerInstant(response.timeMin) === providerInstant(range.timeMin) && providerInstant(response.timeMax) === providerInstant(range.timeMax);
    if (!boundsKnown) result.complete = false;
    for (const id of calendarIds) {
      const value = object(calendars[id]); const failures = errors(value.errors); const busy = Array.isArray(value.busy) ? value.busy.map(item => object(item)) : undefined;
      if (!boundsKnown || !Object.hasOwn(calendars, id) || failures.length || !busy || busy.some(item => providerInstant(item.start) === undefined || providerInstant(item.end) === undefined || providerInstant(item.end)! <= providerInstant(item.start)!)) { result.calendars[id] = { status: 'unknown', errors: failures.length ? failures : ['availabilityUnknown'] }; result.complete = false; }
      else result.calendars[id] = { status: 'known', busy: busy.map(item => ({ start: String(item.start), end: String(item.end) })) };
    }
    return result;
  }
  private approveWrite(accountId: string, calendarId: string, input?: CalendarEventInput) {
    const account = this.ready(accountId, 'writeOwned'); this.backoff(accountId); const calendar = this.calendar(accountId, calendarId);
    if (calendar.accessRole !== 'owner') throw new HttpError(403, 'Only owned calendars may be changed by this implementation', 'calendar_owned_write_required');
    if (input?.conference && calendar.allowedConferenceSolutionTypes && !calendar.allowedConferenceSolutionTypes.includes('hangoutsMeet')) throw new HttpError(403, 'This calendar does not support Google Meet creation', 'calendar_meet_unavailable');
    if (!list(this.env.APPROVED_CALENDAR_TEST_ACCOUNTS).map(value => value.toLowerCase()).includes(account.email.toLowerCase()) || !list(this.env.APPROVED_CALENDAR_TEST_IDS).includes(calendarId)) throw new HttpError(403, 'This account and calendar have not been explicitly approved for test writes', 'calendar_test_write_disabled');
    if ((input?.attendees?.length ?? 0) > 20) throw new HttpError(400, 'Test Calendar writes allow at most 20 attendees', 'invalid_calendar_event');
    const approved = list(this.env.APPROVED_CALENDAR_TEST_ATTENDEES).map(value => value.toLowerCase()); if (input?.attendees?.some(attendee => !approved.includes(attendee.email.toLowerCase()))) throw new HttpError(403, 'Every Calendar attendee must be explicitly approved', 'calendar_attendee_not_approved'); return { account, calendar };
  }
  prepareOperation(raw: { accountId: string; calendarId: string; kind: unknown; eventId?: unknown; etag?: unknown; event?: unknown }) {
    if (typeof raw.kind !== 'string' || !['create', 'update', 'delete'].includes(raw.kind)) throw new HttpError(400, 'Invalid Calendar operation', 'invalid_calendar_operation'); const kind = raw.kind as CalendarOperation['kind'];
    const input = kind === 'delete' ? undefined : normalizeCalendarEventInput(raw.event, { mode: kind, fallbackTimeZone: this.calendar(raw.accountId, raw.calendarId).timeZone }); this.approveWrite(raw.accountId, raw.calendarId, input);
    if (kind !== 'create' && (typeof raw.eventId !== 'string' || !raw.eventId || raw.eventId.length > 1024 || /[\r\n]/.test(raw.eventId))) throw new HttpError(400, 'eventId is required', 'invalid_calendar_operation');
    if (kind !== 'create' && this.repository.pendingEventOperation(raw.accountId, raw.calendarId, String(raw.eventId))) throw new HttpError(409, 'Reconcile the prior operation for this event before changing it again', 'calendar_operation_locked');
    const now = new Date(this.timing.now()).toISOString(); const operation: CalendarOperation = { id: randomUUID(), accountId: raw.accountId, calendarId: raw.calendarId, kind, eventId: kind === 'create' ? randomBytes(16).toString('hex') : String(raw.eventId), etag: kind === 'create' ? undefined : requireCalendarEtag(raw.etag), input, conferenceRequestId: input?.conference ? randomUUID() : undefined, status: 'prepared', createdAt: now, updatedAt: now };
    return this.repository.saveOperation(operation);
  }
  operation(id: string) { const value = this.repository.operation(id); if (!value) throw new HttpError(404, 'Calendar operation was not found', 'not_found'); return value; }
  async executeOperation(id: string) {
    const selected = this.operation(id); return this.operations.run(selected.accountId, async () => {
      let operation = this.operation(id); if (operation.status === 'succeeded') return operation; if (operation.status !== 'prepared') throw new HttpError(409, 'This operation cannot be dispatched again; reconcile an unknown result', 'calendar_operation_locked');
      if (this.repository.pendingEventOperation(operation.accountId, operation.calendarId, operation.eventId, operation.id)) throw new HttpError(409, 'Reconcile the prior operation for this event before changing it again', 'calendar_operation_locked');
      const { account, calendar } = this.approveWrite(operation.accountId, operation.calendarId, operation.input); let payload: Record<string, unknown> = { ...operation.input }; delete payload.conference; let dispatched = false;
      try {
        if (operation.kind !== 'create') {
          const current = object(await this.request(operation.accountId, `calendars/${encoded(operation.calendarId)}/events/${encoded(operation.eventId)}`, {}, this.readCapability(calendar)));
          if (current.id !== operation.eventId || current.etag !== operation.etag) throw new CalendarRequestError(412, 'The event changed; reload it before editing', 'calendar_etag_conflict');
          if (operation.kind === 'update' && current.eventLabelId) throw new HttpError(409, 'Editing events with versioned Calendar labels is not implemented; the event remains unchanged', 'calendar_event_labels_unsupported');
          if (current.attendeesOmitted === true || (Array.isArray(current.attendees) && current.attendees.length > 20)) throw new HttpError(403, 'All existing attendees must be visible and approved before this event can change', 'calendar_attendee_not_approved');
          const organizer = str(object(current.organizer).email); if (organizer && organizer.toLowerCase() !== account.email.toLowerCase()) throw new HttpError(403, 'Editing events organized by another account is not implemented', 'calendar_external_organizer_unsupported');
          this.approveWrite(operation.accountId, operation.calendarId, { attendees: Array.isArray(current.attendees) ? current.attendees.map(value => ({ email: String(object(value).email ?? '') })) : [] });
          if (operation.conferenceRequestId && Object.keys(object(current.conferenceData)).length) { const conference = object(current.conferenceData); const status = object(object(conference.createRequest).status).statusCode; if (conference.conferenceId || Array.isArray(conference.entryPoints) && conference.entryPoints.length || status === 'pending' || status === 'success') throw new HttpError(409, 'Replacing an existing meeting link is not implemented', 'calendar_meeting_link_exists'); }
          payload = { ...current, ...payload };
          if (operation.input?.attendees) { const existing = new Map((Array.isArray(current.attendees) ? current.attendees : []).map(value => object(value)).map(value => [String(value.email).toLowerCase(), value])); payload.attendees = operation.input.attendees.map(attendee => ({ ...existing.get(attendee.email.toLowerCase()), ...attendee })); }
        } else payload.id = operation.eventId;
        if (operation.conferenceRequestId) payload.conferenceData = { createRequest: { requestId: operation.conferenceRequestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
        if (operation.kind !== 'delete') { const existing = object(payload.extendedProperties); payload.extendedProperties = { ...existing, private: { ...object(existing.private), reaCalendarOperation: operation.id } }; }
        operation = this.repository.saveOperation({ ...operation, status: 'dispatching', updatedAt: new Date(this.timing.now()).toISOString() }); dispatched = true;
        const path = `calendars/${encoded(operation.calendarId)}/events${operation.kind === 'create' ? '' : `/${encoded(operation.eventId)}`}?sendUpdates=${Array.isArray(payload.attendees) && payload.attendees.length ? 'all' : 'none'}${operation.kind === 'delete' ? '' : '&conferenceDataVersion=1'}`;
        const raw = await this.request(operation.accountId, path, { method: operation.kind === 'create' ? 'POST' : operation.kind === 'update' ? 'PUT' : 'DELETE', headers: operation.etag ? { 'if-match': operation.etag } : {}, ...(operation.kind !== 'delete' ? { body: JSON.stringify(payload) } : {}) }, 'writeOwned');
        const result: CalendarEvent = operation.kind === 'delete' ? { accountId: operation.accountId, calendarId: operation.calendarId, id: operation.eventId, status: 'cancelled' as const } : this.normalizeEvent(operation.accountId, operation.calendarId, object(raw), calendar.timeZone);
        if (operation.conferenceRequestId && !result.meetingLink) result.meetingLink = { provider: 'googleMeet', status: 'unknown', requestId: operation.conferenceRequestId };
        if (result.id !== operation.eventId) throw new CalendarRequestError(502, 'Calendar returned an unexpected event identity', 'calendar_invalid_response', true);
        this.repository.transaction(() => { this.repository.saveEvent(result); this.repository.invalidateRanges(operation.accountId, operation.calendarId); operation = this.repository.saveOperation({ ...operation, status: 'succeeded', result, updatedAt: new Date(this.timing.now()).toISOString() }); }); return operation;
      } catch (error) {
        const ambiguous = dispatched && (!(error instanceof CalendarRequestError) || error.ambiguous); const conflict = error instanceof HttpError && error.status === 412;
        this.repository.saveOperation({ ...operation, status: ambiguous ? 'unknown' : conflict ? 'conflict' : 'failed', errorCode: ambiguous ? 'calendar_delivery_unknown' : error instanceof HttpError ? error.code : 'calendar_operation_failed', error: ambiguous ? 'The write outcome is unknown; use read-only reconciliation. It will never be automatically retried.' : error instanceof HttpError ? error.message : 'Calendar operation failed', updatedAt: new Date(this.timing.now()).toISOString() });
        if (ambiguous) throw new HttpError(409, 'Calendar write outcome is unknown; reconcile before any further write', 'calendar_delivery_unknown'); throw error;
      }
    });
  }
  async reconcileOperation(id: string) {
    const selected = this.operation(id); return this.operations.run(selected.accountId, async () => {
      let operation = this.operation(id); if (operation.status === 'succeeded') return { resolved: true, operation }; if (!['unknown', 'dispatching'].includes(operation.status)) throw new HttpError(409, 'Only unknown operations require reconciliation', 'calendar_operation_locked');
      const calendar = this.calendar(operation.accountId, operation.calendarId); let raw: Record<string, unknown> | undefined; let confirmedGone = false;
      try { raw = object(await this.request(operation.accountId, `calendars/${encoded(operation.calendarId)}/events/${encoded(operation.eventId)}`, {}, this.readCapability(calendar))); }
      catch (error) { if (!(error instanceof CalendarRequestError && [404, 410].includes(error.status))) throw error; confirmedGone = error.status === 410; }
      // A 404 can also mean lost Calendar access; absence alone is not proof
      // that an uncertain delete succeeded. Keep it unknown without a receipt.
      const resolved = operation.kind === 'delete' ? confirmedGone || raw?.id === operation.eventId && raw.status === 'cancelled' : raw?.id === operation.eventId && object(object(raw.extendedProperties).private).reaCalendarOperation === operation.id;
      if (resolved) { const result = raw ? this.normalizeEvent(operation.accountId, operation.calendarId, raw, calendar.timeZone) : { accountId: operation.accountId, calendarId: operation.calendarId, id: operation.eventId, status: 'cancelled' as const }; this.repository.transaction(() => { this.repository.saveEvent(result); this.repository.invalidateRanges(operation.accountId, operation.calendarId); operation = this.repository.saveOperation({ ...operation, status: 'succeeded', result, error: undefined, errorCode: undefined, updatedAt: new Date(this.timing.now()).toISOString() }); }); }
      return { resolved, operation };
    });
  }
  runJobs(now = this.timing.now()) {
    if (this.closing || !this.status().configured) return 0; let launched = 0;
    for (const account of this.store.list<Account>('account')) {
      if (account.provider !== 'google' || this.jobs.has(account.id) || !this.capabilities(account.id).list) continue;
      try { this.backoff(account.id); } catch { continue; }
      const due = (state: CalendarSyncState) => !state.requiresReconnect && (!state.nextSyncAt || Date.parse(state.nextSyncAt) <= now);
      const listState = this.repository.state(account.id, '*', 'list'); if (['calendar_api_not_enabled', 'calendar_reconnect_required'].includes(listState.errorCode ?? '')) continue; let calendarId = '*'; let kind: 'list' | 'events' = 'list';
      if (!due(listState)) { const selected = this.repository.calendars(account.id).filter(calendar => ['reader', 'writer', 'writerWithoutPrivateAccess', 'owner'].includes(calendar.accessRole) && this.capabilities(account.id)[this.readCapability(calendar)]).map(calendar => ({ calendar, state: this.repository.state(account.id, calendar.id, 'events') })).filter(value => due(value.state)).sort((left, right) => String(left.state.nextSyncAt ?? '').localeCompare(String(right.state.nextSyncAt ?? '')) || left.calendar.id.localeCompare(right.calendar.id))[0]; if (!selected) continue; calendarId = selected.calendar.id; kind = 'events'; }
      launched++; const job = (kind === 'list' ? this.syncCalendarList(account.id) : this.syncEvents(account.id, calendarId)).catch(() => {}).finally(() => this.jobs.delete(account.id)); this.jobs.set(account.id, job);
    }
    return launched;
  }
  async close() { this.closing = true; await Promise.allSettled([...this.jobs.values(), ...this.syncRequests.values(), ...this.operations.tails.values()]); }
}
