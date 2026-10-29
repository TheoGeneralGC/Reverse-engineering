import { composerValueFromHTML,plainTextToComposerHTML } from '../../composer-html.ts';
export type ComposerQuotedBody=Readonly<{reply:string;quote:string}>;
const plain=(html:string,document:Document)=>composerValueFromHTML(html,document).body;
/** A presentation-only map of the proved formatter tail. It grants no save or
 * ownership authority. Every comparison is of the complete relevant region. */
export function composerQuotedTail(root:HTMLElement,parts:ComposerQuotedBody,matchReply=true):HTMLElement[]|null{
 const lines=parts.quote.split('\n');if(lines.length<2||lines.slice(1).some(line=>!line.startsWith('> ')))return null;
 const source=lines.slice(1).map(line=>line.slice(2)).join('\n'),document=root.ownerDocument;
 const quote=root.lastElementChild;if(!(quote instanceof document.defaultView!.HTMLElement)||quote.tagName!=='BLOCKQUOTE'||root.querySelectorAll('blockquote').length!==1)return null;
 const attribution=quote.previousElementSibling;if(!(attribution instanceof document.defaultView!.HTMLElement)||!['DIV','P'].includes(attribution.tagName)||attribution.textContent!==lines[0])return null;
 if(plain(quote.outerHTML,document)!==plain(plainTextToComposerHTML(source),document))return null;
 const prefix=document.createElement('div');for(const node of Array.from(root.childNodes)){if(node===attribution)break;prefix.append(node.cloneNode(true))}
 if(matchReply&&plain(prefix.innerHTML,document).replace(/\n+$/,'')!==plain(plainTextToComposerHTML(parts.reply),document).replace(/\n+$/,''))return null;
 const before=attribution.previousElementSibling,tail:HTMLElement[]=[attribution,quote];if(before instanceof document.defaultView!.HTMLElement&&!plain(before.outerHTML,document))tail.unshift(before);
 return tail;
}
