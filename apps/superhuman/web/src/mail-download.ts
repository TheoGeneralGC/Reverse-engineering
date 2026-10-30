import { mailFetch, type MailFetch } from './mail-fetch.ts';

function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.hidden = true; document.body.append(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}
/** Only explicit attachment/source controls call this; filenames come from their existing data. */
export async function downloadMailFile(path: string, name: string, options: { request?: MailFetch; signal?: AbortSignal; save?: (blob: Blob, name: string) => void | Promise<void> } = {}): Promise<void> {
  if (!name || /[\x00-\x1f\x7f]/.test(name)) throw new Error('This file could not be downloaded.');
  const response = await (options.request ?? mailFetch)(path, { signal: options.signal, cache: 'no-store' });
  if (!response.ok) throw new Error('This file could not be downloaded.');
  const blob = await response.blob(); options.signal?.throwIfAborted(); await (options.save ?? saveFile)(blob, name);
}
