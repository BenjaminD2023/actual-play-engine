'use client';

import { useEffect, useState } from 'react';
import { VttCanvas } from '@actualplay/vtt';
import { PROTOCOL_VERSION } from '@actualplay/protocol';
import { sendVttCommand, useVttSnapshot } from '../lib/client-api';

export function Console({ title, compact = false }: { title: string; compact?: boolean }) {
  const { snapshot, error, refresh } = useVttSnapshot(1500);
  const [log, setLog] = useState('ready');

  async function command(type: string, payload: Record<string, unknown>) {
    try {
      await sendVttCommand({
        id: crypto.randomUUID(),
        protocolVersion: PROTOCOL_VERSION,
        type,
        sessionId: snapshot?.sessionId,
        sceneInstanceId: snapshot?.sceneInstanceId,
        payload,
      });
      setLog(`${type} ok`);
      await refresh();
    } catch (err) {
      setLog(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="board">
      <div className="canvas-wrap">
        <VttCanvas live={snapshot?.live ?? null} camera={snapshot?.live?.camera} />
      </div>
      <aside className="side">
        <h1>{title}</h1>
        <p className="status">{error ?? log}</p>
        <p className="status">
          seq {snapshot?.lastEventSequence ?? 0} · {snapshot?.live?.title ?? 'no live scene'}
        </p>
        {!compact && (
          <>
            <p>
              <button onClick={() => void command('scene.create', { title: 'House map' })}>create scene</button>
            </p>
            <p>
              <button onClick={() => void command('ping.create', { x: 80, y: 80 })}>ping</button>
            </p>
            <p>
              <button className="danger" onClick={() => void command('recording.marker', { label: 'panic-mark' })}>
                marker
              </button>
            </p>
          </>
        )}
        <pre className="status">{JSON.stringify(snapshot?.live?.combat ?? {}, null, 2)}</pre>
      </aside>
    </div>
  );
}
