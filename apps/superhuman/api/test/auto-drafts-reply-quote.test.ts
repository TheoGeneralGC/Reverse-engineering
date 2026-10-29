import test from 'node:test';
import assert from 'node:assert/strict';
import {composeAutoDraftReply,projectAutoDraftSourceText,REPLY_QUOTE_LIMITS} from '../src/auto-drafts-reply-quote.ts';
import {plainTextFromHtml} from '../src/rich-text.ts';
import type {Message} from '../src/types.ts';
const source=(change:Partial<Message>={}):Message=>({id:'own-source',sender:{name:'Cedar Sender',email:'sender@example.test'},to:[{name:'Synthetic Self',email:'self@example.test'}],date:'2026-10-29T12:19:37.419Z',text:'Could you confirm Thursday at 3 pm in Room Maple?\nReference: Cedar &amp; <approved> "A".',attachments:[],internetMessageId:'<source@example.test>',references:'<earlier@example.test>',...change});
const invalid=(e:unknown)=>(e as {code?:string}).code==='auto_draft_reply_quote_invalid';
const over=(e:unknown)=>(e as {code?:string}).code==='auto_draft_reply_quote_limit';

test('reconstructs visible dated sender attribution and quoted source without altering the immutable snapshot',()=>{
 const message=source(),before=JSON.stringify(message);Object.freeze(message.sender);Object.freeze(message.to);Object.freeze(message.attachments);Object.freeze(message);
 const result=composeAutoDraftReply(message,'Confirmed, thanks. Both work for me.','America/Los_Angeles');
 assert.equal(result.body,'Confirmed, thanks. Both work for me.\n\nOn Thu, Oct 29, 2026 at 5:19 AM, Cedar Sender <sender@example.test> wrote:\n> Could you confirm Thursday at 3 pm in Room Maple?\n> Reference: Cedar &amp; <approved> "A".');
 assert.equal(result.html.includes('<blockquote>'),true);assert.equal(result.html.includes('Reference: Cedar &amp;amp; &lt;approved&gt;'),true);assert.equal(JSON.stringify(message),before);assert.equal(Object.isFrozen(result),true);
 const tricky='Reply 😀\nOn a model-authored line wrote:\n> literal';const bounded=composeAutoDraftReply(message,tricky,'UTC');assert.equal(bounded.quotedBody.quoteStartUtf8,Buffer.byteLength(tricky)+2);assert.equal(Buffer.from(bounded.body).subarray(0,bounded.quotedBody.quoteStartUtf8-2).toString('utf8'),tricky);assert.equal(Buffer.from(bounded.body).subarray(bounded.quotedBody.quoteStartUtf8).toString('utf8').startsWith('On Thu, Oct 29, 2026 at 12:19 PM,'),true);assert.equal(Object.isFrozen(bounded.quotedBody),true);
});

test('authored reply and hostile sender markup remain literal text with no active HTML or header reinterpretation',()=>{
 const reply='<img src="https://pixel.invalid/x" onerror="bad()"> &lt;script&gt;\nLine 2',message=source({sender:{name:'<script>Literal & "Sender"</script>',email:'sender@example.test'}}),result=composeAutoDraftReply(message,reply,'UTC');
 assert.equal(result.body.startsWith(reply+'\n\n'),true);assert.equal(result.html.includes('<script>'),false);assert.equal(result.html.includes('<img'),false);assert.equal(result.html.includes('&lt;script&gt;Literal'),true);assert.equal(plainTextFromHtml(result.html).includes(reply),true);assert.equal(result.html.includes('src='),true,'src is escaped literal text, not an element attribute');
});

test('HTML-only source sanitizes active markup before extraction and decodes references exactly once',()=>{
 const html='<div>Hello &amp;lt;literal&amp;gt; &amp; friend.</div><script>untrusted-script</script><style>untrusted-style</style><img src="https://pixel.invalid/one" onerror="bad()"><iframe>untrusted-frame</iframe><p><a href="javascript:bad()">Keep this text</a><br>Next &lt;tag&gt;</p>';
 for(const plain of ['', ' \t\r\n ']){const immutable=source({text:plain,html}),result=composeAutoDraftReply(immutable,'Reply.','UTC');assert.equal(projectAutoDraftSourceText(immutable),'Hello &lt;literal&gt; & friend.\nKeep this text\nNext <tag>');assert.equal(result.body.endsWith('> Hello &lt;literal&gt; & friend.\n> Keep this text\n> Next <tag>'),true);for(const marker of ['untrusted-script','untrusted-style','untrusted-frame','https://pixel.invalid','javascript:'])assert.equal(result.html.includes(marker),false);assert.equal(result.html.includes('&amp;lt;literal&amp;gt;'),true);}
});

