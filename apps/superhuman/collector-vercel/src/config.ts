import { HEX, exactObject, requireValue } from '../../collector/src/protocol.ts';
export type RuntimeConfiguration = { origin: string; databaseUrl: string; authToken: string; signers: Map<string,{tenant:string;key:Buffer}>; cursorKey: Buffer };
const bounded = (v:unknown,max:number):v is string => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v) <= max && !/[\p{Surrogate}\u0000]/u.test(v);
/** No files, network, defaults, key generation or side effect. Validate all inputs before SDK construction. */
export function configuration(env: NodeJS.ProcessEnv): RuntimeConfiguration {
  const origin=env.TRACKING_PUBLIC_ORIGIN,db=env.TURSO_DATABASE_URL,token=env.TURSO_AUTH_TOKEN,signerText=env.TRACKING_SIGNERS_JSON,cursor=env.TRACKING_CURSOR_KEY;
  requireValue(bounded(origin,1024) && bounded(db,2048) && bounded(token,4096) && bounded(signerText,16384) && bounded(cursor,128),500,'invalid_key_configuration');
  let u:URL,d:URL;try{u=new URL(origin);d=new URL(db)}catch{throw Error('Collector configuration invalid')}
  requireValue(u.protocol==='https:' && u.origin===origin && !u.username && !u.password && !u.port && !/^(?:localhost|127\.|\[)/.test(u.hostname),500,'invalid_key_configuration');
  requireValue(['https:','libsql:'].includes(d.protocol) && db===`${d.protocol}//${d.hostname}` && /^[a-z0-9][a-z0-9-]*\.turso\.io$/.test(d.hostname) && !/[\s\p{Cc}\p{Cf}]/u.test(token),500,'invalid_key_configuration');
  requireValue(/^[a-f0-9]{64,128}$/.test(cursor) && cursor.length%2===0,500,'invalid_key_configuration');
  let raw:unknown;try{raw=JSON.parse(signerText)}catch{throw Error('Collector configuration invalid')}
  requireValue(Array.isArray(raw) && raw.length>0 && raw.length<=32,500,'invalid_key_configuration');
  const values:{id:string;tenant:string;key:string}[]=[];
  for(const item of raw){const s=exactObject(item,['keyId','tenant','key']);requireValue(typeof s.keyId==='string' && /^[A-Za-z0-9_-]{1,48}$/.test(s.keyId) && typeof s.tenant==='string' && HEX.test(s.tenant) && typeof s.key==='string' && /^[a-f0-9]{64,128}$/.test(s.key) && s.key.length%2===0 && !values.some(v=>v.id===s.keyId),500,'invalid_key_configuration');values.push({id:s.keyId,tenant:s.tenant,key:s.key});}
  return {origin,databaseUrl:db,authToken:token,signers:new Map(values.map(s=>[s.id,{tenant:s.tenant,key:Buffer.from(s.key,'hex')}])),cursorKey:Buffer.from(cursor,'hex')};
}
