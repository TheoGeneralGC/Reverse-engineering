import { createHash } from 'node:crypto';
import { AUTO_DRAFTS_POLICY, AUTO_DRAFTS_PROTOCOL, stable, intentText, type SettingsResponse, type PreferencesSnapshot, type PreferenceSave, type SaveResponse } from '../../api/src/auto-drafts-contract.ts';
export const at = '2026-10-29T00:00:00.000Z';
export const digest = async (text: string) => createHash('sha256').update(text).digest('hex');
export const settings = (accountId = 'fixture-a', preferences?: PreferencesSnapshot): SettingsResponse => ({
  accountId,
  preferences: preferences || { version: 1, section: 'preferences', accountId, settingsId: null, revision: 0, persisted: false, updatedAt: null, provenance: 'local-default-off', originalDefaultVerified: false, value: { followUpsEnabled: false, responsesEnabled: false, onlyEmailedBefore: false } },
  scheduling: { version: 1, section: 'teammate-scheduling', accountId, settingsId: null, revision: 0, persisted: false, updatedAt: null, provenance: 'local-default-off', originalDefaultVerified: false, value: { enabled: false, teammateId: null, prompt: '' } },
  capabilities: { policyVersion: AUTO_DRAFTS_POLICY, preferencesWritable: true, generationAvailable: false, automaticProcessing: false, generationReason: 'generation-not-implemented', schedulingAvailable: false, schedulingPreviewAvailable: false, schedulingReason: 'team-directory-unavailable', teammates: [], originalAccessGatesVerified: false },
});
export async function accepted(request: PreferenceSave, base: PreferencesSnapshot, historical = false): Promise<SaveResponse> {
  const value = { ...base.value, [request.change.field]: request.change.value }, changed = stable(value) !== stable(base.value);
  const next: PreferencesSnapshot = changed ? { ...base, value, persisted: true, provenance: 'account-saved', settingsId: base.settingsId || 'saved-' + base.accountId, revision: base.revision + 1, updatedAt: at } : structuredClone(base);
  return { historical, acceptedSnapshot: next, receipt: { id: 'receipt-' + request.clientRequestId, accountId: request.accountId, clientRequestId: request.clientRequestId, section: 'preferences', protocol: AUTO_DRAFTS_PROTOCOL, requestFingerprint: await digest(intentText(request)), request: structuredClone(request), priorRevision: base.revision, acceptedRevision: next.revision, changed, acceptedAt: at, snapshotFingerprint: await digest(stable(next)) } };
}
export const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
export const storage = () => { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; };
