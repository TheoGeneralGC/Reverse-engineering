/** Local anonymous display policy. Original evidence establishes one hours-ago row, not these full thresholds. */
export function readClock(value: number, timeZone: string): string {
  if (!Number.isSafeInteger(value) || value < 0) return 'Time unavailable';
  try { return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(value); }
  catch { return 'Time unavailable'; }
}
export function readRelative(value: number, now: number): string {
  if (![value, now].every(v => Number.isSafeInteger(v) && v >= 0) || value > now) return 'Time unavailable';
  const seconds = Math.floor((now - value) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) { const n = Math.floor(seconds / 60); return n + (n === 1 ? ' min ago' : ' mins ago'); }
  if (seconds < 86400) { const n = Math.floor(seconds / 3600); return n + (n === 1 ? ' hr ago' : ' hrs ago'); }
  const days = Math.floor(seconds / 86400); return days + (days === 1 ? ' day ago' : ' days ago');
}
export function readISO(value: number): string | undefined {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000) return undefined;
  return new Date(value).toISOString();
}
export function readCount(count: number, lowerBound: boolean): string {
  if (!Number.isSafeInteger(count) || count < 0) return 'Activity count unavailable';
  return 'Image fetched ' + count + (lowerBound ? '+' : '') + (count === 1 && !lowerBound ? ' time' : ' times');
}
