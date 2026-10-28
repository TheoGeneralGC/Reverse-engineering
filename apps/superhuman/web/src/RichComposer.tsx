import { forwardRef,useEffect,useImperativeHandle,useLayoutEffect,useRef,useState } from 'react';
import type { KeyboardEvent,ReactNode } from 'react';
import { createComposerEditor } from './composer-editor.ts';
import type { ComposerController,FormatCommand,FormatState,RewriteTarget } from './composer-editor.ts';
import { normalizeComposerLink } from './composer-html.ts';
import type { ComposerValue } from './composer-html.ts';
import Icon from './Icon.tsx';
import { requestComposerRewrite,rewriteCommands } from './composer-ai.ts';
import type { ComposerRewriteRequest } from './composer-ai.ts';

export type RichComposerHandle={getValue:()=>ComposerValue&{draftId:string};insertText:(text:string)=>void;replaceText:(text:string)=>void;focus:()=>void;openAI:()=>void};
type Props={draftId:string;body:string;html?:string;readOnly?:boolean;onChange:(value:ComposerValue)=>void;onFiles?:(files:File[])=>void;generateAI?:(request:ComposerRewriteRequest,signal:AbortSignal)=>Promise<string>};
type InlineAI={target:RewriteTarget;phase:'ready'|'working'|'done'|'error';prompt:string;error:string;lastRequest?:ComposerRewriteRequest;top:number};
const palette=[{name:'No color',value:null,swatch:'rgb(34, 34, 34)'},{name:'Lava Red',value:'rgb(222, 84, 84)',swatch:'rgb(222, 84, 84)'},{name:'Irascible Orange',value:'rgb(233, 150, 56)',swatch:'rgb(233, 150, 56)'},{name:'Seafoam Green',value:'rgb(92, 186, 135)',swatch:'rgb(92, 186, 135)'},{name:'Conscientious Blue',value:'rgb(74, 143, 225)',swatch:'rgb(74, 143, 225)'},{name:'Pretty In Pink',value:'rgb(201, 118, 209)',swatch:'rgb(201, 118, 209)'}];
const emptyFormat:FormatState={bold:false,italic:false,underline:false,strike:false,bullets:false,numbers:false,quote:false};
const ListIcon=({numbered=false}:{numbered?:boolean})=><svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25"><path d="M8 4h10M8 10h10M8 16h10"/>{numbered?<><path d="M2 3h1v4M1 7h4M1 10c3-2 5 0 2 2l-2 2h4M1 16h3l-2 1 2 1-3 1"/></>:<><circle cx="3" cy="4" r="1" fill="currentColor"/><circle cx="3" cy="10" r="1" fill="currentColor"/><circle cx="3" cy="16" r="1" fill="currentColor"/></>}</svg>;
const LinkIcon=()=><svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 6H5a4 4 0 0 0 0 8h3m4-8h3a4 4 0 0 1 0 8h-3M5 10h10"/></svg>;
const ColorIcon=()=><svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="7" r="4" fill="#3284a4"/><circle cx="7" cy="12" r="4" fill="#448d6e"/><circle cx="13" cy="12" r="4" fill="#a9525c"/></svg>;
export default forwardRef<RichComposerHandle,Props>(function RichComposer({draftId,body,html,readOnly=false,onChange,onFiles,generateAI=requestComposerRewrite},ref){
 const root=useRef<HTMLDivElement>(null),controller=useRef<ComposerController|null>(null),change=useRef(onChange),files=useRef(onFiles),disabled=useRef(readOnly),linkRange=useRef<Range|null>(null),urlField=useRef<HTMLInputElement>(null);
 const [format,setFormat]=useState(emptyFormat),[selection,setSelection]=useState(false),[toolbar,setToolbar]=useState({left:0,top:0}),[link,setLink]=useState(false),[url,setURL]=useState(''),[linkError,setLinkError]=useState(''),[colors,setColors]=useState(false),[selectedColor,setSelectedColor]=useState<string|null>(null);
 const [ai,setAI]=useState<InlineAI|null>(null),aiState=useRef<InlineAI|null>(null),aiInput=useRef<HTMLInputElement>(null),aiRequest=useRef<AbortController|null>(null),aiRevision=useRef(0);
 const showAI=(value:InlineAI|null)=>{aiState.current=value;setAI(value)};
 const closeAI=()=>{aiRevision.current++;aiRequest.current?.abort();aiRequest.current=null;showAI(null);controller.current?.editor.focus();updateFormat()};
 const openAI=()=>{
  if(disabled.current||!controller.current||aiState.current?.phase==='working')return;
  const target=controller.current.captureRewriteTarget(),range=target.range;
  const bounds=typeof range.getBoundingClientRect==='function'?range.getBoundingClientRect():null,container=root.current?.parentElement?.getBoundingClientRect();
  setLink(false);setColors(false);setSelection(false);showAI({target,phase:'ready',prompt:'',error:'',top:bounds&&container?Math.max(0,bounds.bottom-container.top+4):30});
 };
 const rewrite=async(instruction:string,retry=false)=>{
  const session=aiState.current,current=controller.current;if(!session||!current||disabled.current||session.phase==='working')return;
  const request=retry&&session.lastRequest?session.lastRequest:{instruction,text:session.target.text};
  if(!request.instruction.trim())return;
  const revision=++aiRevision.current,abort=new AbortController();aiRequest.current?.abort();aiRequest.current=abort;
  showAI({...session,phase:'working',error:'',lastRequest:request});
  try{
   const result=await generateAI(request,abort.signal);
   if(revision!==aiRevision.current||controller.current!==current||disabled.current)return;
   if(typeof result!=='string'||!result.trim())throw new Error('AI returned no replacement text. Your draft has been kept.');
   const target=current.applyRewrite(result,session.target);showAI({...session,target,phase:'done',prompt:'',error:'',lastRequest:request});
  }catch(error){if(revision===aiRevision.current&&!abort.signal.aborted)showAI({...session,phase:'error',lastRequest:request,error:error instanceof Error?error.message:'AI could not edit this text. Your draft has been kept.'})}
  finally{if(aiRequest.current===abort)aiRequest.current=null}
 };
 change.current=onChange;files.current=onFiles;disabled.current=readOnly;
 const position=(range:Range,width=337)=>{
  if(typeof range.getBoundingClientRect!=='function'||!root.current)return;
  const bounds=range.getBoundingClientRect(),container=root.current.parentElement!.getBoundingClientRect();
  setToolbar({left:Math.max(-24,Math.min(container.width+24-width,bounds.left+bounds.width/2-container.left-width/2)),top:bounds.bottom-container.top+6});
 };
 const updateFormat=()=>{
  const current=controller.current;if(!current)return;
  setFormat(current.getFormat());const range=current.editor.getSelection();setSelection(!range.collapsed&&root.current?.ownerDocument.activeElement===root.current);
  if(!range.collapsed)position(range);
 };
 useLayoutEffect(()=>{
  if(!root.current)return;
  aiRevision.current++;aiRequest.current?.abort();aiRequest.current=null;showAI(null);setLink(false);setColors(false);setSelection(false);linkRange.current=null;
  const current=createComposerEditor(root.current,{body,html},value=>{if(!disabled.current)change.current(value)});controller.current=current;root.current.contentEditable=String(!readOnly);
  const refresh=()=>updateFormat();
  for(const type of ['pathChange','select','cursor','focus','input'])current.editor.addEventListener(type,refresh);
  current.editor.addEventListener('blur',()=>setSelection(false));
  current.editor.addEventListener('pasteImage',event=>{const pasted=(event as CustomEvent<{clipboardData:DataTransfer}>).detail?.clipboardData;const list=Array.from(pasted?.files||[]);if(list.length&&!disabled.current)files.current?.(list)});
  return()=>{current.destroy();if(controller.current===current)controller.current=null};
 },[draftId]);
 useEffect(()=>{controller.current?.update({body,html})},[body,html]);
 useEffect(()=>{if(root.current)root.current.contentEditable=String(!readOnly);if(readOnly){setLink(false);setSelection(false);setColors(false);aiRevision.current++;aiRequest.current?.abort();showAI(null)}},[readOnly]);
 useEffect(()=>()=>{aiRevision.current++;aiRequest.current?.abort()},[draftId]);
 useEffect(()=>{if(ai?.phase==='ready')aiInput.current?.focus()},[ai?.phase]);
 useEffect(()=>{if(link)urlField.current?.focus()},[link]);
 useEffect(()=>{if(!link&&!colors)return;const close=(event:PointerEvent)=>{if(root.current?.parentElement&&!root.current.parentElement.contains(event.target as Node)){setLink(false);setColors(false)}};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[link,colors]);
 useImperativeHandle(ref,()=>({getValue:()=>({...(controller.current?.getValue()||{body,html:html||''}),draftId}),insertText:text=>controller.current?.insertText(text),replaceText:text=>controller.current?.replaceText(text),focus:()=>controller.current?.editor.focus(),openAI}),[draftId,body,html]);
 const run=(command:FormatCommand)=>{controller.current?.run(command);updateFormat()};
 const openLink=()=>{if(readOnly||!controller.current)return;const range=controller.current.editor.getSelection();linkRange.current=range.cloneRange();const node=range.startContainer.nodeType===1?range.startContainer as Element:range.startContainer.parentElement;setURL(node?.closest('a')?.getAttribute('href')||'');position(range,214);setColors(false);setLinkError('');setLink(true)};
 const openColors=()=>{if(readOnly||!controller.current)return;const range=controller.current.editor.getSelection();position(range,221);setSelectedColor(controller.current.editor.getFontInfo(range).color||null);setColors(!colors)};
 const restoreLink=()=>{setLink(false);if(controller.current){controller.current.editor.focus();if(linkRange.current)controller.current.editor.setSelection(linkRange.current)}updateFormat()};
 const applyLink=()=>{
  const href=normalizeComposerLink(url);if(!href){setLinkError('Enter a valid web, email, or telephone link.');return}
  if(controller.current){controller.current.makeLink(href,linkRange.current||undefined)}restoreLink();
 };
 const keydown=(event:KeyboardEvent<HTMLDivElement>)=>{
  if(aiState.current){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeAI();return}if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();event.stopPropagation();void rewrite(aiState.current.prompt);return}}
  if(link){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();restoreLink()}else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();applyLink()}else if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();event.stopPropagation();urlField.current?.focus()}return}
  if(colors&&event.key==='Escape'){event.preventDefault();event.stopPropagation();setColors(false);updateFormat();return}
  if(readOnly)return;
  const modifier=event.metaKey||event.ctrlKey,key=event.key.toLowerCase();let command:FormatCommand|undefined;
  if(modifier&&key==='j'){event.preventDefault();event.stopPropagation();openAI();return}
  if(modifier&&!event.altKey){
   if(!event.shiftKey){if(key==='b')command='bold';else if(key==='i')command='italic';else if(key==='u')command='underline';else if(key==='z')command='undo';else if(key==='k'){event.preventDefault();event.stopPropagation();openLink();return}else if(key==='o'){event.preventDefault();event.stopPropagation();openColors();return}}
   else if(key==='z')command='redo';else if(key==='x')command='strike';else if(event.code==='Digit7')command='numbers';else if(event.code==='Digit8')command='bullets';else if(event.code==='Digit9')command='quote';
   if(key===']')command='indent';if(key==='[')command='outdent';
  }
  if(event.key==='Tab'&&(format.bullets||format.numbers))command=event.shiftKey?'outdent':'indent';
  if(command){event.preventDefault();event.stopPropagation();run(command)}
 };
 const tool=(label:string,command:FormatCommand,content:ReactNode,active=false)=><button key={command} type="button" className={`format-${command}`} aria-label={label} title={label} aria-pressed={active} onMouseDown={event=>event.preventDefault()} onClick={()=>run(command)}>{content}</button>;
 return <div className="rich-composer" onKeyDownCapture={keydown}>
  <div ref={root} role="textbox" aria-label="Message body" aria-multiline="true" aria-readonly={readOnly} contentEditable={!readOnly} suppressContentEditableWarning tabIndex={0} data-placeholder="Tip: Hit ⌘J for AI" className={`body-input rich-editor ${body?'':'is-empty'}`}/>
  {selection&&!link&&!colors&&!ai&&!readOnly&&<div className="rich-format-toolbar" role="toolbar" aria-label="Text formatting" style={toolbar}>
   {tool('Bold (⌘B)','bold','B',format.bold)}{tool('Italic (⌘I)','italic','I',format.italic)}{tool('Underline (⌘U)','underline','U',format.underline)}{tool('Strikethrough (⌘⇧X)','strike','S',format.strike)}
   <button type="button" aria-label="Insert link (⌘K)" title="Insert link (⌘K)" onMouseDown={event=>event.preventDefault()} onClick={openLink}><LinkIcon/></button>
   <button type="button" aria-label="Text color" title="Text color" aria-expanded={colors} onMouseDown={event=>event.preventDefault()} onClick={openColors}><ColorIcon/></button>
   {tool('Numbered list (⌘⇧7)','numbers',<ListIcon numbered/>,format.numbers)}{tool('Bulleted list (⌘⇧8)','bullets',<ListIcon/>,format.bullets)}{tool('Quote (⌘⇧9)','quote',<span aria-hidden="true">❝☰</span>,format.quote)}
   <button type="button" className="format-ai" aria-label="Write with AI" title="Write with AI" onMouseDown={event=>event.preventDefault()} onClick={openAI}><Icon name="spark" size={22}/></button>
  </div>}
  {colors&&!link&&!readOnly&&<div className="composer-color-picker" role="group" aria-label="Text color" style={toolbar}>{palette.map(color=><button type="button" key={color.name} aria-label={color.name} aria-pressed={selectedColor===color.value} title={color.name} className={color.value?'':'no-color'} style={{background:color.swatch}} onMouseDown={event=>event.preventDefault()} onClick={()=>{if(controller.current){controller.current.setTextColor(color.value)}setColors(false);updateFormat()}}/>)}</div>}
  {link&&<form className="composer-link-dialog" role="dialog" aria-label="Insert link" style={toolbar} onSubmit={event=>{event.preventDefault();applyLink()}}><input ref={urlField} aria-label="Link URL" aria-invalid={Boolean(linkError)} aria-describedby={linkError?'composer-link-error':undefined} value={url} onChange={event=>{setURL(event.target.value);setLinkError('')}} placeholder="Paste or type a link" autoComplete="off"/>{linkError&&<p id="composer-link-error" role="alert">{linkError}</p>}</form>}
  {ai&&!readOnly&&<form className="composer-inline-ai" aria-label="Edit with AI" style={{top:ai.top}} onSubmit={event=>{event.preventDefault();event.stopPropagation();void rewrite(ai.prompt)}} aria-busy={ai.phase==='working'}>
   <div className="composer-ai-prompt"><input ref={aiInput} aria-label="Describe how to edit the text" placeholder="Describe how to edit the text" maxLength={2000} value={ai.prompt} disabled={ai.phase==='working'} onChange={event=>showAI({...ai,prompt:event.target.value})}/><button type="submit" aria-label="Edit selection" disabled={ai.phase==='working'||!ai.prompt.trim()}><Icon name="up" size={14}/></button></div>
   <div className="composer-ai-commands" role="group" aria-label="AI drafting commands">
    {ai.phase==='done'&&<><button type="button" className="chosen" onClick={closeAI}>Done</button><button type="button" onClick={()=>void rewrite('',true)}>Retry</button></>}
    {ai.phase==='working'?<span role="status">Editing…</span>:rewriteCommands.filter(command=>ai.phase!=='done'||command!=='Fix spelling and grammar').map((command,index)=><button type="button" className={ai.phase!=='done'&&index===0?'chosen':''} key={command} onClick={()=>void rewrite(command)}>{command}</button>)}
    {ai.phase!=='done'&&<button type="button" className="composer-ai-close" aria-label="Close AI editor" onClick={closeAI}>×</button>}
   </div>
   {ai.error&&<p className="composer-ai-error" role="alert">{ai.error}</p>}
  </form>}
 </div>;
});
