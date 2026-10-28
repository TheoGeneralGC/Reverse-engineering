declare module 'word-extractor' {
 export default class WordExtractor { extract(input:Buffer):Promise<{getBody():string;getFootnotes():string;getEndnotes():string;getHeaders():string;getFooters():string;getAnnotations():string;getTextboxes(options?:{includeHeadersAndFooters?:boolean;includeBody?:boolean}):string}> }
}
