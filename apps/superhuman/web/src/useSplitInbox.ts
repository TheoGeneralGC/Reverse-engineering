import {useCallback,useLayoutEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import {SplitInboxModel} from './split-inbox-model.ts';
const storage={getItem:(key:string)=>window.localStorage.getItem(key),setItem:(key:string,value:string)=>window.localStorage.setItem(key,value),removeItem:(key:string)=>window.localStorage.removeItem(key)};
export default function useSplitInbox(accountId:string|undefined){
 const current=useRef(accountId);current.current=accountId;
 const model=useMemo(()=>accountId?new SplitInboxModel({accountId,storage,isCurrent:()=>current.current===accountId}):null,[accountId]);
 const subscribe=useCallback((fn:()=>void)=>model?.subscribe(fn)||(()=>{}),[model]);const get=useCallback(()=>model?.getSnapshot()||null,[model]);const state=useSyncExternalStore(subscribe,get,get);
 useLayoutEffect(()=>{if(!model)return;model.activate();void model.load();return()=>model.suspend()},[model]);
 return{model,state,refresh:useCallback(()=>model?.loadViews()||Promise.resolve(false),[model])};
}
