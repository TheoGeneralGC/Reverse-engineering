import type { AccountSync } from './api.ts';

export type SyncPresentation={title:string;description:string;tone:'progress'|'error'|'info';incomplete:boolean;action?:'retry'|'reconnect';actionLabel?:string};
const reconnectCodes=new Set(['reconnect_required','google_authorization_failed','google_scope_missing','google_insufficient_scope','insufficient_google_scope','google_refresh_token_missing']);

export function describeSync(sync:AccountSync|null,now=Date.now()):SyncPresentation|null{
 if(!sync)return{title:'Checking mailbox sync…',description:'Checking whether your messages have finished importing.',tone:'progress',incomplete:true};
 if(sync.status==='error'){
  const reconnect=sync.requiresReconnect===true||reconnectCodes.has(sync.code||'');
  const throttled=sync.code==='google_rate_limited';
  const next=sync.nextSyncAt&&Date.parse(sync.nextSyncAt)>now?` Next attempt ${new Date(sync.nextSyncAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}.`:'';
  return{title:reconnect?'Reconnect Gmail':throttled?'Gmail sync is temporarily paused':'Mailbox sync needs attention',description:(sync.error||(reconnect?'Gmail authorization needs to be renewed.':throttled?'Gmail is limiting requests. Your saved messages are still available.':'Messages could not be synchronized. Your saved messages are still available.'))+next,tone:'error',incomplete:true,action:reconnect?'reconnect':'retry',actionLabel:reconnect?'Reconnect Gmail':'Retry sync'};
 }
 // A routine history refresh must not hide the already imported mailbox or
 // make stable counts flicker back to an incomplete import on every poll.
 if((sync.status==='queued'||sync.status==='running')&&sync.phase==='history'&&!sync.partial&&sync.lastCompletedAt)return null;
 if(sync.status==='queued'||sync.status==='running')return{title:sync.phase==='initial'||sync.phase==='not-started'?'Importing your mailbox…':'Syncing mailbox…',description:sync.phase==='initial'?'Messages will appear as they finish importing. Inbox counts are still updating.':'Checking Gmail for new messages and changes.',tone:'progress',incomplete:true};
 if(sync.phase==='not-started')return{title:'Mailbox has not been imported',description:'Start synchronization to load your messages.',tone:'info',incomplete:true,action:'retry',actionLabel:'Start sync'};
 if(sync.partial||sync.phase==='initial')return{title:'Mailbox import is incomplete',description:'Some messages may not be available yet. Inbox counts are still updating.',tone:'info',incomplete:true,action:'retry',actionLabel:'Continue sync'};
 return null;
}

function failedStatus(error:unknown,previous:AccountSync|null):AccountSync{
 const problem=error as {message?:string;code?:string};
 return{phase:previous?.phase||'not-started',partial:previous?.partial??true,...previous,status:'error',code:problem?.code||'sync_status_unavailable',error:problem?.code?problem.message:'Could not check mailbox synchronization. Your saved messages are still available.'};
}

// One monitor owns one account. It only reads status; it never starts provider
// synchronization. A disposed account's late responses cannot update the UI.
export function createSyncMonitor(options:{read:()=>Promise<AccountSync>;onStatus:(sync:AccountSync)=>void;onChange?:()=>void;schedule?:(callback:()=>void,delay:number)=>()=>void}){
 let stopped=false,revision=0,cancelTimer:(()=>void)|undefined,previous:AccountSync|null=null;
 const schedule=options.schedule||((callback,delay)=>{const timer=setTimeout(callback,delay);return()=>clearTimeout(timer)});
 async function check(){
  cancelTimer?.();const request=++revision;
  try{
   const sync=await options.read();if(stopped||request!==revision)return;
   const changed=!previous||JSON.stringify(sync)!==JSON.stringify(previous);previous=sync;options.onStatus(sync);if(changed)options.onChange?.();
  }catch(error){if(stopped||request!==revision)return;previous=failedStatus(error,previous);options.onStatus(previous);}
  finally{if(!stopped&&request===revision)cancelTimer=schedule(()=>void check(),previous?.status==='running'||previous?.status==='queued'?2500:previous?.partial?6000:30000);}
 }
 return{check,stop(){stopped=true;revision++;cancelTimer?.();}};
}

export { failedStatus as syncFailure };
