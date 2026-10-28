import { useLayoutEffect,useRef,useSyncExternalStore } from 'react';
import { api } from './api.ts';
import { contactContextKey,createContactContext } from './contact-context.ts';
import type { ContactContext,ContactRequest,ContactSummary } from './contact-context.ts';
const readContact:ContactRequest=(context,signal)=>api<ContactSummary>('/contacts/context?'+new URLSearchParams(context),undefined,'GET',{signal});
export default function useContactContext(context:ContactContext,preserveContact=false){
 const current=useRef(context);current.current=context;
 const ref=useRef<ReturnType<typeof createContactContext>|null>(null);
 if(!ref.current)ref.current=createContactContext({request:readContact,isCurrent:captured=>contactContextKey(captured)===contactContextKey(current.current)});
 const model=ref.current,snapshot=useSyncExternalStore(model.subscribe,model.getSnapshot,model.getSnapshot),key=contactContextKey(context);
 useLayoutEffect(()=>{model.setContext(context,{preserveContact})},[key,model,preserveContact]);
 // StrictMode replays effect setup/cleanup on the same mounted controller.
 useLayoutEffect(()=>{model.resume();return()=>model.suspend()},[model]);
 return{...model,snapshot:snapshot.context&&contactContextKey(snapshot.context)===key?snapshot:null};
}
