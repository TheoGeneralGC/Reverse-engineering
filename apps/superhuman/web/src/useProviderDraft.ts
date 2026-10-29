import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Draft } from './api.ts';
import { ProviderDraftStatusController } from './provider-draft-status.ts';
import { ProviderDraftDiscardController } from './provider-draft-discard.ts';

export type ProviderDraftModels = { status: ProviderDraftStatusController; discard: ProviderDraftDiscardController };
const empty = Object.freeze({});
const none = () => empty;
const noSubscribe = () => () => {};

export default function useProviderDraft(draft: Draft | null, activeAccountId: string | undefined, provider: string | undefined, canDiscard: () => boolean): ProviderDraftModels | null {
  const signature = draft && draft.accountId === activeAccountId && provider === 'google' ? JSON.stringify([draft.accountId, draft.id]) : '';
  const latest = useRef({ signature, canDiscard }); latest.current = { signature, canDiscard };
  const models = useMemo(() => {
    if (!signature || !draft) return null;
    const isCurrent = () => latest.current.signature === signature;
    return {
      status: new ProviderDraftStatusController({ accountId: draft.accountId, draftId: draft.id, localRevision: draft.revision ?? null, isCurrent }),
      discard: new ProviderDraftDiscardController({ accountId: draft.accountId, draftId: draft.id, storage: window.localStorage, isCurrent, canDiscard: () => latest.current.canDiscard() }),
    };
  }, [signature]);
  useSyncExternalStore(models?.status.subscribe ?? noSubscribe, models?.status.getSnapshot ?? none, none);
  useSyncExternalStore(models?.discard.subscribe ?? noSubscribe, models?.discard.getSnapshot ?? none, none);
  useLayoutEffect(() => {
    if (!models) return;
    models.status.activate(); models.discard.activate(); void models.status.load();
    if (models.discard.getSnapshot().request) void models.discard.recover();
    return () => { models.status.suspend(); models.discard.suspend(); };
  }, [models]);
  useEffect(() => {
    if (!models || !draft) return;
    const local = models.status.getSnapshot();
    // A durable delivery/Undo metadata acknowledgement can advance a clean
    // editor's local revision, but cannot acknowledge newer authored input.
    if (!local.localDirty && !local.localError && Number.isSafeInteger(draft.revision) && draft.revision! > (local.localRevision ?? -1)) models.status.acknowledgeLocal(draft.revision!, local.editVersion);
    void models.status.load();
  }, [models, draft?.status, draft?.composerSendId, draft?.artifactSendId]);
  return models;
}

export function acknowledgeProviderDraft(models: ProviderDraftModels | null, record: Draft, metadata: unknown, editVersion?: number): void {
  if (!models || record.accountId !== models.status.scope.accountId || record.id !== models.status.scope.draftId) return;
  if (editVersion !== undefined && Number.isSafeInteger(record.revision)) models.status.acknowledgeLocal(record.revision!, editVersion);
  models.status.acceptAcknowledgedStatus(metadata);
}
