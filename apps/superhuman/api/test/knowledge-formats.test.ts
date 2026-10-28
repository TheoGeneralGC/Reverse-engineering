import test from 'node:test';
import assert from 'node:assert/strict';
import {extractKnowledgeDocument,KnowledgeParseError} from '../src/knowledge-extract.ts';
import {runKnowledgeExtraction} from '../src/knowledge-runner.ts';
import {archive,docx,docxParts,pptx,pptxParts,pdf,legacyDoc} from './knowledge-format-fixtures.ts';
import {KNOWLEDGE_MAX_TEXT_BYTES} from '../src/knowledge-input.ts';
import fs,{mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('generated PPTX follows declared presentation relationship order and excludes unreferenced slides',async()=>{
 const result=await extractKnowledgeDocument(pptx([2,1],true),'pptx');assert.ok(result.text.indexOf('VISIBLE_SLIDE_2')<result.text.indexOf('VISIBLE_SLIDE_1'),'Visible order is sldIdLst relationship order, not numeric filenames');assert.doesNotMatch(result.text,/ORPHAN_SHOULD_NOT_BE_READ/);
});

test('unreferenced PPTX parts are excluded even when their filenames appear to be valid slide names',async()=>{
 const result=await extractKnowledgeDocument(pptx([1],true),'pptx');assert.match(result.text,/VISIBLE_SLIDE_1/);assert.doesNotMatch(result.text,/ORPHAN_SHOULD_NOT_BE_READ/);
});

test('PPTX notes follow the visible slide internal relationship, not a same-number or orphan filename',async()=>{
 const parts=pptxParts([2,1]);parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>','<Override PartName="/ppt/notesSlides/notesSlide5.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/><Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>');
 parts['ppt/slides/_rels/slide2.xml.rels']='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="notes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide5.xml"/><Relationship Id="external" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="https://example.invalid/never-fetch" TargetMode="External"/></Relationships>';
 const notes=(text:string)=>'<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>'+text+'</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>';
 parts['ppt/notesSlides/notesSlide5.xml']=notes('OWNED_SLIDE_TWO_NOTES');parts['ppt/notesSlides/notesSlide1.xml']=notes('ORPHAN_NOTES_MUST_BE_OMITTED');const result=await extractKnowledgeDocument(archive(parts),'pptx');assert.match(result.text,/OWNED_SLIDE_TWO_NOTES/);assert.doesNotMatch(result.text,/ORPHAN_NOTES_MUST_BE_OMITTED|never-fetch/);assert.ok(result.text.indexOf('VISIBLE_SLIDE_2')<result.text.indexOf('OWNED_SLIDE_TWO_NOTES'));assert.ok(result.text.indexOf('OWNED_SLIDE_TWO_NOTES')<result.text.indexOf('VISIBLE_SLIDE_1'));
});

test('generated DOCX, legacy OLE Word and PDF carry real structure and extract actual Unicode/plain text',async()=>{
 const source='Cedar has three samples. 样本';for(const [extension,bytes,expected]of [['docx',docx(source),source],['doc',legacyDoc(source),source],['pdf',pdf(),'Cedar has three samples.']]as const){const value=await extractKnowledgeDocument(bytes,extension);assert.match(value.text,new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.equal(value.truncated,false);assert.match(value.parser,extension==='pdf'?/pdfjs/:/word-extractor/);assert.ok(value.warnings.length>0)}
});

test('all document families succeed through the actual isolated worker and never mutate their input bytes',async()=>{
 for(const[extension,bytes]of [['txt',Buffer.from('Cedar three samples.')],['docx',docx()],['doc',legacyDoc()],['pdf',pdf()],['pptx',pptx([1,2])]]as const){const before=Buffer.from(bytes),value=await runKnowledgeExtraction(bytes,extension);assert.ok(value.text.trim());assert.match(value.text,/Cedar|VISIBLE_SLIDE_1/);assert.equal(bytes.equals(before),true,extension);assert.equal(value.truncated,false)}
});

test('source/text formats stay literal and UTF-8 clipping is bounded without losing a partial multibyte character',async()=>{
 const literal='const command = "<script>doNotExecute()</script>";\nCedar 样本 😀';for(const extension of ['txt','md','json','js','py','sh','tex','c','cpp','cs','go','java','php','rb','ts','css']){const result=await extractKnowledgeDocument(Buffer.from(literal),extension);assert.equal(result.text,literal);assert.equal(result.parser,'utf8-inert')}
 const huge='界'.repeat(Math.floor(KNOWLEDGE_MAX_TEXT_BYTES/3)+2),clipped=await extractKnowledgeDocument(Buffer.from(huge),'txt');assert.equal(clipped.truncated,true);assert.ok(Buffer.byteLength(clipped.text)<=KNOWLEDGE_MAX_TEXT_BYTES);assert.equal(/\uFFFD|\p{Surrogate}/u.test(clipped.text),false);assert.equal(clipped.text,'界'.repeat(Math.floor(KNOWLEDGE_MAX_TEXT_BYTES/3)));
});

test('HTML extraction is inert, drops executable/template content and preserves visible text/entity boundaries',async()=>{
 const html='<html><head><style>STYLE_PRIVATE</style><script>throw new Error("SCRIPT_PRIVATE")</script></head><body><h1>Cedar &amp; Birch</h1><p>Three <b>samples</b>.</p><template>TEMPLATE_PRIVATE</template><noscript>NOSCRIPT_PRIVATE</noscript><img src="https://example.invalid/never-load" onerror="doNotExecute()"></body></html>';
 const value=await runKnowledgeExtraction(Buffer.from(html),'html');assert.match(value.text,/Cedar & Birch/);assert.match(value.text,/Three samples\./);assert.doesNotMatch(value.text,/STYLE_PRIVATE|SCRIPT_PRIVATE|TEMPLATE_PRIVATE|NOSCRIPT_PRIVATE|never-load|doNotExecute/);assert.equal(value.parser,'parse5-8.0.1-inert');
});

test('extension spoofing, malformed binary/text and empty content fail explicitly instead of becoming searchable gibberish',async()=>{
 const failures:[Buffer,string][]=[[Buffer.alloc(0),'txt'],[Buffer.from('   \n\t'),'txt'],[Buffer.from([0xff,0xfe,0x80]),'txt'],[Buffer.from('text\0binary'),'md'],[Buffer.from('Not a PDF'),'pdf'],[Buffer.from('%PDF-1.4\nno objects'),'pdf'],[Buffer.from('Not a Word document'),'doc'],[Buffer.from('Not a ZIP'),'docx'],[Buffer.from('Unsupported'),'exe'],[Buffer.from('<script>only hidden text</script>'),'html']];
 for(const [bytes,extension]of failures)await assert.rejects(()=>extractKnowledgeDocument(bytes,extension),error=>error instanceof KnowledgeParseError&&error.code.startsWith('knowledge_'),extension);
 const bad=docxParts();bad['word/document.xml']='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:t>unclosed';await assert.rejects(()=>extractKnowledgeDocument(archive(bad),'docx'),{code:'knowledge_invalid_word'});
});

test('archive path traversal, expansion bombs, malformed/deep XML and DTD references are bounded or rejected',async()=>{
 const traversal={...docxParts(),'../escape.xml':'<private>must not extract</private>'};await assert.rejects(()=>extractKnowledgeDocument(archive(traversal),'docx'),{code:'knowledge_archive_structure'});
 const bomb={...docxParts(),'word/document.xml':'X'.repeat(16*1024*1024+1)};await assert.rejects(()=>extractKnowledgeDocument(archive(bomb),'docx'),{code:'knowledge_expansion_limit'});
 const deep=pptxParts([1]);deep['ppt/slides/slide1.xml']='<root>'+('<level>'.repeat(260))+'<t>Private</t>'+('</level>'.repeat(260))+'</root>';await assert.rejects(()=>extractKnowledgeDocument(archive(deep),'pptx'),{code:'knowledge_xml_depth'});
 const malformed=pptxParts([1]);malformed['ppt/slides/slide1.xml']='<root><t>unclosed';await assert.rejects(()=>extractKnowledgeDocument(archive(malformed),'pptx'),{code:'knowledge_invalid_xml'});
 const dtd=pptxParts([1]);dtd['ppt/slides/slide1.xml']='<!DOCTYPE root [<!ENTITY leak SYSTEM "file:///never-created-private-fixture">]><root><t>&leak;</t></root>';await assert.rejects(()=>extractKnowledgeDocument(archive(dtd),'pptx'),{code:'knowledge_unsafe_xml'});
});

test('worker refuses external entity file content and enforces output/time budgets without leaving parser temp directories',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'knowledge-owned-fixture-')),secret=join(dir,'synthetic-only.txt'),ownedDirectories:string[]=[],original=fs.mkdtempSync;writeFileSync(secret,'SYNTHETIC_NOT_FOR_DOCUMENT_CONTEXT');fs.mkdtempSync=((...args:Parameters<typeof fs.mkdtempSync>)=>{const result=original(...args);if(String(args[0]).includes('knowledge-parse-'))ownedDirectories.push(String(result));return result})as typeof fs.mkdtempSync;syncBuiltinESMExports();try{
  const external=docxParts();external['word/document.xml']='<!DOCTYPE w:document [<!ENTITY leak SYSTEM "file://'+secret+'">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&leak;</w:t></w:r></w:p></w:body></w:document>';await assert.rejects(()=>runKnowledgeExtraction(archive(external),'docx'),error=>typeof(error as any).code==='string'&&String((error as any).code).startsWith('knowledge_'));
  await assert.rejects(()=>runKnowledgeExtraction(Buffer.from('X'.repeat(2000)),'txt',{outputBytes:256}),{code:'knowledge_parser_output_limit'});await assert.rejects(()=>runKnowledgeExtraction(Buffer.from('A controlled sample'),'txt',{wallMs:10}),{code:'knowledge_parser_timeout'});
  assert.equal(ownedDirectories.length,3);assert.ok(ownedDirectories.every(directory=>!existsSync(directory)),'Only directories created by these three worker invocations are checked; parallel test workers are unrelated');
 }finally{fs.mkdtempSync=original;syncBuiltinESMExports();rmSync(dir,{recursive:true,force:true})}
 for(const limits of [{wallMs:0},{wallMs:60001},{cpuSeconds:0},{heapMiB:1},{outputBytes:1}])assert.throws(()=>runKnowledgeExtraction(Buffer.from('small'),'txt',limits),TypeError);
});
