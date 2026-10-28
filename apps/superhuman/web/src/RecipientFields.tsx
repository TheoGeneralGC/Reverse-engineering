import { forwardRef,useEffect,useId,useImperativeHandle,useLayoutEffect,useRef,useState } from 'react';
import type { ClipboardEvent,KeyboardEvent } from 'react';
import { api } from './api.ts';
import Icon from './Icon.tsx';
import { createRecipientModel,parseRecipient,recipientFields,recipientLabel,validRecipientEmail } from './recipient-model.ts';
import type { RecipientField,RecipientHeaders } from './recipient-model.ts';
import type { ContactIdentity,ContactSource } from './contact-context.ts';

export type RecipientSuggestion={name:string;email:string;formatted?:string};
export type RecipientSuggestions={contacts:RecipientSuggestion[];source:'local-message-participants';limited:true};
export type RecipientFieldsHandle={getValue:()=>RecipientHeaders&{draftId:string};validate:()=>{valid:boolean;hasRecipients:boolean;field?:RecipientField;message?:string};focus:(field:RecipientField)=>void};
type Props=RecipientHeaders&{draftId:string;accountId:string;readOnly:boolean;author?:ContactIdentity;isLocked?:()=>boolean;onChange:(value:RecipientHeaders)=>void;onContactIntent?:(intent:{accountId:string;draftId:string;contact:ContactIdentity;source:ContactSource})=>void;onEscapeCommit?:()=>void;request?:(accountId:string,query:string,signal:AbortSignal)=>Promise<RecipientSuggestions>};
const readSuggestions=(accountId:string,q:string,signal:AbortSignal)=>api<RecipientSuggestions>('/contacts/suggestions?'+new URLSearchParams({accountId,q,limit:'5'}),undefined,'GET',{signal});
const labels:Record<RecipientField,string>={to:'To',cc:'Cc',bcc:'Bcc'};

