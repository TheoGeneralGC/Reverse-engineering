import { readFileSync } from 'node:fs';
import type { Client } from '@libsql/client/web';
import { requireValue } from '../../collector/src/protocol.ts';
import { validateSchema } from './database.ts';
import { sqlConnection } from './store-libsql.ts';
/** Explicit operator call only. No CLI, import-time config, connection, file read or migration. */
export async function installSchema(client: Client) {
  const source=readFileSync(new URL('../migrations/001.sql',import.meta.url),'utf8');
  const statements=source.split(';').map(s=>s.trim()).filter(Boolean).map(s=>s.replace(/\bIF NOT EXISTS\s+/g,''));
  const tx=await client.transaction('write');
  try{
    const db=sqlConnection(tx);
    requireValue((await db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all()).length===0,409,'collector_database_identity_mismatch');
    requireValue((await db.prepare('PRAGMA foreign_keys').get())?.foreign_keys===1,500,'collector_database_identity_mismatch');
    await tx.batch(statements);await validateSchema(db);await tx.commit();
  }catch(error){try{await tx.rollback()}catch{}throw error}finally{tx.close()}
}
