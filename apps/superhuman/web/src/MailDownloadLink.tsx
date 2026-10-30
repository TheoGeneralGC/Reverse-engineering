import { useEffect, useRef, useState, type ReactNode } from 'react';
import { hostedMailTransportEnabled } from './mail-fetch.ts';
import { downloadMailFile } from './mail-download.ts';

export default function MailDownloadLink({ path, name, children, onError }: { path: string; name: string; children: ReactNode; onError?: (message: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), active = useRef<AbortController | null>(null);
  useEffect(() => { setBusy(false); setError(''); return () => { active.current?.abort(); active.current = null; }; }, [path, name]);
  return <><a href={path} download={name} aria-busy={busy || undefined} onClick={event => {
    if (!hostedMailTransportEnabled()) return;
    event.preventDefault(); if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError('');
    void downloadMailFile(path, name, { signal: controller.signal }).catch(() => {
      if (!controller.signal.aborted) { const message = 'This file could not be downloaded.'; if (onError) onError(message); else setError(message); }
    }).finally(() => { if (active.current === controller) { active.current = null; if (!controller.signal.aborted) setBusy(false); } });
  }}>{children}</a>{error && <small role="alert">{error}</small>}</>;
}
