/** Server-only operator evidence. No probes, files or HTTP permission protocol. */
export type TrackingOperatorVerification={version:1;configurationFingerprint:string;origin:string;collectorSourceIdentity:string;verifiedAt:string;evidenceDigest:string};
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function parseTrackingOperatorVerification(raw:unknown):TrackingOperatorVerification{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='collectorSourceIdentity,configurationFingerprint,evidenceDigest,origin,verifiedAt,version')throw new TypeError('Invalid tracking operator verification');
 const v=raw as TrackingOperatorVerification;let origin:string,time:string;try{origin=new URL(v.origin).origin;time=new Date(v.verifiedAt).toISOString()}catch{throw new TypeError('Invalid tracking operator verification')}
 if(v.version!==1||!hex(v.configurationFingerprint)||!hex(v.collectorSourceIdentity)||!hex(v.evidenceDigest)||origin!==v.origin||!v.origin.startsWith('https://')||time!==v.verifiedAt)throw new TypeError('Invalid tracking operator verification');return structuredClone(v);
}
export function matchedTrackingOperatorVerification(record:TrackingOperatorVerification|undefined,current:{origin:string;configurationFingerprint:string;collectorSourceIdentity?:string;now:number}):boolean{
 return !!record&&Number.isSafeInteger(current.now)&&current.now>=0&&Date.parse(record.verifiedAt)<=current.now&&record.origin===current.origin&&record.configurationFingerprint===current.configurationFingerprint&&record.collectorSourceIdentity===current.collectorSourceIdentity;
}
