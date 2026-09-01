'use client';

import { useCallback, useEffect, useState } from 'react';

interface Check {
  code: string;
  level: 'ok' | 'warn' | 'fail';
  message: string;
  action: string;
}

interface Preflight {
  ready: 'ready' | 'ready_with_warnings' | 'not_ready';
  checks: Check[];
  protocolVersion?: number;
  rehearsal?: boolean;
}

export default function PreflightPage() {
  const [data, setData] = useState<Preflight | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const response = await fetch('/api/actualplay/vtt/preflight', { credentials: 'include' });
    if (!response.ok) {
      setError('Preflight failed to load.');
      return;
    }
    setData((await response.json()) as Preflight);
    setError('');
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const ready = data?.ready ?? 'not_ready';
  return (
    <main className="side preflight">
      <h1 data-testid="view-title">Preflight</h1>
      <p className={`preflight-badge ${ready}`} data-testid="preflight-status">
        {ready === 'ready' ? 'Ready' : ready === 'ready_with_warnings' ? 'Ready with warnings' : 'Not ready'}
      </p>
      <p className="status">{error || (data?.rehearsal ? 'Dry-run / rehearsal QLab driver.' : 'Live QLab driver selected.')}</p>
      <button type="button" onClick={() => void load()}>
        refresh
      </button>
      <ul className="preflight-list">
        {(data?.checks ?? []).map((check) => (
          <li key={check.code} className={`check ${check.level}`} data-testid={`preflight-${check.code}`}>
            <strong>{check.level === 'ok' ? 'OK' : check.level === 'warn' ? 'WARN' : 'FAIL'}</strong>
            <span>{check.message}</span>
            <span className="status">{check.action}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
