import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDraftCache} from '../src/draft-cache.ts';
import type {Draft} from '../src/api.ts';
const accountIds=new Set(['one','two']);
const draft=(patch:Partial<Draft>={}):Draft=>({id:'draft',accountId:'one',to:'one@example.test',cc:'',bcc:'',subject:'Synthetic',body:'Original',status:'draft',updatedAt:'2026-10-28T12:00:00Z',...patch});
test('acknowledged creates/updates survive an older bootstrap while a later fresh bootstrap remains authoritative',()=>{
 const cache=createDraftCache(),before=cache.getRevision();cache.acknowledge(draft());cache.acknowledge(draft({body:'Latest',updatedAt:'2026-10-28T12:01:00Z'}));const rows=cache.overlay([],before,accountIds);assert.equal(rows.length,1);assert.equal(rows[0].body,'Latest');assert.deepEqual(cache.overlay([],cache.getRevision(),accountIds),[]);
});
test('sent/deleted tombstones prevent an old bootstrap or equal/older late ACK from resurrecting the draft',()=>{
 for(const removed of[false,true]){const cache=createDraftCache(),before=cache.getRevision(),record=draft();cache.acknowledge(record);cache.acknowledge(removed?record:{...record,status:'sent'},removed);assert.deepEqual(cache.overlay([record],before,accountIds),[]);assert.equal(cache.acknowledge(record),null);assert.equal(cache.acknowledge({...record,body:'Late PATCH',updatedAt:'2026-10-28T12:05:00Z'}),null);assert.deepEqual(cache.overlay([{...record,updatedAt:'2026-10-28T12:05:00Z'}],before,accountIds),[])}
});
test('cache updates remain account-isolated and ignore older acknowledgements',()=>{
 const cache=createDraftCache(),latest=draft({body:'Latest',updatedAt:'2026-10-28T12:01:00Z'}),change=cache.acknowledge(latest)!;assert.deepEqual(cache.apply([],change,new Set(['two'])),[]);assert.equal(cache.acknowledge(draft()),null);const other=draft({accountId:'two'});assert.deepEqual(cache.apply([other],change,accountIds),[other]);assert.deepEqual(cache.apply([latest],{...change,updatedAt:'2026-10-28T11:00:00Z',draft:draft()},accountIds),[latest]);
});
test('authoritative replacement clears cancelled scheduling metadata rather than merging obsolete fields',()=>{
 const cache=createDraftCache(),scheduled=draft({status:'scheduled',scheduledAt:'2026-10-29T12:00:00Z'}),change=cache.acknowledge(draft({updatedAt:'2026-10-28T12:01:00Z'}))!;const rows=cache.apply([scheduled],change,accountIds);assert.equal(rows[0].status,'draft');assert.equal(rows[0].scheduledAt,undefined);
});


test('an acknowledged deletion or send wins over an older editor timestamp and every later in-flight PATCH ACK',()=>{
 for(const removed of[false,true]){
  const cache=createDraftCache(),editor=draft(),saved=draft({body:'Acknowledged later save',updatedAt:'2026-10-28T12:01:00Z'});cache.acknowledge(editor);cache.acknowledge(saved);const tombstone=cache.acknowledge(removed?editor:{...editor,status:'sent'},removed);assert.ok(tombstone);const before=cache.getRevision();assert.equal(cache.acknowledge(draft({body:'Late PATCH',updatedAt:'2026-10-28T12:02:00Z'})),null);assert.deepEqual(cache.overlay([],before,accountIds),[]);assert.deepEqual(cache.apply([saved],tombstone,accountIds),[]);
 }
});