test('nonempty plain alternative stays authoritative and literal while HTML-only fallback is explicit',()=>{
 const result=composeAutoDraftReply(source({text:'Plain &amp; <literal>\r\n\r\nNext',html:'<p>Different HTML.</p>'}),'Reply\r\nSecond','UTC');assert.equal(result.body.startsWith('Reply\nSecond\n\n'),true);assert.equal(result.body.endsWith('> Plain &amp; <literal>\n> \n> Next'),true);assert.equal(result.html.includes('Different HTML'),false);assert.equal(composeAutoDraftReply(source({text:'',html:undefined,sender:{name:'',email:'sender@example.test'}}),'Reply','UTC').body.includes('PM, <sender@example.test> wrote:\n> '),true);
});

test('explicit timezone handles day rollover and DST gaps/folds without depending on process timezone',()=>{
 const make=(date:string,tz:string)=>composeAutoDraftReply(source({date}),'Reply',tz).body;
 assert.match(make('2026-10-29T00:15:00.000Z','America/Los_Angeles'),/On Wed, Oct 28, 2026 at 5:15 PM/);
 assert.match(make('2026-10-29T12:19:00.000Z','Asia/Tokyo'),/On Thu, Oct 29, 2026 at 9:19 PM/);
 assert.match(make('2026-03-08T09:30:00.000Z','America/Los_Angeles'),/at 1:30 AM/);assert.match(make('2026-03-08T10:30:00.000Z','America/Los_Angeles'),/at 3:30 AM/);
 assert.match(make('2026-11-01T08:30:00.000Z','America/Los_Angeles'),/at 1:30 AM/);assert.match(make('2026-11-01T09:30:00.000Z','America/Los_Angeles'),/at 1:30 AM/);
});

test('invalid calendar dates, ambiguous date strings, missing timezone and hostile header controls refuse',()=>{
 for(const date of ['2026-02-30T12:00:00.000Z','Oct 29 2026 12:19','2026-10-29T12:19:00','2026-13-01T12:00:00.000Z','0000-01-01T00:00:00.000Z'])assert.throws(()=>composeAutoDraftReply(source({date}),'Reply','UTC'),invalid);
 for(const tz of ['', 'America/Not_A_Zone',' UTC','UTC\nBcc: injected','+05:30'])assert.throws(()=>composeAutoDraftReply(source(),'Reply',tz),invalid);
 for(const sender of [{name:'Sender\r\nBcc: injected',email:'sender@example.test'},{name:'Sender\u202e',email:'sender@example.test'},{name:'Sender',email:'sender@example.test\nother@example.test'},{name:'Sender',email:'invalid'},{name:'\ud800',email:'sender@example.test'}])assert.throws(()=>composeAutoDraftReply(source({sender}),'Reply','UTC'),invalid);
 for(const reply of ['',' \n ', '\u0000','\ud800'])assert.throws(()=>composeAutoDraftReply(source(),reply,'UTC'),invalid);
});

test('UTF8 input and escaped output budgets reject rather than silently truncate authored or quoted facts',()=>{
 assert.throws(()=>composeAutoDraftReply(source(),'界'.repeat(Math.floor(REPLY_QUOTE_LIMITS.replyBytes/3)+1),'UTC'),over);assert.throws(()=>composeAutoDraftReply(source({text:'x'.repeat(REPLY_QUOTE_LIMITS.sourceTextBytes+1)}),'Reply','UTC'),over);assert.throws(()=>composeAutoDraftReply(source({text:'',html:'x'.repeat(REPLY_QUOTE_LIMITS.sourceHtmlBytes+1)}),'Reply','UTC'),over);assert.throws(()=>composeAutoDraftReply(source({text:'"'.repeat(REPLY_QUOTE_LIMITS.sourceTextBytes)}),'"'.repeat(REPLY_QUOTE_LIMITS.replyBytes),'UTC'),over);
});
