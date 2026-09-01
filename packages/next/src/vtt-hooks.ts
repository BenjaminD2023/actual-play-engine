'use client';

import { useCallback, useEffect, useState } from 'react';
import type { VttSnapshot } from '@actualplay/protocol';

const API = '/api/actualplay';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

export function useVttSnapshot(_pollMs = 2000) {
  const [snapshot, setSnapshot] = useState<VttSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api<VttSnapshot>('/vtt/snapshot'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const source = new EventSource(`${API}/vtt/stream`);
    source.onmessage = () => {
      void refresh();
    };
    source.onerror = () => {
      void refresh();
    };
    return () => source.close();
  }, [refresh]);
  return { snapshot, error, refresh };
}

export async function sendVttCommand(body: unknown) {
  return api('/vtt/commands', { method: 'POST', body: JSON.stringify(body) });
}
