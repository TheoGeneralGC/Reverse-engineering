import { useLayoutEffect,useMemo,useRef,useSyncExternalStore } from 'react';
import { createDeliveryAcceleration,deliveryOperationIdentity } from './delivery-acceleration.ts';
import type { AccelerationState,DeliverySnapshot } from './delivery-acceleration.ts';
import type { AiDraftRequest,AiDraftStorage } from './ai-draft.ts';
import type { DeliveryControlScope } from '../../api/src/delivery-control-types.ts';
const empty:AccelerationState={sending:false,checking:false,unknown:false,error:'',receipt:null};
const subscribeEmpty=()=>()=>{};
export default function useDeliveryAcceleration({scope,snapshot,request,storage,isCurrent,onRefresh}:{scope:DeliveryControlScope|null;snapshot:DeliverySnapshot|null;request:AiDraftRequest;storage:AiDraftStorage;isCurrent:()=>boolean;onRefresh:()=>void}){
 const latest=useRef({snapshot,isCurrent,onRefresh});latest.current={snapshot,isCurrent,onRefresh};const operation=snapshot?.operation;
 const identity=scope&&operation?JSON.stringify([scope,deliveryOperationIdentity(operation)]):'';
 const model=useMemo(()=>scope&&operation?createDeliveryAcceleration({scope,operation,request,storage,isCurrent:()=>latest.current.isCurrent(),canAccelerate:()=>latest.current.snapshot?.canCancel===true}):null,[identity,request,storage]);
 const state=useSyncExternalStore(model?.subscribe??subscribeEmpty,model?.getSnapshot??(()=>empty),model?.getSnapshot??(()=>empty));
 useLayoutEffect(()=>{model?.resume();return()=>model?.suspend()},[model]);
 useLayoutEffect(()=>{if(state.receipt||state.error&&!state.unknown)latest.current.onRefresh()},[state.receipt?.id,state.error,state.unknown,model]);
 return{state,accelerate:()=>{const current=latest.current.snapshot;return model&&current?model.accelerate(current):Promise.resolve(null)},recover:()=>model?.recover()??Promise.resolve(null),isBlocking:()=>{const current=model?.getSnapshot();return !!current&&(current.sending||current.checking||current.unknown||!!current.receipt)}};
}
