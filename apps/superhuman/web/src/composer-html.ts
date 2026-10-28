import createDOMPurify from 'dompurify';
import type { DOMPurify,WindowLike } from 'dompurify';

export type ComposerValue={body:string;html:string};
const purifiers=new WeakMap<Document,DOMPurify>();
const tags=['b','strong','i','em','u','s','strike','a','p','div','br','span','ul','ol','li','blockquote','pre','code','hr'];
const colorValue=/^(#[a-f\d]{3,4}|#[a-f\d]{6}(?:[a-f\d]{2})?|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)|black|white|red|green|blue|yellow|purple|orange|gray|grey|transparent|inherit)$/i;
const safeStyles:Record<string,RegExp>={
 color:colorValue,'background-color':colorValue,
 'font-weight':/^(normal|bold|[1-9]00)$/i,'font-style':/^(normal|italic|oblique)$/i,
 'font-size':/^(?:[89]|[1-6]\d|7[0-2])px$|^(?:[1-3](?:\.\d{1,2})?|4|0\.[5-9])(?:em|rem)$|^(?:xx-small|x-small|small|medium|large|x-large|xx-large)$/i,
 'font-family':/^["']?(?:Arial|Helvetica|Georgia|Times New Roman|Courier New|Verdana|Tahoma|Trebuchet MS|sans-serif|serif|monospace|system-ui)["']?$/i,
 'text-decoration':/^(none|underline|line-through|underline line-through|line-through underline)$/i,
 'text-align':/^(left|right|center|justify|start|end)$/i,'white-space':/^(normal|pre|pre-wrap|pre-line)$/i,
 'line-height':/^(?:normal|[1-2](?:\.\d{1,2})?|3)$/i,'margin-left':/^(?:0|[1-9]\d?|1[0-5]\d|160)px$|^(?:0|[1-8](?:\.\d{1,2})?)em$/i,
};

export function normalizeComposerLink(input:string):string|null{
 const value=input.trim();if(!value||/[\x00-\x20\x7f]/.test(value))return null;
 const candidate=/^[\w.+-]+@[^@]+\.[^@]+$/.test(value)?`mailto:${value}`:/^www\./i.test(value)?`https://${value}`:value;
 try{const url=new URL(candidate);return ['https:','http:','mailto:','tel:'].includes(url.protocol)?url.href:null}catch{return null}
}

export function sanitizeComposerFragment(html:string,document:Document):DocumentFragment{
 let purifier=purifiers.get(document);
 if(!purifier){if(!document.defaultView)throw new Error('The composer requires an attached document');purifier=createDOMPurify(document.defaultView as unknown as WindowLike);purifiers.set(document,purifier)}
 const fragment=purifier.sanitize(html,{ALLOWED_TAGS:tags,ALLOWED_ATTR:['href','style','target','rel','title','start'],ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false,RETURN_DOM_FRAGMENT:true});
 for(const element of fragment.querySelectorAll<HTMLElement>('*')){
  if(element.hasAttribute('style')){
   for(const name of Array.from(element.style)){const value=element.style.getPropertyValue(name).trim();if(!safeStyles[name]?.test(value))element.style.removeProperty(name)}
   if(!element.style.length)element.removeAttribute('style');
  }
  if(element.tagName!=='OL'||! /^[1-9]\d{0,5}$/.test(element.getAttribute('start')||''))element.removeAttribute('start');
  if(element.tagName==='A'){
   const href=normalizeComposerLink(element.getAttribute('href')||'');
   if(href){element.setAttribute('href',href);element.setAttribute('rel','noopener noreferrer');element.setAttribute('target','_blank')}
   else{element.removeAttribute('href');element.removeAttribute('target');element.removeAttribute('rel')}
  }else{element.removeAttribute('href');element.removeAttribute('target');element.removeAttribute('rel')}
 }
 return fragment;
}

export function plainTextToComposerHTML(value:string):string{
 const escaped=value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 return escaped.replace(/\r\n?/g,'\n').split('\n').map(line=>`<div>${line||'<br>'}</div>`).join('');
}

export function composerValueFromHTML(html:string,document:Document):ComposerValue{
 const fragment=sanitizeComposerFragment(html,document);let body='';
 const blocks=new Set(['DIV','P','LI','BLOCKQUOTE','PRE']);
 const visit=(node:Node)=>{
  if(node.nodeType===3){body+=(node.nodeValue||'').replace(/\u200b/g,'');return}
  if(node.nodeType!==1&&node.nodeType!==11)return;
  const name=node.nodeName;
  if(name==='BR'){body+='\n';return}
  if(name==='HR'){if(body&&!body.endsWith('\n'))body+='\n';body+='---\n';return}
  const block=blocks.has(name);if(block&&body&&!body.endsWith('\n'))body+='\n';
  for(const child of node.childNodes)visit(child);
  if(block&&!body.endsWith('\n'))body+='\n';
 };
 visit(fragment);if(body.endsWith('\n'))body=body.slice(0,-1);
 const container=document.createElement('div');container.append(fragment);
 return{html:container.innerHTML,body:body.replace(/\u00a0/g,' ')};
}
