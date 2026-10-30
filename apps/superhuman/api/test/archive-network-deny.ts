/** Test-only entrypoint. Import FIRST, before application/provider dependencies.
 * Node's default test runner isolates files, so unrelated TCP tests do not load
 * this module. An external preload can install the same state first. */
import {syncBuiltinESMExports} from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
const key=Symbol.for('rea.generated-cloud.network-denied');
type Denial={attempts:number};
const global=globalThis as typeof globalThis&{[key: symbol]:Denial|undefined};
if(global[key]===undefined){
 const state:Denial={attempts:0};
 const deny=():never=>{state.attempts++;throw Error('synthetic_control_native_network_denied')};
 globalThis.fetch=deny;
 http.request=deny;http.get=deny;https.request=deny;https.get=deny;
 net.connect=deny;net.createConnection=deny;tls.connect=deny;
 syncBuiltinESMExports();
 Object.defineProperty(globalThis,key,{value:state,writable:false});
}else if(!Number.isSafeInteger(global[key]?.attempts)||global[key]!.attempts<0)throw Error('invalid_test_denial_preload');
