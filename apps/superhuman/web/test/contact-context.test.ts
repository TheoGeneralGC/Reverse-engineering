import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactEmailKey,messageContact } from '../src/contact-context.ts';
import type { Thread } from '../src/api.ts';
const self={name:'Author',email:'self@example.test'},other={name:'Other',email:'other@example.test'},cc={name:'Cc',email:'cc@example.test'};
function message(sender=self,to=[self],extras:Partial<Thread['messages'][number]>={}):Thread['messages'][number]{return{id:'message',sender,to,date:'2026-10-28T12:00:00Z',text:'Synthetic',attachments:[],...extras}}
test('opened incoming message chooses sender; authored message chooses a nonself To or Cc before self fallback',()=>{
 assert.deepEqual(messageContact(message(other),self.email),other);assert.deepEqual(messageContact(message(self,[self,other]),self.email),other);assert.deepEqual(messageContact(message(self,[self],{cc:[cc]}),self.email),cc);assert.deepEqual(messageContact(message(),self.email),self);assert.deepEqual(messageContact(message({...self,email:'SELF@example.test'},[other]),self.email),other);
});
test('contact response identity normalization matches local NFKC/case/IDNA metadata policy',()=>{
 assert.equal(contactEmailKey('  ＯＮＥ@BÜCHER.example  '),'one@xn--bcher-kva.example');assert.equal(contactEmailKey('One@EXAMPLE.TEST'),contactEmailKey('one@example.test'));assert.equal(contactEmailKey('unfinished@'),'unfinished@');for(const [raw,key]of[['person@12.34','person@12.34'],['person@01.2.3.4','person@01.2.3.4'],['person@123','person@123'],['person@12。34','person@12.34'],['person@bücher.12.34','person@xn--bcher-kva.12.34'],['person@bücher。example','person@xn--bcher-kva.example'],['person@example。test','person@example.test']])assert.equal(contactEmailKey(raw),key);assert.notEqual(contactEmailKey('person@12.34'),contactEmailKey('person@12.0.0.34'));
});

test('local metadata can fill an empty contact name, preserves authored names and projects only four summary fields',async()=>{
 const {createContactContext}=await import('../src/contact-context.ts');const settle=async()=>{await Promise.resolve();await Promise.resolve()};
 for(const authored of['','Authored display']){
  const model=createContactContext({request:async()=>({contact:{name:'Imported display',email:'one@example.test'},matched:true,limited:true,source:'local-message-participants',threads:[{id:'recent',accountId:'account',subject:'Synthetic',lastMessageAt:'2026-10-28T12:00:00Z',messages:[{text:'Must not be retained'}],body:'Must not be retained'}]})});
  model.setContext({accountId:'account',draftId:null,threadId:null,mode:'mail'});model.select({name:authored,email:'one@example.test'},'commit');const before=model.getSelectionRevision();await settle();assert.equal(model.getSnapshot().contact?.name,authored||'Imported display');assert.equal(model.getSelectionRevision(),before);assert.deepEqual(Object.keys(model.getSnapshot().threads[0]),['id','accountId','subject','lastMessageAt']);model.dispose();
 }
});

test('browser and API contact keys agree on numeric DNS labels, Unicode separators and per-label IDNA',async()=>{
 const {normalizeContactEmail}=await import('../../api/src/contacts.ts');
 for(const raw of['person@12.34','person@12.0.0.34','person@01.2.3.4','person@123','person@12。34','person@bücher.12.34','person@bücher。example','person@example。test','person@BÜCHER.example','person@😀.example'])assert.equal(contactEmailKey(raw),normalizeContactEmail(raw),raw);
});
