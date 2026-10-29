import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSplitQuery, SplitQueryError } from '../src/split-inbox-query.ts';
const rejected=(query:string,code?:string)=>assert.throws(()=>parseSplitQuery(query),(error:unknown)=>error instanceof SplitQueryError&&(!code||error.code===code));
test('strict split grammar retains quoted values, escapes and role-specific fields without executing input',()=>{
 const r=parseSplitQuery('subject:"Cedar AND Birch" AND -from:"A, B" OR to:me');assert.equal(r.terms,3);assert.deepEqual(r.ast,{kind:'or',children:[{kind:'and',children:[{kind:'term',field:'subject',value:'Cedar AND Birch'},{kind:'not',child:{kind:'term',field:'from',value:'A, B'}}]},{kind:'term',field:'to',value:'me'}]});
 assert.deepEqual(parseSplitQuery('subject:"a \\"quote\\" and \\\\ path"').ast,{kind:'term',field:'subject',value:'a "quote" and \\ path'});
});
test('inherited field groups, brace OR, explicit AND precedence and complete negation are structural',()=>{
 const a=parseSplitQuery('from:(alice@example.test OR bob@example.test) AND NOT {label:A label:B}').ast;assert.equal(a.kind,'and');if(a.kind==='and'){assert.deepEqual(a.children[0],{kind:'or',children:[{kind:'term',field:'from',value:'alice@example.test'},{kind:'term',field:'from',value:'bob@example.test'}]});assert.equal(a.children[1].kind,'not')}
 assert.deepEqual(parseSplitQuery('is:flagged has:attachments in:SENT').ast,{kind:'and',children:[{kind:'term',field:'is',value:'starred'},{kind:'term',field:'has',value:'attachment'},{kind:'term',field:'in',value:'sent'}]});
});
test('malformed quotes/groups/operands cannot become an empty all-matching conjunction or fallback text',()=>{
 for(const q of ['', ' ', 'bare text', '"quoted bare text"', 'from:', 'subject:', 'subject:"unfinished', 'subject:"a"suffix', 'sub"ject":a','(subject:a','{subject:a)', 'subject:a)', '()', 'from:()', 'subject:a OR', 'AND subject:a', 'subject:a AND OR subject:b','NOT','-','subject:"a\\qb"'])rejected(q);
});
test('known unavailable families and status-style labels fail explicitly rather than silently returning zero',()=>{
 for(const q of ['filename:report.pdf','after:2026-10-28','category:personal','list:example.test','shared:me','bcc:x@example.test','in:all','is:unread','label:important'])rejected(q,'split_query_unsupported');
 rejected('autolabel:invented','split_query_autolabel');rejected('unknown:word','split_query_invalid');
});
test('UTF8, Unicode controls, total tokens, nodes and nesting each enforce bounded local policy',()=>{
 assert.equal(parseSplitQuery('subject:"Cedar 🌲"').terms,1);rejected('subject:'+ 'x'.repeat(2048),'split_query_limit');rejected('subject:'+ '\ud800','split_query_limit');rejected('subject:one\ntwo','split_query_limit');
 rejected('('.repeat(10)+'subject:a'+')'.repeat(10),'split_query_limit');rejected(Array.from({length:65},()=> 'subject:a').join(' '),'split_query_limit');rejected(Array.from({length:130},()=> 'NOT').join(' ')+' subject:a','split_query_limit');
});
