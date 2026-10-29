import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { composerValueFromHTML,normalizeComposerLink,plainTextToComposerHTML,sanitizeComposerFragment } from '../src/composer-html.ts';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://composer.example.test'});
const window=dom.window;
for(const key of ['window','document','navigator','Node','DocumentFragment','CharacterData','Event','CustomEvent','HTMLOListElement','Text','Element','HTMLElement','Range','Selection','MutationObserver','NodeFilter','DOMParser','HTMLAnchorElement','HTMLBRElement','HTMLDivElement','HTMLSpanElement','HTMLLIElement','HTMLInputElement','HTMLImageElement','KeyboardEvent','InputEvent','DOMRect','getComputedStyle'])Object.defineProperty(globalThis,key,{configurable:true,value:window[key as keyof typeof window]});
window.Range.prototype.getBoundingClientRect=()=>new window.DOMRect();
window.Range.prototype.getClientRects=()=>Object.assign([],{item:()=>null}) as unknown as DOMRectList;
const {createComposerEditor}=await import('../src/composer-editor.ts');
function editor(body='Hello world'){
 const root=window.document.createElement('div');window.document.body.append(root);const changes:{body:string;html:string}[]=[];
 const controller=createComposerEditor(root,{body},value=>changes.push(value));
 const selectAll=()=>{const range=window.document.createRange();range.selectNodeContents(root);controller.editor.setSelection(range)};
 const close=()=>{controller.destroy();root.remove()};return{root,controller,changes,selectAll,close};
}

