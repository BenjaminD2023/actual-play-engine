'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VttSnapshot } from '@actualplay/protocol';
import { PROTOCOL_VERSION } from '@actualplay/protocol';
import { VttConnection } from '@actualplay/vtt';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/actualplay${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = (await response.json()) as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(data.message || data.error || `Request failed: ${response.status}`);
  return data;
}

export function useVttSnapshot(_pollMs = 2000) {
  const [snapshot, setSnapshot] = useState<VttSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const conn = useRef<VttConnection | null>(null);
  if (!conn.current) conn.current = new VttConnection('/api/actualplay');
  const refresh = useCallback(async () => {
    try {
      setSnapshot(await conn.current!.loadSnapshot());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => {
    void refresh();
    return conn.current!.connect(() => {
      void refresh();
    });
  }, [refresh]);
  return { snapshot, error, refresh };
}

export async function sendVttCommand(body: unknown) {
  return api<Record<string, unknown>>('/vtt/commands', { method: 'POST', body: JSON.stringify(body) });
}

export async function fetchSnapshot() {
  return api<VttSnapshot>('/vtt/snapshot');
}

export async function commandOnSnapshot(
  snapshot: VttSnapshot | null,
  type: string,
  payload: Record<string, unknown>
) {
  if (!snapshot?.sessionId) throw new Error('No session');
  return sendVttCommand({
    id: crypto.randomUUID(),
    protocolVersion: PROTOCOL_VERSION,
    type,
    sessionId: snapshot.sessionId,
    sceneInstanceId: snapshot.sceneInstanceId,
    payload,
  });
}

export async function fetchPlayers() {
  return api<{ players: Array<{ id: string; auth_user_id: string | null; character_name: string; current_hp: number; max_hp: number }> }>(
    '/players'
  );
}

export async function fetchPolls() {
  return api<{
    polls: Array<{
      id: string;
      question: string;
      is_active: boolean;
      options: Array<{ id: string; option_text: string; vote_count: number }>;
    }>;
  }>('/polls');
}

export async function votePoll(pollId: string, optionId: string) {
  return api(`/polls/${pollId}/vote`, {
    method: 'POST',
    body: JSON.stringify({ optionId }),
  });
}

export async function adjustHp(playerId: string, delta: number) {
  return api(`/players/${playerId}/hp`, { method: 'POST', body: JSON.stringify({ delta }) });
}

export async function fetchSession() {
  return api<{ user: { id: string; username: string; role: string } | null }>('/auth/session');
}

export async function fetchLibrary() {
  return api<{
    scenes: Array<{ id: string; title: string; status: string; version: number }>;
    instances: Array<{ id: string; status: string; sceneId: string; title: string }>;
    presets: Array<{ id: string; name: string }>;
    handouts: Array<{ id: string; title: string }>;
    rundown: Array<{ id: string; title: string; state: string }>;
    qlab: { connected?: boolean; lastError?: string | null; kind?: string; host?: string; port?: number };
  }>('/vtt/library');
}

export async function panicQLab() {
  return api('/qlab/panic', { method: 'POST', body: '{}' });
}
