import { createHash } from 'node:crypto';
import { validOutgoingRecipientEmail } from './outgoing-recipients.ts';

export const GOOGLE_IDENTITY_POLICY = 'google-send-as-identity-v1' as const;
export const GOOGLE_IDENTITY_LIMITS = { aliases: 128, responseBytes: 65_536, maximumAgeMs: 86_400_000 } as const;
export type GoogleAliasVerification = 'accepted' | 'pending' | 'unknown';
export type GoogleIdentityEntry = { email: string; isPrimary: boolean; verificationStatus: GoogleAliasVerification };
// Server-only input/output: these email addresses are not browser status DTOs.
export type GoogleSendAsObservation =
  | { state: 'complete'; accountId: string; fetchedAt: string; response: unknown }
  | { state: 'unavailable'; accountId: string };
export type GoogleSendAsIdentity = {
  policy: typeof GOOGLE_IDENTITY_POLICY;
  accountId: string;
  primaryEmail: string;
  entries: GoogleIdentityEntry[];
  selfAddresses: string[];
  eligibleFrom: string[];
  identityVersion: string;
};
export type GoogleIdentityProjection =
  | { availability: 'available'; fetchedAt: string; identity: GoogleSendAsIdentity }
  | { availability: 'unavailable'; reason: 'invalid-account' | 'scope-mismatch' | 'unavailable' | 'invalid-observation' | 'stale' | 'invalid-response'; identity: null };

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every(key => Object.hasOwn(v, key)) && Object.keys(v).every(key => required.includes(key) || optional.includes(key));
const accountId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 &&
  Buffer.byteLength(v, 'utf8') <= 1024 && !/[\s\p{Cc}\p{Cf}\p{Surrogate}]/u.test(v);
const canonicalEmail = (v: unknown): string | null => typeof v === 'string' && validOutgoingRecipientEmail(v) ? v.toLowerCase() : null;
const timestamp = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const unavailable = (reason: Extract<GoogleIdentityProjection, { availability: 'unavailable' }>['reason']): GoogleIdentityProjection => ({ availability: 'unavailable', reason, identity: null });

/** Pure projection; callers establish authenticated same-account response provenance.
 * No provider request, freshness clock read, credential read, file or storage access.
 */
export function projectGoogleSendAsIdentity(selectedAccount: unknown, observation: unknown, timing: unknown): GoogleIdentityProjection {
  if (!object(selectedAccount) || selectedAccount.provider !== 'google' || !accountId(selectedAccount.id)) return unavailable('invalid-account');
  const primary = canonicalEmail(selectedAccount.email);
  if (!primary) return unavailable('invalid-account');
  // Scope is checked before touching a potentially foreign response payload.
  if (!object(observation) || !accountId(observation.accountId)) return unavailable('invalid-observation');
  if (observation.accountId !== selectedAccount.id) return unavailable('scope-mismatch');
  if (observation.state === 'unavailable') return keys(observation, ['state', 'accountId']) ? unavailable('unavailable') : unavailable('invalid-observation');
  if (observation.state !== 'complete' || !keys(observation, ['state', 'accountId', 'fetchedAt', 'response']) || !timestamp(observation.fetchedAt)) return unavailable('invalid-observation');
  if (!object(timing) || !keys(timing, ['now', 'maxAgeMs']) || !Number.isSafeInteger(timing.now) || Number(timing.now) < 0 ||
    !Number.isSafeInteger(timing.maxAgeMs) || Number(timing.maxAgeMs) < 0 || Number(timing.maxAgeMs) > GOOGLE_IDENTITY_LIMITS.maximumAgeMs) return unavailable('invalid-observation');
  const age = Number(timing.now) - Date.parse(observation.fetchedAt);
  if (age < 0 || age > Number(timing.maxAgeMs)) return unavailable('stale');
  const response = observation.response;
  if (!object(response) || !keys(response, ['sendAs']) || !Array.isArray(response.sendAs) || response.sendAs.length < 1 || response.sendAs.length > GOOGLE_IDENTITY_LIMITS.aliases) return unavailable('invalid-response');
  const entries: GoogleIdentityEntry[] = [], seen = new Set<string>();
  for (const raw of response.sendAs) {
    if (!object(raw) || !keys(raw, ['sendAsEmail'], ['isPrimary', 'verificationStatus']) ||
      Object.hasOwn(raw, 'isPrimary') && typeof raw.isPrimary !== 'boolean') return unavailable('invalid-response');
    const email = canonicalEmail(raw.sendAsEmail);
    if (!email || seen.has(email)) return unavailable('invalid-response');
    seen.add(email);
    let verificationStatus: GoogleAliasVerification = 'unknown';
    if (Object.hasOwn(raw, 'verificationStatus')) {
      if (raw.verificationStatus === 'accepted' || raw.verificationStatus === 'pending') verificationStatus = raw.verificationStatus;
      else if (raw.verificationStatus !== 'verificationStatusUnspecified') return unavailable('invalid-response');
    }
    // Protobuf JSON may omit a false boolean. Verification applies only to custom aliases.
    entries.push({ email, isPrimary: raw.isPrimary === true, verificationStatus });
  }
  if (Buffer.byteLength(JSON.stringify(response), 'utf8') > GOOGLE_IDENTITY_LIMITS.responseBytes) return unavailable('invalid-response');
  const primaries = entries.filter(entry => entry.isPrimary);
  if (primaries.length !== 1 || primaries[0].email !== primary) return unavailable('invalid-response');
  entries.sort((a, b) => a.email < b.email ? -1 : a.email > b.email ? 1 : 0);
  const selfAddresses = entries.map(entry => entry.email);
  // A primary is authenticated by its exact selected-account match, not a custom-alias enum.
  const eligibleFrom = entries.filter(entry => entry.isPrimary || entry.verificationStatus === 'accepted').map(entry => entry.email);
  const basis = { policy: GOOGLE_IDENTITY_POLICY, accountId: selectedAccount.id, primaryEmail: primary, entries, selfAddresses, eligibleFrom };
  return { availability: 'available', fetchedAt: observation.fetchedAt, identity: { ...basis, identityVersion: createHash('sha256').update(JSON.stringify(basis), 'utf8').digest('hex') } };
}
