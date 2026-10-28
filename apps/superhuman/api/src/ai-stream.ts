import { bytes } from './ai-chat-store.ts';

type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
export class AiStreamError extends Error { readonly code: string; constructor(code = 'ai_chat_invalid_stream', message = 'Claude returned an incomplete or invalid stream') { super(message); this.code = code; } }
export type ClaudeBlock = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Obj } | { type: 'thinking'; thinking: string; signature: string } | { type: 'redacted_thinking'; data: string };
export type ClaudeStreamResult = { id: string; blocks: ClaudeBlock[]; stopReason: string; inputTokens: number | null; outputTokens: number | null };
export type ClaudeProgress = { kind: 'text'; text: string } | { kind: 'thinking'; state: 'started' | 'finished' } | { kind: 'request_id'; id: string };

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => { const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); signal.addEventListener('abort', abort, { once: true }); promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); }); });
}
async function* frames(response: Response, signal: AbortSignal) {
  if (!response.body || !/^text\/event-stream(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new AiStreamError();
  const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true }); let pending = ''; let total = 0; let count = 0; let name = 'message'; let data: string[] = []; let frameBytes = 0;
  try {
    while (true) {
      const part = await abortable(reader.read(), signal);
      if (part.done) pending += decoder.decode();
      else { total += part.value.byteLength; if (total > 1000000) throw new AiStreamError('ai_chat_stream_limit', 'Claude stream exceeded the local byte limit'); pending += decoder.decode(part.value, { stream: true }); }
      // Process complete lines; a CR at a chunk boundary waits for its possible
      // LF. A single CRLF must never backtrack into two blank-line delimiters.
      while (true) {
        const at = pending.search(/[\r\n]/); if (at < 0 || !part.done && pending[at] === '\r' && at === pending.length - 1) break;
        const line = pending.slice(0, at); const width = pending[at] === '\r' && pending[at + 1] === '\n' ? 2 : 1; pending = pending.slice(at + width); frameBytes += bytes(line) + width; if (frameBytes > 128000) throw new AiStreamError('ai_chat_stream_limit');
        if (line !== '') { if (line.startsWith(':')) continue; const colon = line.indexOf(':'); const field = colon < 0 ? line : line.slice(0, colon); const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, ''); if (field === 'event') name = value; if (field === 'data') data.push(value); continue; }
        if (++count > 10000) throw new AiStreamError('ai_chat_stream_limit'); const eventName = name; const values = data; name = 'message'; data = []; frameBytes = 0;
        if (!values.length) continue; let value: unknown; try { value = JSON.parse(values.join('\n')); } catch { throw new AiStreamError(); }
        if (!object(value) || value.type !== eventName) throw new AiStreamError(); yield { name: eventName, value };
      }
      if (bytes(pending) > 128000) throw new AiStreamError('ai_chat_stream_limit');
      if (part.done) { if (pending.trim() || data.length) throw new AiStreamError(); break; }
    }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function readClaudeStream(response: Response, signal: AbortSignal, onProgress: (value: ClaudeProgress) => void): Promise<ClaudeStreamResult> {
  const blocks = new Map<number, { block: ClaudeBlock; open: boolean; json: string }>(); let started = false; let stopped = false; let id = ''; let stopReason = ''; let inputTokens: number | null = null; let outputTokens: number | null = null; let textBytes = 0;
  const emitText = (text: string) => { textBytes += bytes(text); if (textBytes > 32768) throw new AiStreamError('ai_chat_output_limit'); if (text) onProgress({ kind: 'text', text }); };
  const tokenCount = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
  for await (const event of frames(response, signal)) {
    const v = event.value;
    if (event.name === 'ping') continue;
    if (event.name === 'error') throw new AiStreamError('ai_chat_provider_stream_error', 'Claude reported a stream error; no complete answer was applied');
    if (event.name === 'message_start') {
      if (started || !object(v.message) || v.message.type !== 'message' || v.message.role !== 'assistant' || typeof v.message.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(v.message.id)) throw new AiStreamError();
      started = true; id = v.message.id; onProgress({ kind: 'request_id', id }); if (object(v.message.usage)) inputTokens = tokenCount(v.message.usage.input_tokens); continue;
    }
    if (['content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop'].includes(event.name) && !started) throw new AiStreamError();
    if (event.name === 'content_block_start') {
      if (!Number.isInteger(v.index) || Number(v.index) < 0 || Number(v.index) > 100 || blocks.has(Number(v.index)) || !object(v.content_block)) throw new AiStreamError();
      const b = v.content_block; let block: ClaudeBlock;
      if (b.type === 'text' && typeof b.text === 'string') { block = { type: 'text', text: b.text }; emitText(b.text); }
      else if (b.type === 'tool_use' && typeof b.id === 'string' && /^[\w-]{1,200}$/.test(b.id) && typeof b.name === 'string' && /^[\w-]{1,128}$/.test(b.name) && object(b.input)) { if (bytes(JSON.stringify(b.input)) > 16384) throw new AiStreamError('ai_chat_tool_input_limit'); block = { type: 'tool_use', id: b.id, name: b.name, input: b.input }; }
      else if (b.type === 'thinking' && typeof b.thinking === 'string') { if (bytes(b.thinking) > 65536 || typeof b.signature === 'string' && bytes(b.signature) > 16384) throw new AiStreamError('ai_chat_thinking_limit'); block = { type: 'thinking', thinking: b.thinking, signature: typeof b.signature === 'string' ? b.signature : '' }; onProgress({ kind: 'thinking', state: 'started' }); }
      else if (b.type === 'redacted_thinking' && typeof b.data === 'string') { if (bytes(b.data) > 65536) throw new AiStreamError('ai_chat_thinking_limit'); block = { type: 'redacted_thinking', data: b.data }; }
      else throw new AiStreamError('ai_chat_unsupported_provider_block');
      blocks.set(Number(v.index), { block, open: true, json: '' }); continue;
    }
    if (event.name === 'content_block_delta') {
      const entry = blocks.get(Number(v.index)); if (!Number.isInteger(v.index) || !entry?.open || !object(v.delta)) throw new AiStreamError(); const d = v.delta;
      if (d.type === 'text_delta' && entry.block.type === 'text' && typeof d.text === 'string') { entry.block.text += d.text; emitText(d.text); }
      else if (d.type === 'input_json_delta' && entry.block.type === 'tool_use' && typeof d.partial_json === 'string') { if (Object.keys(entry.block.input).length) throw new AiStreamError(); entry.json += d.partial_json; if (bytes(entry.json) > 16384) throw new AiStreamError('ai_chat_tool_input_limit'); }
      else if (d.type === 'thinking_delta' && entry.block.type === 'thinking' && typeof d.thinking === 'string') { entry.block.thinking += d.thinking; if (bytes(entry.block.thinking) > 65536) throw new AiStreamError('ai_chat_thinking_limit'); }
      else if (d.type === 'signature_delta' && entry.block.type === 'thinking' && typeof d.signature === 'string') { entry.block.signature += d.signature; if (bytes(entry.block.signature) > 16384) throw new AiStreamError(); }
      else throw new AiStreamError(); continue;
    }
    if (event.name === 'content_block_stop') {
      const entry = blocks.get(Number(v.index)); if (!Number.isInteger(v.index) || !entry?.open) throw new AiStreamError(); entry.open = false;
      if (entry.block.type === 'tool_use' && entry.json) { let parsed: unknown; try { parsed = JSON.parse(entry.json); } catch { throw new AiStreamError(); } if (!object(parsed)) throw new AiStreamError(); entry.block.input = parsed; }
      if (entry.block.type === 'thinking') onProgress({ kind: 'thinking', state: 'finished' }); continue;
    }
    if (event.name === 'message_delta') { if (!object(v.delta)) throw new AiStreamError(); if (typeof v.delta.stop_reason === 'string') stopReason = v.delta.stop_reason; if (object(v.usage)) { const n = tokenCount(v.usage.output_tokens); if (n !== null) outputTokens = n; } continue; }
    if (event.name === 'message_stop') { if ([...blocks.values()].some(v => v.open) || !stopReason) throw new AiStreamError(); stopped = true; break; }
    // Future top-level event names may be ignored, but cannot complete a turn.
  }
  if (!started || !stopped) throw new AiStreamError();
  const ordered = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, v]) => v.block); const toolIds = ordered.filter((v): v is Extract<ClaudeBlock, { type: 'tool_use' }> => v.type === 'tool_use').map(v => v.id); if (new Set(toolIds).size !== toolIds.length) throw new AiStreamError();
  return { id, blocks: ordered, stopReason, inputTokens, outputTokens };
}
