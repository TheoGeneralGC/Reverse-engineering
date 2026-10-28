/** Mutable private journal values are validated at every network boundary. */
export function parseCalendarFlags(args: string[]): { mode: string; step: string; runId: string; polls: number; intervalMs: number };
export function calendarFixture(approval: any): any;
export function createCalendarState(approval: any): Record<string, any>;
export function validateCalendarApproval(approval: unknown, runId: string, ready: boolean, approvedParticipants: string[]): void;
export function validateCalendarBoundary(approval: unknown, accounts: unknown, statuses: unknown, calendars: unknown): unknown;
export function validateOwnedCalendarEvent(event: unknown, state: unknown, approval: unknown, expectedSummary: string): unknown;
export function validateCalendarRequest(flags: unknown, path: string, method: string, state: unknown): void;
export function runCalendarHarness(options: { flags: { mode: string; step: string; runId: string; polls: number; intervalMs: number }; approval: unknown; approvedParticipants: string[]; state: Record<string, any>; persist: (state: Record<string, any>) => unknown; request: (path: string, body?: Record<string, any>) => Promise<any>; now?: () => number; sleep?: (milliseconds: number) => Promise<unknown> }): Promise<any>;
