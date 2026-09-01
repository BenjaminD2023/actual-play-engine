import { describe, expect, it } from 'vitest';
import { MockQLabServer } from '../src/mock-qlab/server.js';
import { createEngine } from '../src/engine.js';
import { VttRuntime } from '../src/vtt/runtime.js';
import { harness } from './vtt-helpers.js';

describe('simulate-vtt production scenario', () => {
  it('runs the required show-control scenario against SQLite-or-memory runtime', async () => {
    const h = await harness();
    const created = await h.vtt.execute(h.cmd('scene.create', { title: 'Stage A' }), h.dm);
    const sceneId = (created.result.scene as { id: string }).id;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const asset = h.vtt.uploadAsset(png, 'map.png', h.dm, 'image/png');
    await h.vtt.execute(h.cmd('scene.updateDraft', { sceneId, mapAssetId: asset.id, grid: { mode: 'square' } }), h.dm);
    await h.vtt.execute(h.cmd('scene.publish', { sceneId }), h.dm);
    const inst = await h.vtt.execute(h.cmd('scene.instantiate', { sceneId }), h.dm);
    const instanceId = (inst.result.instance as { id: string }).id;
    await h.vtt.execute({ ...h.cmd('scene.stage', { instanceId }), sceneInstanceId: instanceId }, h.dm);
    const preset = h.vtt.createPreset('open', [{ type: 'activate_scene', payload: {} }]);
    h.vtt.addRundown(h.session.id, 'Top of show', { preset_id: preset.id, scene_id: sceneId });
    const encounter = h.vtt.createEncounter('Wolves', [{ name: 'Wolf', disposition: 'enemy' }]);
    h.vtt.createHandout('Map note', 'Public briefing', 'public');
    await h.vtt.execute({ ...h.cmd('showPreset.run', { presetId: preset.id }), sceneInstanceId: instanceId }, h.dm);
    expect(h.vtt.tables.getInstance(instanceId)?.status).toBe('live');
    await h.vtt.execute(
      { ...h.cmd('token.create', { name: 'Ranger', ownerUserId: 'user-p1', playerId: 'player-1' }), sceneInstanceId: instanceId },
      h.dm
    );
    await h.vtt.execute({ ...h.cmd('encounter.spawn', { encounterId: encounter.id, x: 200, y: 0 }), sceneInstanceId: instanceId }, h.dm);
    const seq = h.vtt.tables.lastSequence(h.session.id);
    const gap = h.vtt.eventsSince(h.session.id, seq - 1);
    expect(gap.length).toBeGreaterThan(0);
    const preflight = h.vtt.preflight(h.session.id);
    expect(preflight.ready === 'ready' || preflight.ready === 'ready_with_warnings').toBe(true);
    await h.engine.stop();
  });

  it('keeps dropped QLab replies unconfirmed in a preset step', async () => {
    const server = new MockQLabServer({ replyTimeoutMs: undefined });
    const { host, port } = await server.start();
    const engine = createEngine({
      qlab: { host, port, replyTimeoutMs: 200, heartbeatIntervalMs: 60_000, reconnectMinMs: 10_000 },
      cues: { 'show.welcome': '1' },
    });
    await engine.start();
    server.dropNext(4);
    const vtt = new VttRuntime(engine);
    const session = engine.ensureSession('qlab');
    const actor = vtt.actorFrom({ userId: 'dm', role: 'dm' });
    const preset = vtt.createPreset('cue', [{ type: 'qlab_cue', payload: { cueName: 'show.welcome' } }]);
    const outcome = await vtt.execute(
      { id: 'preset-1', protocolVersion: 1, type: 'showPreset.run', sessionId: session.id, payload: { presetId: preset.id } },
      actor
    );
    const steps = outcome.result.steps as Array<{ status: string }>;
    expect(steps[0]?.status).toBe('unconfirmed');
    expect(steps[0]?.status).not.toBe('ok');
    await engine.stop();
    await server.stop();
  });
});
