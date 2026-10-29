import { createServer } from 'node:http';
import { readFileSync, lstatSync, chmodSync, realpathSync } from 'node:fs';
import { resolve, isAbsolute, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCollector } from './collector.ts';
import { CollectorError, HEX, MAX_BODY, MAX_TARGET, exactObject, requireValue } from './protocol.ts';

function privateFile(path: string): Buffer {
  requireValue(resolve(path) === path,500,'absolute_secret_path_required');
  const stat=lstatSync(path);
  requireValue(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.size <= 16384,500,'private_secret_file_required');
  return readFileSync(path);
}
/** Pure endpoint preflight, shared by direct and managed deployment entry points. */
export function listenerConfiguration(env: NodeJS.ProcessEnv) {
  const databasePath=env.TRACKING_DATABASE_PATH,publicOrigin=env.TRACKING_PUBLIC_ORIGIN;
  requireValue(databasePath && publicOrigin,500,'explicit_configuration_required');
  requireValue(!databasePath.includes('\0') && isAbsolute(databasePath) && resolve(databasePath) === databasePath && databasePath !== ':memory:',500,'explicit_database_required');
  const portRaw=env.TRACKING_PORT ?? '3013';
  requireValue(/^\d{1,5}$/.test(portRaw) && Number(portRaw) >= 1024 && Number(portRaw) <= 65535,500,'invalid_port');
  const port=Number(portRaw);let origin: URL;try{origin=new URL(publicOrigin);}catch{throw new CollectorError(500,'stable_https_origin_required');}
  requireValue(origin.origin === publicOrigin && !origin.username && !origin.password && (origin.protocol === 'https:' || origin.origin === `http://127.0.0.1:${port}`),500,'stable_https_origin_required');
  const listenHost=env.TRACKING_LISTEN_HOST ?? '127.0.0.1';
  requireValue(['127.0.0.1','0.0.0.0'].includes(listenHost) && (listenHost === '127.0.0.1' || origin.protocol === 'https:'),500,'invalid_listener_configuration');
  return {databasePath,port,origin,listenHost};
}
/** Inspect the explicit canonical destination without opening or creating a database. */
export function validateDatabaseDestination(databasePath: string) {
  const parent=dirname(databasePath),stat=lstatSync(parent);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(parent) === parent,500,'canonical_durable_directory_required');
  try{const leaf=lstatSync(databasePath);requireValue(leaf.isFile() && !leaf.isSymbolicLink(),500,'regular_database_required');}
  catch(error){if(!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))throw error;}
}
/** Explicit deployment entry point. There is no import-time server, env, secret or database access. */
export function startCollector(env: NodeJS.ProcessEnv) {
  const {databasePath,port,origin,listenHost}=listenerConfiguration(env),signerFile=env.TRACKING_SIGNERS_FILE,cursorFile=env.TRACKING_CURSOR_KEY_FILE;
  requireValue(signerFile && cursorFile,500,'explicit_configuration_required');
  validateDatabaseDestination(databasePath);
  const loaded=JSON.parse(privateFile(signerFile).toString('utf8')) as unknown;
  requireValue(Array.isArray(loaded) && loaded.length > 0 && loaded.length <= 32,500,'invalid_signers');
  const signers=new Map<string,{tenant:string;key:Buffer}>();
  for (const raw of loaded) {
    const signer=exactObject(raw,['keyId','tenant','key']);
    requireValue(typeof signer.keyId === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(signer.keyId) && typeof signer.tenant === 'string' && HEX.test(signer.tenant) && typeof signer.key === 'string' && /^[a-f0-9]{64,128}$/.test(signer.key) && signer.key.length % 2 === 0 && !signers.has(signer.keyId),500,'invalid_signers');
    signers.set(signer.keyId,{tenant:signer.tenant,key:Buffer.from(signer.key,'hex')});
  }
  const cursorBytes=privateFile(cursorFile);
  requireValue(cursorBytes.every(byte=>byte < 128),500,'invalid_cursor_key');
  const cursorHex=cursorBytes.toString('utf8').replace(/\r?\n$/,'');
  requireValue(/^[a-f0-9]{64,128}$/.test(cursorHex) && cursorHex.length % 2 === 0,500,'invalid_cursor_key');
  const collector=createCollector({databasePath,signers,cursorKey:Buffer.from(cursorHex,'hex')});
  for (const signer of signers.values()) signer.key.fill(0);
  if (databasePath !== ':memory:') chmodSync(databasePath,0o600);
  const server=createServer({maxHeaderSize:8192,headersTimeout:10000,requestTimeout:10000},async(req,res) => {
    const finish=(status:number) => { res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','connection':'close'});res.end('{"error":{"code":"invalid_request"}}'); };
    try {
      if (!req.url || req.url.length > MAX_TARGET || req.headers.host !== origin.host || req.headers['transfer-encoding'] !== undefined || req.headers.upgrade !== undefined) { finish(400);req.resume();return; }
      const headerNames=new Set<string>();
      for(let n=0;n<req.rawHeaders.length;n+=2) { const name=req.rawHeaders[n].toLowerCase();if(headerNames.has(name)){finish(400);req.resume();return;}headerNames.add(name); }
      const length=req.headers['content-length'];
      if (length !== undefined && (!/^\d{1,5}$/.test(length) || Number(length) > MAX_BODY)) { finish(413);req.resume();return; }
      if (req.url === '/healthz') {
        if (!['GET','HEAD'].includes(req.method ?? '') || length !== undefined && Number(length) !== 0) { finish(400);req.resume();return; }
        const readable=collector.readable();
        res.writeHead(readable ? 204 : 503,{'cache-control':'no-store','x-content-type-options':'nosniff','connection':'close'});res.end();return;
      }
      const chunks:Buffer[]=[];let size=0;
      for await (const chunk of req) { size+=chunk.length;if(size > MAX_BODY){finish(413);return;}chunks.push(Buffer.from(chunk)); }
      const headers:Record<string,string|undefined>={};
      for(const [name,value] of Object.entries(req.headers)) { if (Array.isArray(value)) {finish(400);return;}headers[name]=value; }
      const output=collector.handle({method:req.method ?? '',target:req.url,headers,body:Buffer.concat(chunks)});
      res.writeHead(output.status,output.headers);res.end(output.body);
    } catch { if(!res.headersSent)finish(500);else res.destroy(); }
  });
  server.listen(port,listenHost);
  let closing=false;
  const close=() => { if(closing)return;closing=true;server.close(() => collector.close()); };
  server.once('error',() => { closing=true;collector.close();process.exitCode=1; });
  return { server, close };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { const running=startCollector(process.env);process.once('SIGINT',running.close);process.once('SIGTERM',running.close); }
  catch { process.stderr.write('Collector configuration/start failed. No credential values are logged.\n');process.exitCode=1; }
}
