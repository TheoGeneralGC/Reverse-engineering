import Squire from 'squire-rte';
import { composerValueFromHTML,plainTextToComposerHTML,sanitizeComposerFragment } from './composer-html.ts';
import type { ComposerValue } from './composer-html.ts';

export type FormatCommand='bold'|'italic'|'underline'|'strike'|'bullets'|'numbers'|'quote'|'unquote'|'indent'|'outdent'|'undo'|'redo'|'clear';
export type FormatState={bold:boolean;italic:boolean;underline:boolean;strike:boolean;bullets:boolean;numbers:boolean;quote:boolean};
export type RewriteTarget={html:string;range:Range;text:string};

export function createComposerEditor(root:HTMLElement,initial:{body:string;html?:string},onChange:(value:ComposerValue)=>void){
 const document=root.ownerDocument;
 const editor=new Squire(root,{blockTag:'DIV',sanitizeToDOMFragment:html=>sanitizeComposerFragment(html,document),undo:{documentSizeThreshold:200_000,undoLimit:100},didError:error=>{console.error('Composer editing operation failed',error instanceof Error?error.name:'EditorError')}});
 editor.setHTML(initial.html??plainTextToComposerHTML(initial.body));
 let lastPublished=composerValueFromHTML(editor.getHTML(),document);
 const getValue=()=>composerValueFromHTML(editor.getHTML(),document);
 const publish=()=>{const value=getValue();if(value.html!==lastPublished.html||value.body!==lastPublished.body){lastPublished=value;onChange(value)}};
 editor.addEventListener('input',publish);
 const getFormat=():FormatState=>({bold:editor.hasFormat('B')||editor.hasFormat('STRONG'),italic:editor.hasFormat('I')||editor.hasFormat('EM'),underline:editor.hasFormat('U'),strike:editor.hasFormat('S')||editor.hasFormat('STRIKE'),bullets:editor.hasFormat('UL'),numbers:editor.hasFormat('OL'),quote:editor.hasFormat('BLOCKQUOTE')});
 const captureRewriteTarget=(wholeBodyWhenCollapsed=true):RewriteTarget=>{
  const range=editor.getSelection().cloneRange();
  if(range.collapsed&&wholeBodyWhenCollapsed)range.selectNodeContents(root);
  return{html:editor.getHTML(),range,text:editor.getSelectedText(range)};
 };
 const run=(command:FormatCommand)=>{
  if(root.contentEditable==='false')return;
  const active=getFormat();
  if(command==='bold')active.bold?editor.removeBold():editor.bold();
  else if(command==='italic')active.italic?editor.removeItalic():editor.italic();
  else if(command==='underline')active.underline?editor.removeUnderline():editor.underline();
  else if(command==='strike')active.strike?editor.removeStrikethrough():editor.strikethrough();
  else if(command==='bullets')active.bullets?editor.removeList():editor.makeUnorderedList();
  else if(command==='numbers')active.numbers?editor.removeList():editor.makeOrderedList();
  else if(command==='quote')editor.increaseQuoteLevel();
  else if(command==='unquote')editor.decreaseQuoteLevel();
  else if(command==='indent')active.bullets||active.numbers?editor.increaseListLevel():editor.increaseQuoteLevel();
  else if(command==='outdent')active.bullets||active.numbers?editor.decreaseListLevel():editor.decreaseQuoteLevel();
  else if(command==='undo')editor.undo();
  else if(command==='redo')editor.redo();
  else editor.removeAllFormatting();
  publish();
 };
 return{editor,getValue,getFormat,run,publish,captureRewriteTarget,
  applyRewrite(text:string,target:RewriteTarget):RewriteTarget{
   if(root.contentEditable==='false')throw new Error('This draft cannot be edited while delivery is pending.');
   if(target.html!==editor.getHTML()||!root.contains(target.range.startContainer)||!root.contains(target.range.endContainer))throw new Error('The draft changed while AI was working. Select the text again to keep your latest edits.');
   const normalized=text.replace(/\r\n?/g,'\n'),start=document.createElement('input'),end=document.createElement('input');start.type='hidden';end.type='hidden';
   // Trusted temporary bookmarks are added after Squire sanitizes the fragment.
   // They retain structural blank lines as well as text, then are removed before
   // any value is published. Plain-text offsets cannot represent those lines.
   const bookmark=(event:Event)=>{const fragment=(event as CustomEvent<{fragment:DocumentFragment}>).detail.fragment;(fragment.firstElementChild||fragment).prepend(start);(fragment.lastElementChild||fragment).append(end)};
   editor.addEventListener('willPaste',bookmark);
   try{
    editor.focus().setSelection(target.range.cloneRange()).insertHTML(plainTextToComposerHTML(normalized),true);
    if(!root.contains(start)||!root.contains(end))throw new Error('AI could not replace this selection. Select the text again.');
    const range=document.createRange();range.setStartAfter(start);range.setEndBefore(end);start.remove();end.remove();editor.setSelection(range);publish();
   }finally{editor.removeEventListener('willPaste',bookmark);start.remove();end.remove()}
   return captureRewriteTarget(false);
  },
  makeLink(href:string,range?:Range){if(root.contentEditable==='false')return;const selected=range||editor.getSelection().cloneRange();editor.focus().setSelection(selected).makeLink(href,{target:'_blank',rel:'noopener noreferrer'});publish()},
  setTextColor(color:string|null){if(root.contentEditable==='false')return;editor.setTextColor(color);publish()},
  update(value:{body:string;html?:string}){
   if(value.body===lastPublished.body&&(value.html===undefined||value.html===lastPublished.html))return;
   const html=value.html===lastPublished.html&&value.body!==lastPublished.body?plainTextToComposerHTML(value.body):value.html??plainTextToComposerHTML(value.body);
   const next=composerValueFromHTML(html,document);const current=getValue();if(next.html===current.html&&next.body===current.body)return;
   editor.setHTML(next.html);lastPublished=getValue();
  },
  insertText(text:string){if(root.contentEditable==='false')return;const range=editor.getSelection().cloneRange();editor.focus().setSelection(range).insertPlainText(text,false);publish()},
  replaceText(text:string){if(root.contentEditable==='false')return;editor.saveUndoState();const range=document.createRange();range.selectNodeContents(root);editor.setSelection(range).insertPlainText(text,false);publish()},
  destroy(){editor.removeEventListener('input',publish);editor.destroy()},
 };
}
export type ComposerController=ReturnType<typeof createComposerEditor>;
