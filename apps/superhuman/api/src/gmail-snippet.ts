import { decodeHTMLStrict } from 'entities';

/** Fresh Gmail snippet only: return plain text after exactly one reference pass.
 * Never apply this to stored snippets or MIME text/plain/HTML bodies.
 */
export function gmailSnippetToText(rawSnippet: string): string {
  return decodeHTMLStrict(rawSnippet);
}
