import type { Store } from './store.ts';
import { GMAIL_SCOPE, type GoogleServiceGrant } from './google-scopes.ts';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const tokenText = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 16384 && /^[\x21-\x7e]+$/.test(value);
const cacheFields = new Set(['access_token', 'refresh_token', 'expires_at', 'grantedScopes']);

function cachedMailScopes(value: unknown): string[] | null {
  if (!object(value) || Object.keys(value).some(key => !cacheFields.has(key)) || !tokenText(value.access_token) || !tokenText(value.refresh_token) || !Number.isSafeInteger(value.expires_at) || Number(value.expires_at) <= 0 || !Array.isArray(value.grantedScopes) || !value.grantedScopes.length || value.grantedScopes.length > 128) return null;
  // OAuth scope tokens are case sensitive, nonempty ASCII without spaces,
  // quotes or backslashes (RFC 6749 scope-token). Never infer an omitted scope.
  if (value.grantedScopes.some(scope => typeof scope !== 'string' || scope.length > 2048 || !/^[\x21\x23-\x5b\x5d-\x7e]+$/.test(scope))) return null;
  const scopes = [...new Set(value.grantedScopes as string[])];
  if (Buffer.byteLength(scopes.join(' ')) > 16384 || !scopes.some(scope => scope === GMAIL_SCOPE || scope === 'https://mail.google.com/')) return null;
  return scopes;
}

function unambiguousMailEnvelope(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 65536) return false;
  const pieces = value.split('.');
  if (pieces.length !== 3 || pieces.some(piece => !piece || !/^[A-Za-z0-9_-]+$/.test(piece))) return false;
  const decoded = pieces.map(piece => Buffer.from(piece, 'base64url'));
  return decoded[0].length === 12 && decoded[1].length === 16 && decoded[2].length > 0 && pieces.every((piece, index) => decoded[index].toString('base64url') === piece);
}

/** Explicit startup-only adoption of last-observed scopes from existing mail caches.
 * This never validates remote permission/identity and never touches token bytes.
 */
export function migrateLegacyMailGrantMetadata(store: Store, decrypt: (sealed: string) => unknown, now: () => number = Date.now): { adopted: number } {
  if (store.db.isTransaction) throw new Error('Mail grant adoption must own its startup transaction');
  store.db.exec('BEGIN IMMEDIATE');
  try {
    let adopted = 0;
    const updatedAt = new Date(now()).toISOString();
    // A calendar credential uses a different key; only the exact account slot is
    // joined. Existing rows win by presence even if their JSON is null/corrupt.
    const rows = store.db.prepare("SELECT a.id,a.data,s.value FROM records a JOIN secrets s ON s.account_id=a.id WHERE a.kind='account' AND NOT EXISTS(SELECT 1 FROM records g WHERE g.kind='googleGrant' AND g.id='mail:'||a.id) ORDER BY a.id").all();
    for (const row of rows) {
      let account: unknown;
      try { account = JSON.parse(String(row.data)); } catch { continue; }
      if (!object(account) || account.provider !== 'google' || account.id !== row.id || typeof account.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email) || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Surrogate}]/u.test(account.email) || account.id !== 'google:' + account.email.toLowerCase() || !unambiguousMailEnvelope(row.value)) continue;
      let decoded: unknown;
      try { decoded = decrypt(row.value); } catch { continue; }
      const grantedScopes = cachedMailScopes(decoded);
      if (!grantedScopes) continue;
      const grant: GoogleServiceGrant = { accountId: String(row.id), service: 'mail', requestedScopes: [], grantedScopes, scopeSource: 'token-cache', updatedAt, outcome: 'granted' };
      store.db.prepare("INSERT INTO records(kind,id,data) VALUES('googleGrant',?,?)").run('mail:' + row.id, JSON.stringify(grant));
      adopted++;
    }
    store.db.exec('COMMIT');
    return { adopted };
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
}
