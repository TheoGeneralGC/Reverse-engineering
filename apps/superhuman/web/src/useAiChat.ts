import { useLayoutEffect,useRef,useSyncExternalStore } from 'react';
import { api } from './api.ts';
import { createAiChat } from './ai-chat.ts';
import type { AiChatContext,AiChatStorage } from './ai-chat.ts';
const browserStorage:AiChatStorage={getItem:key=>window.localStorage.getItem(key),setItem:(key,value)=>window.localStorage.setItem(key,value),removeItem:key=>window.localStorage.removeItem(key)};
export default function useAiChat(context:AiChatContext){
 const latest=useRef(context);latest.current=context;const ref=useRef<ReturnType<typeof createAiChat>|null>(null);
 if(!ref.current)ref.current=createAiChat({request:(path,body,method,options)=>api(path,body,method,options),storage:browserStorage,isCurrent:captured=>captured.accountId===latest.current.accountId&&captured.visible===latest.current.visible});
 const model=ref.current,snapshot=useSyncExternalStore(model.subscribe,model.getSnapshot,model.getSnapshot),key=JSON.stringify([context.accountId,context.visible,context.selectedThreadId??null]);
 useLayoutEffect(()=>model.setContext(context),[key,model]);
 useLayoutEffect(()=>{model.resume();return()=>model.suspend()},[model]);
 return{model,snapshot:snapshot.context.accountId===context.accountId&&snapshot.context.visible===context.visible?snapshot:null};
}
