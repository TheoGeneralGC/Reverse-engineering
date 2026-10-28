import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDiscardableDraft } from '../src/empty-draft.ts';
import type { Draft } from '../src/api.ts';

const empty=(patch:Partial<Draft>={}):Draft=>({id:'synthetic-empty',accountId:'a',to:'',cc:'',bcc:'',subject:'',body:'',status:'draft',updatedAt:'2026-10-28T12:00:00Z',...patch});

test('only literal empty text fields qualify; whitespace, invalid recipient edits and controls are retained',()=>{
 assert.equal(isDiscardableDraft(empty()),true);
 for(const field of ['to','cc','bcc','subject','body'] as const)for(const value of [' ','\n','\t','\0','\u200b','invalid-recipient',JSON.stringify('unfinished <')])assert.equal(isDiscardableDraft(empty({[field]:value})),false,field+' '+JSON.stringify(value));
});

test('attachments, provider-linked drafts and delivery states are never treated as disposable empty editors',()=>{
 assert.equal(isDiscardableDraft(empty({attachments:[]})),true);
 assert.equal(isDiscardableDraft(empty({attachments:[{id:'attachment',name:'empty-file.txt',size:0,mimeType:'text/plain'}]})),false);
 assert.equal(isDiscardableDraft(empty({providerDraftId:'existing-provider-draft'})),false);
 for(const status of ['scheduled','sending','delivery_unknown','sent'] as const)assert.equal(isDiscardableDraft(empty({status})),false,status);
 assert.equal(isDiscardableDraft(empty({status:'failed'})),true);
 for(const attachments of [null,{},''])assert.equal(isDiscardableDraft(empty({attachments:attachments as unknown as Draft['attachments']})),false);
});

test('balanced attribute-free empty editor markup remains eligible across case and normal whitespace',()=>{
 for(const html of ['',undefined,' \n\t','<div><br></div>','<p></p>','<div><p><br/></p></div>','<DIV>\n<BR />\n</DIV>','<p> </p><br>'])assert.equal(isDiscardableDraft(empty({html})),true,String(html));
});

test('meaningful rich structures, attributes, entities and unknown markup are retained despite an empty plain alternative',()=>{
 const values=['\u00a0','\u2003','\u2028','<div>actual text</div>','<div>&nbsp;</div>','<div>&#32;</div>','<!-- retained -->','<div class=""></div>','<div style="caret-color:transparent"><br></div>','<a href="https://example.test"></a>','<img src="https://example.test/image.png">','<svg></svg>','<table><tbody><tr><td></td></tr></tbody></table>','<ul><li></li></ul>','<b></b>','<input type="hidden">'];
 for(const html of values)assert.equal(isDiscardableDraft(empty({html})),false,html);
});

test('malformed markup cannot be interpreted as safe empty editor tags and silently discarded',()=>{
 for(const html of ['<div>','</div>','<p/>','<div><p></div></p>','<br></br>','< div></div>','<div>< /div>','<div / >','<br / >','<div><br></div>trailing'])assert.equal(isDiscardableDraft(empty({html})),false,html);
});
