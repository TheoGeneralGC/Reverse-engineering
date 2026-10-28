import type { CalendarEvent,CalendarEventInput,CalendarMetadata,CalendarOperation,CalendarRangeResult,CalendarSyncState } from '../../../api/src/calendar-types.ts';
export type { CalendarEvent,CalendarEventInput,CalendarMetadata,CalendarOperation,CalendarRangeResult,CalendarSyncState };
export type CalendarCapabilities={list:boolean;read:boolean;readOwned:boolean;writeOwned:boolean;freebusy:boolean};
export type CalendarProviderStatus={enabled:boolean;configured:boolean;missing?:string[];grant:unknown|null;authAttempt?:{outcome?:string;error?:string}|null;capabilities:CalendarCapabilities;writesEnabled:boolean;liveVerified:false};
export type CalendarCatalog={calendars:CalendarMetadata[];sync:CalendarSyncState;providerStatus:CalendarProviderStatus};
export type CalendarDraft={key:string;kind:'create'|'update';eventId?:string;etag?:string;calendarId:string;summary:string;description:string;location:string;attendees:string;allDay:boolean;startDate:string;startTime:string;endDate:string;endTime:string;timeZone:string;startOffset:string;endOffset:string;recurrence:string[];recurringInstance?:boolean;conference?:boolean};
export type CalendarRequest=<T>(path:string,body?:unknown,method?:string)=>Promise<T>;
