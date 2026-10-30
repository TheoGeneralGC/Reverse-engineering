import { isAbsolute, resolve } from 'node:path';

export type HostedConfiguration = Readonly<{
  webOrigin: string;
  apiOrigin: string;
  originSecret: string;
  dataDirectory: string;
  databasePath: string;
  port: number;
}>;

const invalid = () => new TypeError('Hosted API configuration is invalid.');

function httpsOrigin(value: unknown): string {
  if (typeof value !== 'string') throw invalid();
  let url: URL;
  try { url = new URL(value); } catch { throw invalid(); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password ||
      !url.hostname.includes('.') || /^(?:localhost|127\.|\[|0\.)/.test(url.hostname)) throw invalid();
  return value;
}

/** Explicit startup configuration. Does not read files, process.env, or a database. */
export function loadHostedConfiguration(env: Readonly<NodeJS.ProcessEnv>): HostedConfiguration {
  if (!env || typeof env !== 'object' || Array.isArray(env)) throw invalid();
  const webOrigin = httpsOrigin(env.WEB_ORIGIN);
  const apiOrigin = httpsOrigin(env.HOSTED_API_ORIGIN);
  if (webOrigin === apiOrigin || env.ORIGIN_SECRET?.length !== 64 || !/^[a-f0-9]{64}$/.test(env.ORIGIN_SECRET) ||
      env.TOKEN_ENCRYPTION_KEY?.length !== 64 || !/^[a-f0-9]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY)) throw invalid();
  const dataDirectory = env.HOSTED_DATA_DIR;
  const databasePath = env.DATABASE_PATH;
  if (typeof dataDirectory !== 'string' || !isAbsolute(dataDirectory) ||
      resolve(dataDirectory) !== dataDirectory || dataDirectory === '/' ||
      /[\x00-\x1f\x7f]/.test(dataDirectory) ||
      databasePath !== resolve(dataDirectory, 'mail.sqlite')) throw invalid();
  if (env.GOOGLE_REDIRECT_URI !== `${webOrigin}/api/auth/google/callback`) throw invalid();
  const portValue = env.PORT ?? '3001';
  if (!/^[1-9]\d{0,4}$/.test(portValue) || Number(portValue) > 65535 || String(Number(portValue)) !== portValue) throw invalid();
  return Object.freeze({ webOrigin, apiOrigin, originSecret: env.ORIGIN_SECRET!,
    dataDirectory, databasePath, port: Number(portValue) });
}
