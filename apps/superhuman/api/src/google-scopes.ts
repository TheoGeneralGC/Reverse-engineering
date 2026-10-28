export type GoogleService = 'mail' | 'calendar';
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
export const CALENDAR_SCOPES = {
  list: 'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  read: 'https://www.googleapis.com/auth/calendar.events.readonly',
  owned: 'https://www.googleapis.com/auth/calendar.events.owned',
  freebusy: 'https://www.googleapis.com/auth/calendar.events.freebusy',
} as const;
export const CALENDAR_REQUEST_SCOPES = ['openid', 'email', ...Object.values(CALENDAR_SCOPES)];
export type GoogleServiceGrant = { accountId: string; service: GoogleService; requestedScopes: string[]; grantedScopes: string[]; scopeSource: 'response' | 'requested' | 'token-cache'; updatedAt: string; outcome: 'granted' | 'partial' };
export type GoogleAuthContext = { service: GoogleService; accountId?: string; requestedScopes: string[] };
export function calendarCapabilities(scopes: readonly string[]) {
  const has = (...values: string[]) => values.some(value => scopes.includes(value));
  const full = has('https://www.googleapis.com/auth/calendar'); const fullRead = full || has('https://www.googleapis.com/auth/calendar.readonly');
  return { list: fullRead || has(CALENDAR_SCOPES.list, 'https://www.googleapis.com/auth/calendar.calendarlist'), read: fullRead || has(CALENDAR_SCOPES.read, 'https://www.googleapis.com/auth/calendar.events'), readOwned: fullRead || has(CALENDAR_SCOPES.read, CALENDAR_SCOPES.owned, 'https://www.googleapis.com/auth/calendar.events'), writeOwned: full || has(CALENDAR_SCOPES.owned, 'https://www.googleapis.com/auth/calendar.events'), freebusy: fullRead || has(CALENDAR_SCOPES.freebusy, 'https://www.googleapis.com/auth/calendar.freebusy') };
}
