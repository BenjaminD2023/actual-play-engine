'use client';

import { useCallback, useEffect, useState } from 'react';

const API = '/api/actualplay';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

export function useQLabHealth(pollMs = 4000) {
  const [health, setHealth] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setHealth(await api('/qlab/health'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [pollMs, refresh]);

  return { health, error, refresh };
}

export function useFireLog(pollMs = 2000) {
  const [entries, setEntries] = useState<unknown[]>([]);

  const refresh = useCallback(async () => {
    const data = await api<{ entries: unknown[] }>('/log');
    setEntries(data.entries);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [pollMs, refresh]);

  return { entries, refresh };
}

export function fireShowCue(name: string) {
  return api(`/show/cues/${encodeURIComponent(name)}/trigger`, { method: 'POST' });
}

export function panic() {
  return api('/qlab/panic', { method: 'POST' });
}

export function useEngineEvents() {
  const [last, setLast] = useState<unknown>(null);

  useEffect(() => {
    const source = new EventSource(`${API}/events`);
    source.onmessage = (event) => {
      try {
        setLast(JSON.parse(event.data));
      } catch {
        setLast(event.data);
      }
    };
    return () => source.close();
  }, []);

  return { last };
}
