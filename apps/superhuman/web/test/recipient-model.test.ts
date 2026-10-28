import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecipientModel,formatRecipient,parseRecipient,recipientLabel,splitRecipientText } from '../src/recipient-model.ts';
const empty={to:'',cc:'',bcc:''};

test('authored parser preserves quoted commas/escapes, distinct display names and invalid text without executing content',()=>{
 const raw='"REA, One" <one@example.test>, "REA \\"Two\\"" <two@example.test>';
 const tokens=splitRecipientText(raw).map(parseRecipient);assert.equal(tokens.length,2);assert.equal(tokens[0].name,'REA, One');assert.equal(tokens[0].email,'one@example.test');assert.equal(tokens[0].valid,true);assert.equal(tokens[1].name,'REA "Two"');assert.equal(formatRecipient(tokens[1]),'"REA \\"Two\\"" <two@example.test>');assert.equal(parseRecipient('not-an-address,').valid,false);
});

test('unfinished append and existing-chip edits are present in synchronous snapshots before commit',()=>{
 const model=createRecipientModel({to:'one@example.test',cc:'cc@example.test',bcc:''});model.input('to','unfinished');assert.equal(model.getValue().to,'one@example.test, unfinished');model.commit('to');model.select('to',0);model.edit('to');model.input('to','Replacement <new@example.test>');assert.equal(model.getValue().to,'Replacement <new@example.test>, unfinished');assert.equal(model.getValue().cc,'cc@example.test');
});

test('existing chip replacement stays selected while append commits advance to an empty input position',()=>{
 const model=createRecipientModel(empty);model.input('to','one@example.test');model.commit('to');assert.deepEqual(model.getState().fields.to.selected,[]);model.select('to',0);model.edit('to');model.input('to','two@example.test');model.commit('to');const field=model.getState().fields.to;assert.deepEqual(field.selected,[0]);assert.equal(field.editing,null);assert.equal(field.input,'');assert.equal(model.getValue().to,'two@example.test');
});

test('exact same-field additions dedupe but case variants and cross-field recipients remain distinct',()=>{
 const model=createRecipientModel(empty);for(const value of ['same@example.test','same@example.test','SAME@example.test']){model.input('to',value);model.commit('to')}model.input('cc','same@example.test');model.commit('cc');assert.equal(model.getState().fields.to.tokens.length,2);assert.equal(model.getValue().to,'same@example.test, SAME@example.test');assert.equal(model.getValue().cc,'same@example.test');
});

test('empty Backspace removal targets previous chip or emptied edited chip without deleting an unrelated recipient',()=>{
 const model=createRecipientModel({to:'one@example.test, two@example.test, three@example.test',cc:'',bcc:''});model.remove('to');assert.equal(model.getValue().to,'one@example.test, two@example.test');assert.deepEqual(model.getState().fields.to.selected,[1]);model.select('to',0);model.edit('to');model.input('to','');model.remove('to');assert.equal(model.getValue().to,'two@example.test');
});

test('recipient moves are atomic across fields and local undo/redo restores the complete header state',()=>{
 const model=createRecipientModel({to:'one@example.test, two@example.test',cc:'cc@example.test',bcc:''});model.select('to',0);model.move('to',1);assert.deepEqual(model.getValue(),{to:'two@example.test',cc:'cc@example.test, one@example.test',bcc:''});assert.equal(model.getState().active,'cc');model.undo();assert.equal(model.getValue().to,'one@example.test, two@example.test');assert.equal(model.getValue().cc,'cc@example.test');model.redo();assert.equal(model.getValue().cc,'cc@example.test, one@example.test');
});

test('paste splits bare separators, keeps quoted names and trailing invalid text, and replaces selected chips',()=>{
 const model=createRecipientModel({to:'old@example.test',cc:'',bcc:''});model.select('to',0);model.paste('to','mailto:one@example.test; two@example.test\nunfinished');assert.equal(model.getState().fields.to.tokens.length,2);assert.equal(model.getState().fields.to.input,'unfinished');assert.equal(model.getValue().to,'one@example.test, two@example.test, unfinished');model.commit('to');model.append('cc');model.paste('cc','"REA, Two" <two@example.test>, Three <three@example.test>');assert.equal(model.getState().fields.cc.tokens[0].name,'REA, Two');assert.equal(model.getValue().cc,'"REA, Two" <two@example.test>, Three <three@example.test>');
});

test('selection arrows enter and leave the trailing input position and support range copy',()=>{
 const model=createRecipientModel({to:'one@example.test, two@example.test',cc:'',bcc:''});model.arrow('to',-1);assert.deepEqual(model.getState().fields.to.selected,[1]);model.arrow('to',-1,true);assert.equal(model.selectedText('to'),'one@example.test, two@example.test');model.arrow('to',1);assert.deepEqual(model.getState().fields.to.selected,[1]);model.arrow('to',1);assert.deepEqual(model.getState().fields.to.selected,[]);
});