export default forwardRef<RecipientFieldsHandle,Props>(function RecipientFields(props,ref){
 const modelRef=useRef<ReturnType<typeof createRecipientModel>|null>(null);if(!modelRef.current)modelRef.current=createRecipientModel(props);const model=modelRef.current;
 const [state,setState]=useState(()=>model.getState()),[focused,setFocused]=useState(false),[suggestions,setSuggestions]=useState<RecipientSuggestion[]>([]),[highlight,setHighlight]=useState(0),[suggestionError,setSuggestionError]=useState(''),[loading,setLoading]=useState(false),[dismissed,setDismissed]=useState(''),[position,setPosition]=useState({top:0,left:0,width:300});
 const inputs=useRef<Partial<Record<RecipientField,HTMLInputElement>>>({}),regions=useRef<Partial<Record<RecipientField,HTMLDivElement>>>({}),root=useRef<HTMLDivElement>(null),suggestionMenu=useRef<HTMLDivElement>(null),latest=useRef(props),published=useRef(JSON.stringify(model.getValue())),requestRevision=useRef(0),suggestionController=useRef<AbortController|null>(null),identifier=useId();latest.current=props;
 const locked=()=>latest.current.readOnly||!!latest.current.isLocked?.();model.setLocked(locked());
 const active=state.fields[state.active],query=active.input.trim(),queryKey=JSON.stringify([props.accountId,props.draftId,state.active,query]),listId=identifier+'-suggestions';
 const focusNode=(field:RecipientField,select=false)=>{const input=inputs.current[field];if(input){input.focus();if(select)input.select()}else regions.current[field]?.focus()};
 const publish=()=>{const next=model.getState();setState(next);const value=model.getValue(),key=JSON.stringify(value);if(key!==published.current){published.current=key;latest.current.onChange(value)}};
 const clearSuggestions=()=>{requestRevision.current++;suggestionController.current?.abort();setSuggestions([]);setLoading(false);setSuggestionError('')};
 const change=(action:()=>void)=>{model.setLocked(locked());if(locked())return;action();setDismissed('');clearSuggestions();publish()};
 const showContact=(contact:ContactIdentity|undefined,source:ContactSource,authorFallback=false)=>{if(locked())return;if(!contact?.email.includes('@'))contact=authorFallback?latest.current.author:undefined;if(contact)latest.current.onContactIntent?.({accountId:latest.current.accountId,draftId:latest.current.draftId,contact:{name:contact.name,email:contact.email},source})};
 const showSelection=(field:RecipientField,source:ContactSource)=>{const value=model.getState().fields[field];if(value.edge!==null&&value.selected.includes(value.edge))showContact(value.tokens[value.edge],source,true)};
 const commitModel=(field:RecipientField,contact?:RecipientSuggestion)=>{const value=model.getState().fields[field],raw=value.input.trim();model.commit(field,contact);if(raw||contact)showContact(contact||parseRecipient(raw),'commit')};
 useImperativeHandle(ref,()=>({getValue:()=>({...model.getValue(),draftId:latest.current.draftId}),validate:()=>model.validate(),focus:field=>{model.focus(field);publish();queueMicrotask(()=>focusNode(field))}}),[model]);
 useEffect(()=>{
  const revision=++requestRevision.current,controller=new AbortController();suggestionController.current=controller;setSuggestions([]);setSuggestionError('');setLoading(false);
  if(!focused||props.readOnly||locked()||!query||query.length>200||(active.selected.length>0&&active.editing===null)||dismissed===queryKey)return()=>controller.abort();
  const accountId=props.accountId,draftId=props.draftId,field=state.active;
  const current=()=>{const snapshot=model.getState();return !controller.signal.aborted&&revision===requestRevision.current&&!locked()&&latest.current.accountId===accountId&&latest.current.draftId===draftId&&snapshot.active===field&&snapshot.fields[field].input.trim()===query};
  setLoading(true);const timer=setTimeout(()=>{
   void (latest.current.request||readSuggestions)(props.accountId,query,controller.signal).then(result=>{
    if(!current())return;
    const contacts=(Array.isArray(result.contacts)?result.contacts:[]).filter(contact=>typeof contact.name==='string'&&typeof contact.email==='string'&&validRecipientEmail(contact.email)).slice(0,5);
    setSuggestions(contacts);setHighlight(0);setLoading(false);
   }).catch(error=>{if(current()){setSuggestionError(error instanceof Error?error.message:'Could not load local contacts');setLoading(false)}});
  },120);
  return()=>{clearTimeout(timer);controller.abort()};
 },[props.accountId,props.draftId,props.readOnly,focused,state.active,query,active.editing,dismissed]);
 useEffect(()=>()=>{requestRevision.current++;suggestionController.current?.abort()},[]);
 useLayoutEffect(()=>{
  if(!suggestions.length)return;const update=()=>{const rect=inputs.current[state.active]?.getBoundingClientRect();if(rect){const width=Math.min(suggestionMenu.current?.getBoundingClientRect().width||560,Math.max(240,window.innerWidth-24));setPosition({top:rect.bottom+9,left:Math.max(12,Math.min(rect.left+9,window.innerWidth-width-12)),width})}};update();window.addEventListener('resize',update);window.addEventListener('scroll',update,true);return()=>{window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true)};
 },[suggestions.length,state.active,query]);
 const disabled=(contact:RecipientSuggestion)=>state.fields[state.active].tokens.some(token=>token.email.toLowerCase()===contact.email.toLowerCase());
 const selectedSuggestion=()=>suggestions[highlight]&&!disabled(suggestions[highlight])?suggestions[highlight]:undefined;
 const commit=(field:RecipientField,withSuggestion=false)=>{change(()=>commitModel(field,withSuggestion?selectedSuggestion():undefined));queueMicrotask(()=>focusNode(field))};
 const keydown=(event:KeyboardEvent<HTMLDivElement>,field:RecipientField)=>{
  if(event.nativeEvent.isComposing||event.keyCode===229)return;
  const value=model.getState().fields[field],input=event.target instanceof HTMLInputElement?event.target:null,modifier=event.metaKey||event.ctrlKey,key=event.key.toLowerCase();
  const consume=()=>{event.preventDefault();event.stopPropagation()};
  if(locked()){if(!['Tab','Escape'].includes(event.key)&&!(modifier&&key==='c'))consume();return}
  if(event.altKey&&['ArrowUp','ArrowDown'].includes(event.key)){consume();change(()=>{model.move(field,event.key==='ArrowUp'?-1:1);showSelection(model.getState().active,'selection')});queueMicrotask(()=>focusNode(model.getState().active));return}
  if(modifier&&key==='a'&&!value.input){consume();change(()=>{model.selectAll(field);showSelection(field,'selection')});queueMicrotask(()=>focusNode(field));return}
  if(modifier&&(key==='z'||key==='y')&&!value.input){consume();change(()=>key==='y'||event.shiftKey?model.redo():model.undo());queueMicrotask(()=>focusNode(model.getState().active));return}
  if(event.key==='Escape'){
   // Controlled original probes show that outer focus changes cause literal
   // commit even when the local suggestion handler first hides its list.
   if(value.input||value.editing!==null){consume();setDismissed(queryKey);change(()=>commitModel(field));setFocused(false);latest.current.onEscapeCommit?.()}
   else if(suggestions.length){consume();setDismissed(queryKey);clearSuggestions()}
   return;
  }
  if(event.key==='Enter'&&!modifier){consume();if(value.selected.length&&value.editing===null&&!value.input){change(()=>model.edit(field));queueMicrotask(()=>focusNode(field,true))}else commit(field,true);return}
  if(event.key==='Tab'&&suggestions.length){consume();commit(field,true);return}
  if(!event.shiftKey&&!modifier&&[',',';'].includes(event.key)&&value.input.includes('@')){consume();commit(field,true);return}
  if(['ArrowUp','ArrowDown'].includes(event.key)&&!event.altKey){consume();if(suggestions.length){const next=(highlight+(event.key==='ArrowUp'?-1:1)+suggestions.length)%suggestions.length;setHighlight(next);showContact(suggestions[next],'suggestion')}return}
  if(['ArrowLeft','ArrowRight'].includes(event.key)){
   const direction=event.key==='ArrowLeft'?-1:1,boundary=!input||(input.selectionStart===input.selectionEnd&&(direction<0?input.selectionStart===0:input.selectionEnd===input.value.length));
   if(boundary){consume();change(()=>{model.arrow(field,direction,event.shiftKey);showSelection(field,'selection')});queueMicrotask(()=>focusNode(field))}return;
  }
  if(event.key==='Backspace'&&!value.input||event.key==='Delete'&&value.selected.length&&value.editing===null){consume();const emptyAppend=event.key==='Backspace'&&!value.selected.length&&value.editing===null;change(()=>{model.remove(field);if(emptyAppend){const previous=model.getState().fields[field].tokens.at(-1);model.append(field);showContact(previous,'backspace',true)}else showSelection(field,'selection')});queueMicrotask(()=>focusNode(field));return}
 };
 const clipboard=(event:ClipboardEvent<HTMLDivElement>,field:RecipientField,cut=false)=>{
  const value=model.getState().fields[field];if(value.editing!==null||!value.selected.length)return;event.preventDefault();event.stopPropagation();event.clipboardData.setData('text/plain',model.selectedText(field));if(cut&&!locked()){change(()=>model.remove(field));queueMicrotask(()=>focusNode(field))}
 };
 const input=(field:RecipientField)=>{const value=state.fields[field];return <input key={'input-'+field} ref={node=>{if(node)inputs.current[field]=node;else delete inputs.current[field]}} id={identifier+'-'+field} aria-label={labels[field]} role="combobox" aria-autocomplete="list" aria-expanded={focused&&state.active===field&&suggestions.length>0} aria-controls={state.active===field?listId:undefined} aria-activedescendant={state.active===field&&suggestions.length?listId+'-'+highlight:undefined} readOnly={props.readOnly} autoComplete="off" spellCheck={false} value={value.input} style={{width:Math.max(2,Math.min(320,value.input.length*8+4))}} onFocus={()=>{model.focus(field);setFocused(true);publish()}} onChange={event=>change(()=>model.input(field,event.target.value))} onBlur={event=>{if(locked())return;const target=event.relatedTarget as Node|null;if(!target||!regions.current[field]?.contains(target)){commitModel(field);publish()}}}/>};
 return <div className="recipient-fields" ref={root} onFocus={()=>setFocused(true)} onBlur={event=>{if(!root.current?.contains(event.relatedTarget as Node|null)){setFocused(false);clearSuggestions()}}}>
  {recipientFields.filter(field=>field==='to'||state.expanded).map(field=>{const value=state.fields[field],editing=value.editing!==null,showInput=editing||!value.selected.length;return <div className="recipient-line recipient-row" key={field} role="group" aria-label={labels[field]+' recipients'} tabIndex={showInput?-1:0} ref={node=>{if(node)regions.current[field]=node;else delete regions.current[field]}} onKeyDown={event=>keydown(event,field)} onCopy={event=>clipboard(event,field)} onCut={event=>clipboard(event,field,true)} onPaste={event=>{if(locked()){event.preventDefault();return}if(model.getState().fields[field].input.trim())return;event.preventDefault();event.stopPropagation();change(()=>model.paste(field,event.clipboardData.getData('text/plain')));queueMicrotask(()=>focusNode(field))}}>
   <label htmlFor={identifier+'-'+field} onClick={()=>{change(()=>model.append(field));queueMicrotask(()=>focusNode(field))}}>{labels[field]}</label><div className="recipient-tokens" onMouseDown={event=>{if(event.target===event.currentTarget){event.preventDefault();change(()=>model.append(field));queueMicrotask(()=>focusNode(field))}}}>
    {value.tokens.map((token,index)=>editing&&value.editing===index?input(field):<span key={token.id} className={'recipient-chip'+(value.selected.includes(index)?' is-selected':'')+(!token.valid?' is-invalid':'')} title={token.raw}>
     <button type="button" tabIndex={-1} disabled={props.readOnly} aria-pressed={value.selected.includes(index)} aria-label={'Recipient '+(token.name?`${token.name} <${token.email}>`:token.raw)+(!token.valid?', invalid':'')} onMouseDown={event=>event.preventDefault()} onClick={event=>{change(()=>{model.select(field,index,event.shiftKey?'range':event.metaKey||event.ctrlKey?'toggle':'single');showSelection(field,'selection')});queueMicrotask(()=>focusNode(field))}} onDoubleClick={()=>{change(()=>model.edit(field,index));queueMicrotask(()=>focusNode(field,true))}}>{recipientLabel(token)}</button>
     {(index<value.tokens.length-1||(focused&&state.active===field&&!value.selected.length))&&<span className="recipient-separator" aria-hidden="true">•</span>}<button type="button" tabIndex={-1} disabled={props.readOnly} className="recipient-remove" aria-label={'Remove recipient '+token.email} onMouseDown={event=>event.preventDefault()} onClick={()=>{change(()=>model.remove(field,[index]));queueMicrotask(()=>focusNode(field))}}><Icon name="x" size={10}/></button>
    </span>)}{!editing&&showInput&&input(field)}
   </div>{field==='to'&&!state.expanded&&<button type="button" className="icon-button" tabIndex={-1} aria-label="Expand recipients" title="Expand recipients" disabled={props.readOnly} onClick={()=>change(()=>model.expand())}><Icon name="down" size={14}/></button>}
  </div>})}
  {focused&&!props.readOnly&&suggestions.length>0&&<div className="recipient-suggestions" role="listbox" ref={suggestionMenu} aria-label="Local recipient suggestions" id={listId} style={{position:'fixed',...position,width:'max-content',maxWidth:'calc(100vw - 24px)'}} onMouseDown={event=>event.preventDefault()}>{suggestions.map((contact,index)=><div role="option" aria-selected={highlight===index} aria-disabled={disabled(contact)} id={listId+'-'+index} key={contact.email.toLowerCase()} className={(highlight===index?'highlighted ':'')+(disabled(contact)?'disabled':'')} onMouseMove={()=>{if(!locked()){setHighlight(index);showContact(contact,'suggestion')}}} onClick={()=>{if(disabled(contact)||locked())return;change(()=>commitModel(state.active,contact));queueMicrotask(()=>focusNode(state.active))}}><span className="recipient-suggestion-name">{contact.name||contact.email}</span><span className="recipient-suggestion-email">{contact.email}</span></div>)}</div>}
  {focused&&loading&&<span className="recipient-hint" role="status">Looking up local contacts…</span>}{focused&&suggestionError&&<span className="recipient-hint" role="status">{suggestionError}</span>}
 </div>;
});
