import type { DatabaseSync } from 'node:sqlite';
// Tables are a fixed internal allowlist, never client-controlled identifiers.
const ledgers=['ai_draft_requests','ai_draft_sends','ai_draft_send_cancellations','draft_send_operations','draft_send_cancellations','delivery_accelerations','provider_draft_discards'] as const;
export function deliveryActionKeyInUse(db:DatabaseSync,accountId:string,key:string,except:readonly string[]=[]):boolean{
  for(const table of ledgers){
    if(except.includes(table)||!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
    if(db.prepare(`SELECT 1 FROM ${table} WHERE account_id=? AND client_key=?`).get(accountId,key))return true;
  }
  return false;
}
