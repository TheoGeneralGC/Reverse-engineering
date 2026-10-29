/** Shared whole quoted-output boundary. Browser safe; no Mail or IO dependency. */
export const AUTO_DRAFT_REPLY_OUTPUT_BYTES = 500000;
/** Trusted server configuration only. Store the effective IANA zone per input,
 * never rely on host-local formatting after an asynchronous model response. */
export function autoDraftReplyTimeZone(value: unknown = 'UTC'): string {
  if (typeof value !== 'string' || value.length > 100 || !/^[-A-Za-z_+]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(value)) throw new TypeError('Invalid automatic reply timezone');
  try { return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone; }
  catch { throw new TypeError('Invalid automatic reply timezone'); }
}
