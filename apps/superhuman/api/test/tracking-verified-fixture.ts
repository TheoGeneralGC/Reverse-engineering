import{TrackingCollectorClient,type CollectorConfiguration}from'../src/tracking-collector.ts';
/** Synthetic operator evidence only; never loads an actual signer or origin. */
export function verifiedCollectorFixture<T extends CollectorConfiguration>(configuration:T):T{
 const client=new TrackingCollectorClient(configuration),configurationFingerprint=client.capability().configurationFingerprint;client.close();const collectorSourceIdentity='5'.repeat(64);
 return{...configuration,collectorSourceIdentity,operatorVerification:{version:1,configurationFingerprint,origin:configuration.origin,collectorSourceIdentity,verifiedAt:new Date(configuration.now?.()??Date.now()).toISOString(),evidenceDigest:'6'.repeat(64)}};
}
