'use client';

import { useEffect, useState } from 'react';
import { commandOnSnapshot, fetchLibrary, panicQLab, useVttSnapshot } from '../../lib/client-api';

export default function OperatorPage() {
  const { snapshot, error, refresh } = useVttSnapshot(2000);
  const [library, setLibrary] = useState<Awaited<ReturnType<typeof fetchLibrary>> | null>(null);
  async function fire(type: string, payload: Record<string, unknown> = {}) {
    await commandOnSnapshot(snapshot, type, payload);
    await refresh();
    setLibrary(await fetchLibrary().catch(() => library));
  }
  useEffect(() => {
    void fetchLibrary().then(setLibrary).catch(() => undefined);
  }, []);
  const live = snapshot?.live;
  const staged = library?.instances.find((instance) => instance.status === 'staged');
  const instanceId = live?.instanceId ?? staged?.id;
  const qlab = library?.qlab;
  return (
    <main className="side operator" data-view="operator" style={{ display: 'grid', gap: 12, padding: 16 }}>
      <h1 data-testid="view-title">Mobile operator</h1>
      <p className="status">{error ?? live?.title ?? 'no live scene'}</p>
      {error && (
        <p className="status" data-testid="connection-loss" role="alert">
          Connection lost. Retrying…
        </p>
      )}
      <p data-testid="qlab-status">
        QLab {qlab?.connected ? 'connected' : qlab?.kind === 'dry-run' ? 'dry-run' : 'disconnected'} {qlab?.lastError ?? ''}
      </p>
      <p>
        Live {live?.status ?? 'none'} · staged {staged?.title ?? 'none'}
      </p>
      <button onClick={() => void fire('scene.activate', { instanceId })}>activate scene</button>
      <button
        onClick={() => {
          const presetId = library?.presets[0]?.id;
          if (presetId) void fire('showPreset.run', { presetId });
        }}
      >
        run preset
      </button>
      <button onClick={() => void fire('combat.nextTurn')}>next turn</button>
      <button onClick={() => void fire('combat.previousTurn')}>previous turn</button>
      <button onClick={() => void fire('camera.focusInitiative')}>focus active</button>
      <button onClick={() => void fire('rundown.advance')}>advance rundown</button>
      <button onClick={() => void fire('rundown.goBack')}>go back</button>
      <button onClick={() => void fire('poll.open', { question: 'What now?', options: ['Fight', 'Talk'] })}>open poll</button>
      <button
        onClick={() => {
          const handoutId = library?.handouts[0]?.id;
          if (handoutId) void fire('handout.show', { handoutId });
        }}
      >
        show handout
      </button>
      <button
        onClick={() => {
          const handoutId = library?.handouts[0]?.id;
          if (handoutId) void fire('handout.hide', { handoutId });
        }}
      >
        hide handout
      </button>
      <button onClick={() => void fire('recording.marker', { label: 'op' })}>marker</button>
      <button className="danger" onClick={() => void fire('announcement.show', { text: 'Hold' })}>
        announce
      </button>
      <button
        className="danger"
        onClick={() => {
          void panicQLab();
        }}
      >
        panic
      </button>
    </main>
  );
}
