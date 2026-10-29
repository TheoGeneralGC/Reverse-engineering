import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import type { TrackingRequest } from './client.ts';
import type { RecentOpensState } from './RecentOpensPane.tsx';
import type { TrackingFeedUnavailable } from '../../../api/src/tracking-delivery-types.ts';
const keys = (v: unknown, expected: string[]): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === [...expected].sort().join(',');
export function checkedUnavailableFeed(raw: unknown, accountId: string): TrackingFeedUnavailable {
  const v = structuredClone(raw);
  if (!keys(v, ['accountId', 'policyVersion', 'availability', 'reason', 'events', 'nextCursor', 'coverage']) || v.accountId !== accountId || v.policyVersion !== 'local-tracking-delivery-v1' || v.availability !== 'unavailable' || v.reason !== 'event-import-not-integrated' || !Array.isArray(v.events) || v.events.length || v.nextCursor !== null || !keys(v.coverage, ['imported', 'fullMailbox', 'humanReadVerified', 'namedRecipientIdentity']) || Object.values(v.coverage).some(value => value !== false)) throw Error('Recent Opens status could not be verified.');
  return v as TrackingFeedUnavailable;
}
export default function useRecentOpens(accountId: string | undefined, visible: boolean, desired: boolean | undefined, request: TrackingRequest = api) {
  const signature = JSON.stringify([accountId ?? '', visible, desired ?? null]), current = useRef(signature), epoch = useRef(0), controller = useRef<AbortController | null>(null);
  const [result, setResult] = useState<{ signature: string; state: RecentOpensState } | null>(null); current.current = signature;
  const refresh = useCallback(async () => {
    if (!accountId || !visible || !desired) return;
    const token = ++epoch.current; controller.current?.abort(); const c = new AbortController(); controller.current = c;
    setResult({ signature, state: { phase: 'loading' } });
    try { checkedUnavailableFeed(await request('/tracking/feed?' + new URLSearchParams({ accountId }), undefined, 'GET', { signal: c.signal }), accountId); if (token === epoch.current && current.current === signature) setResult({ signature, state: { phase: 'unavailable', reason: 'event-import-not-integrated' } }); }
    catch { if (token === epoch.current && current.current === signature) setResult({ signature, state: { phase: 'error', message: 'Recent Opens status is unavailable. Refresh to check again.' } }); }
  }, [accountId, visible, desired, request]);
  useLayoutEffect(() => { void refresh(); return () => { epoch.current++; controller.current?.abort(); }; }, [refresh]);
  const state: RecentOpensState = desired === false ? { phase: 'disabled' } : result?.signature === signature ? result.state : { phase: 'loading' };
  return { state, refresh };
}
