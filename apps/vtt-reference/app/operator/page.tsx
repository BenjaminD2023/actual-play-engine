'use client';

import { sendVttCommand } from '../../lib/client-api';
import { PROTOCOL_VERSION } from '@actualplay/protocol';

export default function OperatorPage() {
  async function fire(type: string, payload: Record<string, unknown> = {}) {
    await sendVttCommand({ id: crypto.randomUUID(), protocolVersion: PROTOCOL_VERSION, type, sessionId: 'active', payload });
  }
  return (
    <main className="side" style={{ display: 'grid', gap: 12, padding: 16 }}>
      <h1>Mobile operator</h1>
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
