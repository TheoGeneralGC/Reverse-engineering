import { lstatSync, mkdirSync, openSync, closeSync, writeFileSync, readFileSync, fsyncSync } from 'node:fs';
import { isAbsolute, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exactObject, HEX, requireValue } from './protocol.ts';
import { listenerConfiguration, startCollector, validateDatabaseDestination } from './server.ts';

/** Materialize administrator-supplied deployment secrets; never generate or replace keys. */
export function prepareDeploymentEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  listenerConfiguration(env);
  const database=env.TRACKING_DATABASE_PATH,source=env.TRACKING_BOOTSTRAP_SIGNERS_JSON,cursor=env.TRACKING_BOOTSTRAP_CURSOR_KEY,revision=env.TRACKING_CONFIG_REVISION ?? 'initial';
  requireValue(database && isAbsolute(database) && resolve(database) === database && dirname(database) !== '/' && source && Buffer.byteLength(source) <= 16384 && cursor && /^[a-f0-9]{64,128}$/.test(cursor) && cursor.length % 2 === 0 && /^[a-zA-Z0-9_-]{1,48}$/.test(revision),500,'invalid_deployment_configuration');
  requireValue(env.TRACKING_SIGNERS_FILE === undefined && env.TRACKING_CURSOR_KEY_FILE === undefined,500,'ambiguous_secret_configuration');
  let parsed: unknown;try{parsed=JSON.parse(source);}catch{throw Error('invalid_deployment_configuration');}
  requireValue(Array.isArray(parsed) && parsed.length > 0 && parsed.length <= 32,500,'invalid_deployment_configuration');
  const ids=new Set<string>();
  const signers=parsed.map(raw => {
    const data=exactObject(raw,['keyId','tenant','key']);
    requireValue(typeof data.keyId === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(data.keyId) && !ids.has(data.keyId) && typeof data.tenant === 'string' && HEX.test(data.tenant) && typeof data.key === 'string' && /^[a-f0-9]{64,128}$/.test(data.key) && data.key.length % 2 === 0,500,'invalid_deployment_configuration');
    ids.add(data.keyId);return {keyId:data.keyId,tenant:data.tenant,key:data.key};
  });
  validateDatabaseDestination(database);
  function directory(path: string) {
    try{mkdirSync(path,{mode:0o700});}catch(error){if(!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'))throw Error('private_directory_unavailable');}
    const stat=lstatSync(path);requireValue(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0,500,'private_directory_required');
  }
  const privateRoot=join(dirname(database),'.collector-private');directory(privateRoot);const target=join(privateRoot,revision);directory(target);
  function file(name: string, bytes: Buffer) {
    const path=join(target,name);let fd: number;
    try {fd=openSync(path,'wx',0o600);}catch(error){
      if(!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'))throw Error('private_file_unavailable');
      const stat=lstatSync(path);requireValue(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.size <= 16384 && readFileSync(path).equals(bytes),500,'existing_secret_differs');
      return path;
    }
    try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
    return path;
  }
  // Both existing targets are checked before any new secret file is written.
  const expected=[['signers.json',Buffer.from(JSON.stringify(signers)+'\n')],['cursor.key',Buffer.from(cursor+'\n')]] as const;
  for(const [name,bytes] of expected){
    const path=join(target,name);try{const stat=lstatSync(path);requireValue(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.size <= 16384 && readFileSync(path).equals(bytes),500,'existing_secret_differs');}
    catch(error){if(!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))throw error;}
  }
  const [signerFile,cursorFile]=expected.map(([name,bytes])=>file(name,bytes));
  const result: NodeJS.ProcessEnv={...env,TRACKING_SIGNERS_FILE:signerFile,TRACKING_CURSOR_KEY_FILE:cursorFile};
  delete result.TRACKING_BOOTSTRAP_SIGNERS_JSON;delete result.TRACKING_BOOTSTRAP_CURSOR_KEY;
  return result;
}
export function startDeployment(env: NodeJS.ProcessEnv) { return startCollector(prepareDeploymentEnvironment(env)); }
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url){
  try{const running=startDeployment(process.env);process.once('SIGINT',running.close);process.once('SIGTERM',running.close);}
  catch{process.stderr.write('Collector deployment configuration failed. No secret values are logged.\n');process.exitCode=1;}
}