test('rich HTML keeps formatting while dropping scripts, events, remote images and unsafe CSS/links',()=>{
 const value=composerValueFromHTML('<div onclick="bad()"><b>Hello</b> <i>world</i><img src="https://remote.test/pixel"><script>bad()</script><a href="javascript:alert(1)">unsafe</a><a href="https://example.test">safe</a><span style="color:#ff0000;background-image:url(https://remote.test/pixel);position:fixed">red</span></div>',window.document);
 assert.match(value.html,/<b>Hello<\/b>/);assert.match(value.html,/<i>world<\/i>/);assert.match(value.html,/color: ?(?:rgb\(255, 0, 0\)|#ff0000)/);
 assert.doesNotMatch(value.html,/script|onclick|<img|javascript:|position|background-image|remote\.test/);assert.match(value.html,/rel="noopener noreferrer"/);assert.equal(value.body,'Hello worldunsafesafered');
});

test('plain text conversion preserves newlines and escapes markup instead of interpreting it',()=>{
 const body='Hello <team> & friends\n\nThanks';const html=plainTextToComposerHTML(body);
 assert.match(html,/&lt;team&gt;/);assert.equal(composerValueFromHTML(html,window.document).body,body);
 assert.equal(composerValueFromHTML('<div><br></div>',window.document).body,'');
});

test('link normalization accepts ordinary destinations and rejects executable and relative URLs',()=>{
 assert.equal(normalizeComposerLink('https://example.test/path'),'https://example.test/path');
 assert.equal(normalizeComposerLink('www.example.test'),'https://www.example.test/');
 assert.equal(normalizeComposerLink('alex@example.test'),'mailto:alex@example.test');
 for(const url of ['javascript:alert(1)','data:text/html,bad','//example.test','/relative','https://example.test\nInjected'])assert.equal(normalizeComposerLink(url),null);
});

test('Squire selection formatting and undo/redo preserve both HTML and plain body',()=>{
 const e=editor();try{
  e.selectAll();e.controller.run('bold');assert.match(e.controller.getValue().html,/<b>Hello world<\/b>/i);assert.equal(e.controller.getValue().body,'Hello world');
  e.controller.run('undo');assert.doesNotMatch(e.controller.getValue().html,/<b>/i);e.controller.run('redo');assert.match(e.controller.getValue().html,/<b>/i);
  assert.ok(e.changes.length>0);
 }finally{e.close()}
});

test('snippet insertion replaces selection at the caret and can be undone',()=>{
 const e=editor('Hello world');try{
  const text=e.root.querySelector('div')!.firstChild!;const range=window.document.createRange();range.setStart(text,6);range.setEnd(text,11);e.controller.editor.setSelection(range);e.controller.insertText('Alex');
  assert.equal(e.controller.getValue().body,'Hello Alex');e.controller.run('undo');assert.equal(e.controller.getValue().body,'Hello world');
 }finally{e.close()}
});

test('list/quote commands produce semantic HTML and maintain a usable plain alternative',()=>{
 const e=editor('First\nSecond');try{
  e.selectAll();e.controller.run('bullets');assert.match(e.controller.getValue().html,/<ul>/i);assert.equal(e.controller.getValue().body.trimEnd(),'First\nSecond');
  e.controller.run('quote');assert.match(e.controller.getValue().html,/<blockquote>/i);e.controller.run('unquote');assert.doesNotMatch(e.controller.getValue().html,/<blockquote>/i);
 }finally{e.close()}
});

test('external metadata rerenders do not reset formatting or undo history, while AI replacement remains undoable',()=>{
 const e=editor();try{
  e.selectAll();e.controller.run('italic');const value=e.controller.getValue();e.controller.update(value);assert.match(e.controller.getValue().html,/<i>/i);
  e.controller.replaceText('A replacement');assert.equal(e.controller.getValue().body,'A replacement');e.controller.run('undo');assert.equal(e.controller.getValue().body,'Hello world');assert.match(e.controller.getValue().html,/<i>/i);
 }finally{e.close()}
});

test('Squire HTML paste uses the same sanitized fragment boundary and cannot retain active content',()=>{
 const e=editor('');try{
  e.controller.editor.insertHTML('<div><strong>Pasted</strong><iframe src="https://remote.test"></iframe><a href="data:text/html,bad">text</a></div>',true);e.controller.publish();
  const value=e.controller.getValue();assert.match(value.html,/<b>Pasted<\/b>/i);assert.doesNotMatch(value.html,/iframe|data:|remote\.test/);assert.equal(value.body,'Pastedtext');
  assert.equal(sanitizeComposerFragment('<img src=x onerror=bad()>',window.document).childNodes.length,0);
 }finally{e.close()}
});

test('read-only delivery states ignore formatting, insertion and replacement',()=>{
 const e=editor();try{e.root.contentEditable='false';e.selectAll();e.controller.run('bold');e.controller.insertText('unexpected');e.controller.replaceText('unexpected');assert.equal(e.controller.getValue().body,'Hello world');assert.doesNotMatch(e.controller.getValue().html,/<b>/i)}finally{e.close()}
});


test('link creation and observed palette colors survive edit serialization and undo',()=>{
 const e=editor('Linked text');try{
  e.selectAll();e.controller.makeLink('https://example.test/reference');assert.match(e.controller.getValue().html,/<a [^>]*href="https:\/\/example\.test\/reference"[^>]*>Linked text<\/a>/i);
  e.controller.run('undo');assert.doesNotMatch(e.controller.getValue().html,/<a /i);e.controller.run('redo');assert.match(e.controller.getValue().html,/<a /i);
  e.selectAll();e.controller.setTextColor('rgb(92, 186, 135)');assert.match(e.controller.getValue().html,/color: ?rgb\(92, 186, 135\)/i);assert.equal(e.controller.getValue().body,'Linked text');
  e.controller.setTextColor(null);assert.doesNotMatch(e.controller.getValue().html,/color:/i);
 }finally{e.close()}
});

test('paste preserves safe list numbering and agreed styles without broadening the server contract',()=>{
 const value=composerValueFromHTML('<ol start="4"><li><span style="font-family:Arial;line-height:2;margin-left:120px">Fourth</span></li></ol><span style="font-family:made-up;line-height:4">Unsafe style</span>',window.document);
 assert.match(value.html,/<ol start="4">/);assert.match(value.html,/font-family: ?Arial/);assert.match(value.html,/line-height: ?2/);assert.match(value.html,/margin-left: ?120px/);assert.doesNotMatch(value.html,/made-up|line-height: ?4/);
 assert.doesNotMatch(composerValueFromHTML('<ol start="-2"><li>test</li></ol><div start="3">x</div>',window.document).html,/start=/);
});

test('AI replaces only the retained selection, keeps surrounding formatting and supports undo and redo',()=>{
 const e=editor('');try{
  e.controller.update({body:'Before selected passage after',html:'<div><b>Before </b>selected passage<i> after</i></div>'});
  const text=e.root.querySelector('div')!.childNodes[1],range=window.document.createRange();range.selectNodeContents(text);e.controller.editor.setSelection(range);
  const target=e.controller.captureRewriteTarget();assert.equal(target.text,'selected passage');
  const result=e.controller.applyRewrite('New first line\nNew second line',target);assert.equal(result.text,'New first line\nNew second line');
  const value=e.controller.getValue();assert.equal(value.body,'Before New first line\nNew second line after');assert.match(value.html,/<b>Before /);assert.match(value.html,/<i> after<\/i>/);
  e.controller.run('undo');assert.equal(e.controller.getValue().body,'Before selected passage after');e.controller.run('redo');assert.equal(e.controller.getValue().body,value.body);
 }finally{e.close()}
});

test('successive AI results target their current replacement and never grow into neighboring paragraphs',()=>{
 const e=editor('Prefix\nOriginal selection\nSuffix');try{
  const range=window.document.createRange();range.selectNodeContents(e.root.children[1]);e.controller.editor.setSelection(range);
  const first=e.controller.applyRewrite('Replacement\nWith two lines',e.controller.captureRewriteTarget());
  assert.equal(first.text,'Replacement\nWith two lines');
  const second=e.controller.applyRewrite('Shorter',first);assert.equal(second.text,'Shorter');assert.equal(e.controller.getValue().body,'Prefix\nShorter\nSuffix');
 }finally{e.close()}
});

test('late AI output cannot overwrite a newer user edit or an externally loaded draft',()=>{
 const e=editor();try{
  e.selectAll();const target=e.controller.captureRewriteTarget();e.controller.insertText('My newer edit');assert.throws(()=>e.controller.applyRewrite('Late AI text',target),/draft changed/);assert.equal(e.controller.getValue().body,'My newer edit');
  const next=e.controller.captureRewriteTarget();e.controller.update({body:'A separately loaded version'});assert.throws(()=>e.controller.applyRewrite('Late AI text',next),/draft changed/);assert.equal(e.controller.getValue().body,'A separately loaded version');
 }finally{e.close()}
});

test('delivery locks and a detached editor reject an AI result without modifying draft text',()=>{
 const e=editor();try{
  e.selectAll();const target=e.controller.captureRewriteTarget();e.root.contentEditable='false';assert.throws(()=>e.controller.applyRewrite('Late AI text',target),/delivery is pending/);assert.equal(e.controller.getValue().body,'Hello world');
  e.root.contentEditable='true';const other=editor();try{assert.throws(()=>other.controller.applyRewrite('Wrong draft',target),/draft changed/);assert.equal(other.controller.getValue().body,'Hello world')}finally{other.close()}
 }finally{e.close()}
});

test('AI can write into an empty body and the returned selection remains usable',()=>{
 const e=editor('');try{const result=e.controller.applyRewrite('Hello\n\nThanks',e.controller.captureRewriteTarget());assert.equal(e.controller.getValue().body,'Hello\n\nThanks');assert.equal(result.text,'Hello\n\nThanks')}finally{e.close()}
});

test('proved inline quote projection keeps full serialization and reveals once without publishing a body edit',async()=>{
 const{composeAutoDraftReply}=await import('../../api/src/auto-drafts-reply-quote.ts'),reply='Confirmed <literal>.',source={id:'fictional',sender:{name:'Cedar Sender',email:'sender@example.test'},to:[],date:'2026-10-29T16:00:00.000Z',text:'First line\nSecond line',attachments:[]},value=composeAutoDraftReply(source,reply,'America/Los_Angeles'),quote=value.body.slice(reply.length+2),root=window.document.createElement('div');window.document.body.append(root);const changes:unknown[]=[];const current=createComposerEditor(root,value,v=>changes.push(v));try{
  const before=current.getValue();assert.equal(current.collapseQuotedBody({reply,quote}),true);assert.equal(root.querySelectorAll('[data-auto-draft-quote-hidden]').length,3);assert.deepEqual(current.getValue(),before);assert.doesNotMatch(current.getValue().html,/data-auto|aria-hidden|contenteditable/);current.update(value);assert.equal(changes.length,0);
  const originalTail=root.lastElementChild,range=window.document.createRange();range.selectNodeContents(root.firstElementChild!);current.editor.setSelection(range);current.run('bold');current.run('undo');assert.notEqual(root.lastElementChild,originalTail);assert.equal(root.querySelectorAll('[data-auto-draft-quote-hidden]').length,3);current.run('redo');assert.equal(root.querySelectorAll('[data-auto-draft-quote-hidden]').length,3);current.run('undo');
  const next={body:value.body.replace(reply,'A newer human reply.'),html:value.html.replace('Confirmed &lt;literal&gt;.','A newer human reply.')};current.update(next);assert.equal(root.querySelectorAll('[data-auto-draft-quote-hidden]').length,3);assert.match(current.getValue().body,/A newer human reply/);assert.doesNotMatch(current.getValue().html,/data-auto|aria-hidden|contenteditable/);
  const beforeExpand=current.getValue(),published=changes.length;assert.equal(current.expandQuotedBody(),true);assert.equal(current.expandQuotedBody(),false);assert.equal(root.querySelector('[data-auto-draft-quote-hidden]'),null);assert.deepEqual(current.getValue(),beforeExpand);assert.equal(changes.length,published);assert.equal(window.document.activeElement,root);
 }finally{current.destroy();root.remove()}
});
test('quote presentation cannot hide ambiguous or mismatched authored regions',()=>{
 const variants=['<div>Reply</div><div>On Tuesday, Sender wrote:</div><blockquote>Different source</blockquote>','<div>Reply</div><div>On Tuesday, Sender wrote:</div><blockquote><blockquote>Exact source</blockquote></blockquote>','<div>Unrelated reply</div><div>On Tuesday, Sender wrote:</div><blockquote>Exact source</blockquote>'];for(const html of variants){const root=window.document.createElement('div');window.document.body.append(root);const current=createComposerEditor(root,{body:'',html},()=>{});try{const before=current.getValue();assert.equal(current.collapseQuotedBody({reply:'Reply',quote:'On Tuesday, Sender wrote:\n> Exact source'}),false);assert.equal(root.querySelector('[data-auto-draft-quote-hidden]'),null);assert.deepEqual(current.getValue(),before)}finally{current.destroy();root.remove()}}
});
