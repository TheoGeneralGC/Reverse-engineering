/** Import first. Only numeric loopback ports owned by this test may connect. */
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
const marker = Symbol.for('rea.generated-cloud.network-denied');
const state = { attempts: 0, connections: 0, requests: 0, fetches: 0 };
Object.defineProperty(globalThis, marker, { value: state, writable: false });
const ports = new Set<number>();
export function allowGatewayPort(port: number): void { if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw Error('invalid_owned_port'); ports.add(port); }
export function closeGatewayPort(port: number): void { ports.delete(port); }
export function gatewayNetworkFacts() { return { ...state, remainingPorts: ports.size }; }
function deny(): never { state.attempts++; throw Error('auth_fixture_external_network_denied'); }
function destination(input: unknown, hostArgument?: unknown): void {
  let host: unknown, port: unknown;
  if (input instanceof URL || typeof input === 'string') {
    try { const url = input instanceof URL ? input : new URL(input); host = url.hostname; port = url.port; } catch { deny(); }
  } else if (typeof input === 'number') { port = input; host = hostArgument; }
  else if (input && typeof input === 'object') {
    const value = input as { hostname?: unknown; host?: unknown; port?: unknown; path?: unknown };
    host = value.hostname ?? value.host; port = value.port;
  }
  if (host !== '127.0.0.1' || !ports.has(Number(port))) deny();
}
const httpRequest = http.request, httpGet = http.get, connect = net.connect, connection = net.createConnection, fetcher = globalThis.fetch;
http.request = function (...args: unknown[]) { destination(args[0]); state.requests++; return Reflect.apply(httpRequest, http, args); } as typeof http.request;
http.get = function (...args: unknown[]) { destination(args[0]); state.requests++; return Reflect.apply(httpGet, http, args); } as typeof http.get;
net.connect = function (...args: unknown[]) { destination(args[0], args[1]); state.connections++; return Reflect.apply(connect, net, args); } as typeof net.connect;
net.createConnection = function (...args: unknown[]) { destination(args[0], args[1]); state.connections++; return Reflect.apply(connection, net, args); } as typeof net.createConnection;
https.request = deny; https.get = deny; tls.connect = deny;
globalThis.fetch = (async (input, init) => { destination(input instanceof Request ? input.url : input); state.fetches++; return fetcher(input, init); }) as typeof fetch;
syncBuiltinESMExports();
