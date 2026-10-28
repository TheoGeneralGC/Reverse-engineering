// Reusable pre-dispatch timing primitives; no account queue or provider IO.
export type DeliveryClock = { now: () => number; schedule: (callback: () => void, delayMs: number) => { cancel: () => void } };
export function deliveryDeadline(now: number, delayMs: number): string {
  if (!Number.isFinite(now) || !Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 60_000) throw new TypeError('Delivery delay must be 0..60000 milliseconds');
  return new Date(now + delayMs).toISOString();
}
export const beforeDeliveryDeadline = (deadline: string, now: number) => Number.isFinite(Date.parse(deadline)) && now < Date.parse(deadline);
export const atOrAfterDeliveryDeadline = (deadline: string, now: number) => Number.isFinite(Date.parse(deadline)) && now >= Date.parse(deadline);
export function waitForDeliveryDeadline(deadline: string, clock: DeliveryClock, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: { cancel: () => void } | undefined;
    const finish = (error?: unknown) => { timer?.cancel(); signal.removeEventListener('abort', abort); error === undefined ? resolve() : reject(error); };
    const abort = () => finish(signal.reason ?? new Error('Delivery wait stopped'));
    const check = () => { if (signal.aborted) return abort(); const remaining = Date.parse(deadline) - clock.now(); if (!Number.isFinite(remaining)) return finish(new TypeError('Invalid delivery deadline')); if (remaining <= 0) return finish(); timer = clock.schedule(check, remaining); };
    signal.addEventListener('abort', abort, { once: true }); check();
  });
}

// Re-read only a durable effective deadline. An explicit control can wake the
// existing waiter without turning it into cancellation or another dispatch.
export function waitForMutableDeliveryDeadline(readDeadline:()=>string,clock:DeliveryClock,signal:AbortSignal):{promise:Promise<void>;wake:()=>void}{
 let wake=()=>{};
 const promise=new Promise<void>((resolve,reject)=>{
  let timer:{cancel:()=>void}|undefined,settled=false;
  const finish=(error?:unknown)=>{if(settled)return;settled=true;timer?.cancel();signal.removeEventListener('abort',abort);error===undefined?resolve():reject(error)};
  const abort=()=>finish(signal.reason??new Error('Delivery wait stopped'));
  const check=()=>{if(settled)return;timer?.cancel();if(signal.aborted)return abort();try{const remaining=Date.parse(readDeadline())-clock.now();if(!Number.isFinite(remaining))return finish(new TypeError('Invalid delivery deadline'));if(remaining<=0)return finish();timer=clock.schedule(check,remaining)}catch(error){finish(error)}};
  wake=check;signal.addEventListener('abort',abort,{once:true});check();
 });return{promise,wake:()=>wake()};
}
