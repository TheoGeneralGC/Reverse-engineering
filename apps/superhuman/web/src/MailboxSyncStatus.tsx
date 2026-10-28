import Icon from './Icon.tsx';
import type { SyncPresentation } from './sync-state.ts';

export default function MailboxSyncStatus({state,retrying,onRetry}:{state:SyncPresentation;retrying:boolean;onRetry:()=>void}){
 return <section className={`sync-notice sync-${state.tone}`} role={state.tone==='error'?'alert':'status'} aria-live={state.tone==='error'?'assertive':'polite'} aria-label="Mailbox synchronization"><Icon name={state.tone==='error'?'flag':'clock'} size={17}/><div className="sync-copy"><strong>{state.title}</strong><p>{state.description}</p></div>{state.action==='reconnect'?<a href="/api/auth/google/start" className="sync-action">Reconnect Gmail</a>:state.action==='retry'?<button className="sync-action" disabled={retrying} onClick={onRetry}>{retrying?'Syncing…':state.actionLabel}</button>:null}</section>;
}
