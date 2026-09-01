'use client';

import { commandOnSnapshot, useVttSnapshot } from '../../lib/client-api';

export default function OperatorPage() {
  const { snapshot, error, refresh } = useVttSnapshot(2000);
  async function fire(type: string, payload: Record<string, unknown> = {}) {
    await commandOnSnapshot(snapshot, type, payload);
    await refresh();
  }
  return (
    <main className="side operator" data-view="operator" style={{ display: 'grid', gap: 12, padding: 16 }}>
      <h1 data-testid="view-title">Mobile operator</h1>
      <p className="status">{error ?? snapshot?.live?.title ?? 'no live scene'}</p>
      <button onClick={() => void fire('combat.nextTurn')}>next turn</button>
      <button onClick={() => void fire('combat.previousTurn')}>previous turn</button>
      <button onClick={() => void fire('rundown.advance')}>advance rundown</button>
      <button onClick={() => void fire('rundown.goBack')}>go back</button>
      <button onClick={() => void fire('camera.focusInitiative')}>focus active</button>
      <button onClick={() => void fire('poll.open', { question: 'What now?', options: ['Fight', 'Talk'] })}>open poll</button>
      <button onClick={() => void fire('recording.marker', { label: 'op' })}>marker</button>
      <button className="danger" onClick={() => void fire('announcement.show', { text: 'Hold' })}>
        announce
      </button>
    </main>
  );
}
