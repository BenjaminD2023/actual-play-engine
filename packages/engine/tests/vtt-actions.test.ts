import { afterEach, describe, expect, it } from 'vitest';
import { createEngine } from '../src/engine.js';
import { MockQLabServer } from '../src/mock-qlab/server.js';
import { harness } from './vtt-helpers.js';

describe('registered action catalog', () => {
  it('routes MIDI recording_marker through VTT without mutating via unknown-command success', async () => {
    const h = await harness();
    const result = await h.engine.ingestMidi(
      { actionType: 'recording_marker', actionData: { label: 'midi-act' } },
      'midi'
    );
    expect(result?.ok).toBe(true);
    expect(result?.type).toBe('vtt.action');
    expect(h.vtt.tables.listMarkers(h.session.id).some((row) => row.label === 'midi-act')).toBe(true);
    await h.engine.stop();
  });

  it('presses a virtual button through the same catalog', async () => {
    const h = await harness();
    const button = h.engine.store.upsertVirtualButton({
      id: 'btn-mark',
      position: 0,
      label: 'Mark',
      color: '#333',
      action_type: 'recording_marker',
      action_data: { label: 'from-button' },
      key_bind: '',
      is_active: true,
    });
    const result = await h.engine.pressVirtualButton(button.id, 'dm');
    expect(result?.ok).toBe(true);
    expect(h.vtt.tables.listMarkers(h.session.id).some((row) => row.label === 'from-button')).toBe(true);
    await h.engine.stop();
  });

  it('keeps a MIDI qlab_cue unconfirmed when QLab drops the reply', async () => {
    const server = new MockQLabServer({ replyTimeoutMs: undefined });
    const { host, port } = await server.start();
    const engine = createEngine({
      qlab: { host, port, replyTimeoutMs: 200, heartbeatIntervalMs: 60_000, reconnectMinMs: 10_000 },
      cues: { 'show.welcome': '1' },
      vtt: { enabled: true },
    });
    await engine.start();
    engine.ensureSession('midi-qlab');
    server.dropNext(4);
    const result = await engine.ingestMidi(
      { actionType: 'qlab_cue', actionData: { cueName: 'show.welcome' } },
      'midi'
    );
    expect(result?.status).toBe('unconfirmed');
    expect(result?.ok).toBe(false);
    await engine.stop();
    await server.stop();
  });

  it('rejects unknown CommandBus types instead of returning ok', async () => {
    const engine = createEngine({ qlab: { dryRun: true }, cues: { 'show.welcome': '1' } });
    await engine.start();
    const result = await engine.dispatch({
      id: 'unknown-1',
      type: 'vtt.action',
      source: 'dm',
      payload: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown command type/);
    await engine.stop();
  });

  it('does not execute VTT commands when the safety switch is off', async () => {
    const engine = createEngine({ qlab: { dryRun: true }, vtt: { enabled: false } });
    await engine.start();
    const session = engine.ensureSession('off');
    await expect(
      engine.vtt.execute(
        { id: 'off-1', protocolVersion: 1, type: 'scene.create', sessionId: session.id, payload: { title: 'Nope' } },
        engine.vtt.actorFrom({ userId: 'dm', role: 'dm' })
      )
    ).rejects.toMatchObject({ code: 'unavailable' });
    await engine.stop();
  });
});