test('read-only model rejects edit, commit, paste, remove, move and history mutation while retaining its snapshot',()=>{
 const model=createRecipientModel({to:'one@example.test',cc:'',bcc:''});model.select('to',0);model.setLocked(true);for(const action of [()=>model.input('to','changed'),()=>model.commit('to',{name:'Other',email:'other@example.test'}),()=>model.paste('to','other@example.test'),()=>model.remove('to'),()=>model.move('to',1),()=>model.edit('to'),()=>model.undo(),()=>model.redo()])action();assert.deepEqual(model.getValue(),{to:'one@example.test',cc:'',bcc:''});
});

test('invalid literal punctuation survives scalar draft serialization and reopening',()=>{
 const model=createRecipientModel(empty);model.input('to','name-only,');model.commit('to');assert.equal(model.getValue().to,JSON.stringify('name-only,'));assert.equal(createRecipientModel(model.getValue()).getState().fields.to.tokens[0].raw,'name-only,');
});

test('observed move deduplicates destination while recipient delete undo and redo leave the other field intact',()=>{
 const model=createRecipientModel({to:'same@example.test, SAME@example.test',cc:'same@example.test',bcc:''});model.select('to',0);model.move('to',1);assert.equal(model.getState().fields.to.tokens.length,1);assert.equal(model.getState().fields.cc.tokens.length,1);model.selectAll('cc');model.remove('cc');assert.equal(model.getValue().cc,'');model.undo();assert.equal(model.getValue().cc,'same@example.test');model.redo();assert.equal(model.getValue().cc,'');assert.equal(model.getValue().to,'SAME@example.test');
});

test('observed simple comma-name presentation reorders display while preserving raw authored headers and case',()=>{
 const contact=parseRecipient('"REA, Two" <REA-TWO@example.test>');assert.equal(recipientLabel(contact),'Two REA');assert.equal(contact.raw,'"REA, Two" <REA-TWO@example.test>');assert.equal(recipientLabel(parseRecipient('REA Three <three@example.test>')),'REA Three');assert.equal(recipientLabel(parseRecipient('REA-ONE@example.test')),'rea-one@example.test');assert.equal(recipientLabel(parseRecipient('rea-invalid@')),'rea-invalid@');
});

test('distinct invalid name fragments without an email address are not deduplicated by inner bracket text',()=>{
 const model=createRecipientModel(empty);for(const raw of ['One <unfinished>','Two <unfinished>']){model.input('to',raw);model.commit('to')}assert.equal(model.getState().fields.to.tokens.length,2);const reopened=createRecipientModel(model.getValue());assert.deepEqual(reopened.getState().fields.to.tokens.map(token=>token.raw),['One <unfinished>','Two <unfinished>']);
});

test('delivery validation examines unfinished edits and all fields, rejects controls, and allows a Cc-only message',()=>{
 const model=createRecipientModel(empty);assert.equal(model.validate().valid,false);model.input('cc','good@example.test');assert.equal(model.validate().valid,true);model.input('to','not-an-address');assert.deepEqual(model.validate(),{valid:false,hasRecipients:true,field:'to'});model.input('to','');model.input('bcc','Name\u0000 <good@example.test>');assert.equal(model.validate().valid,false);assert.equal(parseRecipient('Name\u0000 <good@example.test>').valid,false);
});

test('shared outgoing preflight rejects unsupported address grammar, sizes and Unicode without changing chip presentation or raw text',()=>{
 const unsupported=['a..b@example.test','a@-example.test','a@example-.test','é@example.test','a@exämple.test','a'.repeat(65)+'@example.test','a@'+('a'.repeat(63)+'.').repeat(4)+'test'];
 for(const address of unsupported){const model=createRecipientModel(empty);model.input('to',address);model.commit('to');assert.equal(model.getState().fields.to.tokens[0].valid,true,'retain the existing chip display classification');assert.equal(model.validate().valid,false,address);assert.match(model.validate().message||'',/unsupported/);assert.equal(model.getValue().to,address)}
 const controls=createRecipientModel({to:'Name\u200d <good@example.test>',cc:'',bcc:''});assert.equal(controls.validate().valid,false);
 const many=createRecipientModel({to:Array.from({length:201},(_,i)=>'person'+i+'@example.test').join(', '),cc:'',bcc:''});assert.equal(many.validate().valid,false);
 const longName=createRecipientModel({to:'"'+('N'.repeat(513))+'" <good@example.test>',cc:'',bcc:''});assert.equal(longName.validate().valid,false);
});

test('unsupported raw display-name/list syntax cannot become sendable through canonical formatting and reopening',()=>{
 const raw='not-an-address, "O\\"Neil" <good@example.test>',model=createRecipientModel(empty);model.input('to',raw);model.commit('to');assert.equal(model.validate().valid,false);const reopened=createRecipientModel(model.getValue());assert.equal(reopened.validate().valid,false);assert.equal(reopened.getState().fields.to.tokens[0].raw,raw);
 const valid=createRecipientModel({to:'"A, B\\"C" <good@example.test>',cc:'',bcc:''});assert.equal(valid.validate().valid,true);assert.equal(valid.getValue().to,'"A, B\\"C" <good@example.test>');
});
