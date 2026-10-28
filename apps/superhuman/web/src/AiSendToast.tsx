import useDeliveryAcceleration from './useDeliveryAcceleration.ts';
import { useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore } from 'react';
import { api } from './api.ts';
import type { Draft } from './api.ts';
import { createAiDraftSend } from './ai-draft-send.ts';
import type { AiDraftPreview,AiDraftRequest,AiDraftStorage } from './ai-draft.ts';
import type { AiDraftTarget,AiSendActivity } from './AiDraftCard.tsx';
const browserStorage:AiDraftStorage={getItem:key=>window.localStorage.getItem(key),setItem:(key,value)=>window.localStorage.setItem(key,value),removeItem:key=>window.localStorage.removeItem(key)};
type Props={activity:AiSendActivity;accountId:string;navigationKey:string;currentEditor:object|null;onAcknowledge:(draft:Draft)=>void;onOpen:(target:AiDraftTarget,isCurrent:()=>boolean)=>Promise<boolean>|boolean;onDismiss:()=>void;registerUndo?:(action:(()=>boolean)|null)=>void;request?:AiDraftRequest;storage?:AiDraftStorage};
export default function AiSendToast({activity,accountId,navigationKey,currentEditor,onAcknowledge,onOpen,onDismiss,registerUndo,request=api,storage=browserStorage}:Props){
 const active=useRef(false),intent=useRef(0),latest=useRef({accountId,navigationKey,currentEditor,onAcknowledge,onOpen});latest.current={accountId,navigationKey,currentEditor,onAcknowledge,onOpen};
 const preview=activity.preview,identity=JSON.stringify([preview.accountId,preview.sessionId,preview.turnId,preview.id,preview.payloadHash,activity.requestId]);
 const model=useMemo(()=>createAiDraftSend({preview,request,storage,sendRequestId:activity.requestId,canSend:()=>false,isCurrent:()=>active.current&&latest.current.accountId===preview.accountId}),[identity,request,storage]);
 const state=useSyncExternalStore(model.subscribe,model.getSnapshot,model.getSnapshot),[notice,setNotice]=useState(''),refreshRequested=useRef(false);
 useLayoutEffect(()=>{active.current=true;model.resume();return()=>{active.current=false;intent.current++;model.suspend()}},[model]);
 useLayoutEffect(()=>{if(activity.phase!=='pending')refreshRequested.current=true},[activity.phase]);
 useLayoutEffect(()=>{if(refreshRequested.current&&!state.loading&&!state.checking&&!state.cancelling&&!state.cancelChecking){refreshRequested.current=false;void model.load()}},[activity.phase,state.loading,state.checking,state.cancelling,state.cancelChecking,model]);
 const response=state.response,operation=response?.operation,restored=response?.restoredDraft;
 const acceleration=useDeliveryAcceleration({scope:operation?{source:'artifact' as const,accountId:preview.accountId,sessionId:preview.sessionId,turnId:preview.turnId,operationId:operation.id}:null,snapshot:response,request,storage,isCurrent:()=>active.current&&latest.current.accountId===preview.accountId,onRefresh:()=>{void model.load()}});
 useLayoutEffect(()=>{if(restored&&active.current&&restored.accountId===latest.current.accountId)latest.current.onAcknowledge(restored)},[restored?.id,restored?.updatedAt,model]);
 const open=async(cancel:boolean)=>{
  if(cancel&&acceleration.isBlocking())return;
  const captured=latest.current,token=++intent.current;setNotice('');
  const sameIntent=()=>active.current&&token===intent.current&&captured.accountId===latest.current.accountId;
  const current=()=>sameIntent()&&captured.navigationKey===latest.current.navigationKey&&captured.currentEditor===latest.current.currentEditor;
  const result=await(cancel?model.cancel():model.load());
  if(!result||!active.current)return;const draft=result.restoredDraft;
  if(draft&&draft.accountId===latest.current.accountId)latest.current.onAcknowledge(draft);
  if(!current()||model.getSnapshot().cancelUnknown||model.getSnapshot().unknown||result.operation?.state!=='cancelled'||result.restoredResolution?.availability!=='available'||!draft){if(result.operation?.state==='cancelled')setNotice('Draft restored. Open it when your current work is finished.');return}
  // App owns the navigation/editor fence after handoff, including its own
  // intentional view-generation increment while flushing the prior editor.
  try{const opened=await latest.current.onOpen({accountId:preview.accountId,draftId:draft.id},sameIntent);if(!opened&&current())setNotice('Draft restored. Open it when your current work is finished.')}catch(error){if(current())setNotice(error instanceof Error?error.message:'The restored draft could not be opened.')}
 };
 const busy=state.cancelling||state.cancelChecking||state.reconciling||acceleration.state.sending||acceleration.state.checking,unknown=state.unknown||state.cancelUnknown;
 useLayoutEffect(()=>{if(operation&&['queued','sending','sent'].includes(operation.state)&&!response?.canCancel&&!unknown&&!busy&&!state.error&&!acceleration.isBlocking())onDismiss()},[operation?.state,response?.canCancel,unknown,busy,state.error,acceleration.state.receipt?.id,acceleration.state.unknown,onDismiss]);
 useLayoutEffect(()=>{registerUndo?.(()=>{const now=model.getSnapshot();if(acceleration.isBlocking()||!active.current||!now.loaded||!now.response?.canCancel||now.unknown||now.cancelUnknown||now.cancelling||now.cancelChecking)return false;void open(true);return true});return()=>registerUndo?.(null)},[model,registerUndo,operation?.id]);
 const label=state.cancelUnknown?'Undo is unconfirmed':operation?.state==='cancelled'?'Sending undone.':acceleration.state.unknown?'Instant Send is unconfirmed':acceleration.state.receipt||operation?.accelerationId?'Send accelerated!':activity.phase==='pending'&&!operation?'Sending…':unknown?'Delivery is unconfirmed':operation?.state==='not_dispatched'?'Message was not sent.':operation?.state==='outcome_unknown'?'Delivery is unconfirmed':operation?'Message sent.':'Checking send status…';
 return <div className="toast ai-send-toast" role="status" aria-live="polite" data-operation-state={operation?.state||'unconfirmed'}>
  <span>{label}</span>
  {response?.canCancel&&!unknown&&!acceleration.isBlocking()&&<button type="button" disabled={busy||!state.loaded} onClick={()=>void open(true)}>{state.cancelling?'Undoing…':'Undo'}</button>}
  {response?.canCancel&&!unknown&&!acceleration.isBlocking()&&!operation?.accelerationId&&(!operation||!('mode'in operation)||operation.mode!=='scheduled')&&<button type="button" aria-label="Instant Send" disabled={busy||!state.loaded} onClick={()=>void acceleration.accelerate()}>Instant Send ⚡</button>}
  {acceleration.state.unknown&&<button type="button" disabled={busy} onClick={()=>void acceleration.recover()}>Check Instant Send status</button>}
  {state.cancelUnknown?<button type="button" disabled={busy} onClick={()=>void model.recoverCancel()}>Check Undo status</button>:unknown||state.error&&!state.loading?<button type="button" disabled={busy||state.loading||state.checking} onClick={()=>void model.load()}>Check send status</button>:null}
  {operation?.state==='outcome_unknown'&&!state.cancelUnknown&&<button type="button" disabled={busy} onClick={()=>void model.reconcile()}>Check Sent</button>}
  {operation?.state==='cancelled'&&restored&&<button type="button" disabled={busy} onClick={()=>void open(false)}>Open draft</button>}
  <button type="button" aria-label="Dismiss send notification" onClick={onDismiss}>×</button>
  {notice&&<small>{notice}</small>}{acceleration.state.error&&<small>{acceleration.state.error}</small>}{state.error&&activity.phase!=='pending'&&<small>{state.error}</small>}
 </div>;
}
