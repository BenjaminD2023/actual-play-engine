import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MockQLabServer } from '../src/mock-qlab/server.js';
import { createEngine } from '../src/engine.js';
import { sqliteStore } from '../src/store/sqlite.js';
import { VttRuntime } from '../src/vtt/runtime.js';
import { harness } from './vtt-helpers.js';
import { importScenePackage } from '../src/vtt/pack.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('simulate-vtt production scenario', () => {
  it('runs Phase N against SqliteStore and the shipped VttRuntime', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-phase-n-'));
    dirs.push(dir);
    const dbPath = path.join(dir, 'show.db');
    const h = await harness(sqliteStore(dbPath));
    const created = await h.vtt.execute(h.cmd('scene.create', { title: 'Stage A' }), h.dm);
    const sceneId = (created.result.scene as { id: string }).id;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const asset = h.vtt.uploadAsset(png, 'map.png', h.dm, 'image/png');
    await h.vtt.execute(h.cmd('scene.updateDraft', { sceneId, mapAssetId: asset.id, grid: { mode: 'gridless' } }), h.dm);
    await h.vtt.execute(h.cmd('scene.updateDraft', { sceneId, grid: { mode: 'hex-flat' } }), h.dm);
    await h.vtt.execute(h.cmd('scene.updateDraft', { sceneId, grid: { mode: 'hex-pointy' } }), h.dm);
    await h.vtt.execute(h.cmd('scene.updateDraft', { sceneId, grid: { mode: 'square' } }), h.dm);
    const published = await h.vtt.execute(h.cmd('scene.publish', { sceneId }), h.dm);
    const revisionId = (published.result.revision as { id: string }).id;
    const frozen = h.vtt.tables.getRevision(revisionId)!;
    const inst = await h.vtt.execute(h.cmd('scene.instantiate', { sceneId }), h.dm);
    const instanceId = (inst.result.instance as { id: string }).id;
    await h.vtt.execute({ ...h.cmd('scene.stage', { instanceId }), sceneInstanceId: instanceId }, h.dm);
    const a = await h.vtt.execute(
      { ...h.cmd('token.create', { name: 'Ranger', x: 70, y: 70, ownerUserId: 'user-p1', playerId: 'player-1' }), sceneInstanceId: instanceId },
      h.dm
    );
    const b = await h.vtt.execute(
      { ...h.cmd('token.create', { name: 'Cleric', x: 180, y: 70, ownerUserId: 'user-p2', playerId: 'player-2' }), sceneInstanceId: instanceId },
      h.dm
    );
    await h.vtt.execute(
      { ...h.cmd('token.create', { name: 'Lurker', x: 400, y: 240, visibility: 'hidden', disposition: 'enemy' }), sceneInstanceId: instanceId },
      h.dm
    );
    await h.vtt.execute(
      { ...h.cmd('wall.create', { a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, door: true, kind: 'wall' }), sceneInstanceId: instanceId },
      h.dm
    );
    await h.vtt.execute(
      { ...h.cmd('wall.create', { a: { x: 0, y: 80 }, b: { x: 200, y: 80 }, kind: 'window' }), sceneInstanceId: instanceId },
      h.dm
    );
    await h.vtt.execute({ ...h.cmd('light.create', { x: 100, y: 100, bright: 80, dim: 160 }), sceneInstanceId: instanceId }, h.dm);
    await h.vtt.execute(
      { ...h.cmd('fog.reveal', { shape: 'rect', points: [{ x: 0, y: 0 }, { x: 70, y: 70 }] }), sceneInstanceId: instanceId },
      h.dm
    );
    await h.vtt.execute(
      { ...h.cmd('annotation.upsert', { kind: 'text', text: 'hold', points: [{ x: 20, y: 20 }] }), sceneInstanceId: instanceId },
      h.dm
    );
    await h.vtt.execute(
      { ...h.cmd('template.upsert', { kind: 'circle', origin: { x: 90, y: 90 }, length: 70 }), sceneInstanceId: instanceId },
      h.dm
    );
    await h.vtt.execute(
      { ...h.cmd('terrain.upsert', { points: [{ x: 40, y: 40 }], multiplier: 2, label: 'difficult' }), sceneInstanceId: instanceId },
      h.dm
    );
    const doorId = h.vtt.tables.getInstance(instanceId)!.state.doors[0]!.id;
    const tokenA = (a.result.token as { id: string }).id;
    const tokenB = (b.result.token as { id: string }).id;
    await h.vtt.execute({ ...h.cmd('token.setCondition', { tokenId: tokenA, condition: 'blessed' }), sceneInstanceId: instanceId }, h.dm);
    await h.vtt.execute({ ...h.cmd('token.setAura', { tokenId: tokenA, radius: 40, label: 'ward' }), sceneInstanceId: instanceId }, h.dm);
    const encounter = h.vtt.createEncounter('Wolves', [{ name: 'Wolf', disposition: 'enemy' }]);
    h.vtt.createHandout('Map note', 'Public briefing', 'public');
    const preset = h.vtt.createPreset('open', [
      { type: 'activate_scene', payload: { instanceId } },
      { type: 'announcement', payload: { text: 'Places' } },
    ]);
    h.vtt.addRundown(h.session.id, 'Top of show', { preset_id: preset.id, scene_id: sceneId });
    await h.vtt.execute({ ...h.cmd('showPreset.run', { presetId: preset.id }), sceneInstanceId: instanceId }, h.dm);
    expect(h.vtt.tables.getInstance(instanceId)?.status).toBe('live');
    expect(h.vtt.tables.getRevision(revisionId)!.document).toEqual(frozen.document);

    await expect(
      h.vtt.execute({ ...h.cmd('token.move', { tokenId: tokenB, x: 10, y: 10 }), sceneInstanceId: instanceId }, h.playerOne)
    ).rejects.toMatchObject({ code: 'forbidden' });
    await h.vtt.execute({ ...h.cmd('token.move', { tokenId: tokenA, x: 140, y: 70 }), sceneInstanceId: instanceId }, h.playerOne);
    const playerSnap = JSON.stringify(h.vtt.snapshot(h.session.id, h.playerOne, instanceId));
    expect(playerSnap).not.toContain('Lurker');
    expect(JSON.stringify(h.vtt.snapshot(h.session.id, h.dm, instanceId))).toContain('Lurker');

    await h.vtt.execute({ ...h.cmd('door.setState', { doorId, state: 'open' }), sceneInstanceId: instanceId }, h.dm);
    await h.vtt.execute({ ...h.cmd('encounter.spawn', { encounterId: encounter.id, x: 260, y: 0 }), sceneInstanceId: instanceId }, h.dm);
    await h.vtt.execute({ ...h.cmd('combat.nextTurn', {}), sceneInstanceId: instanceId }, h.dm);
    const hpBefore = h.engine.store.getPlayer('player-1')!.current_hp;
    h.engine.updatePlayerHp('player-1', -2);
    expect(h.engine.store.getPlayer('player-1')!.current_hp).toBe(hpBefore - 2);

    await h.vtt.execute(h.cmd('poll.open', { question: 'Hold or go?', options: ['Hold', 'Go'] }), h.dm);
    const poll = h.engine.store.listPolls(h.session.id)[0]!;
    const option = h.engine.store.listPollOptions(poll.id)[0]!;
    h.engine.vote(poll.id, option.id, 'aud-1');
    await h.vtt.execute(h.cmd('handout.show', { handoutId: h.vtt.tables.listHandouts()[0]!.id }), h.dm);
    await h.vtt.execute(h.cmd('rundown.advance', {}), h.dm);
    await h.vtt.handleRegisteredAction('recording_marker', { label: 'midi-mark' }, h.dm, h.session.id);
    const midiMark = await h.engine.ingestMidi(
      { actionType: 'recording_marker', actionData: { label: 'ingest-midi' } },
      'midi'
    );
    expect(midiMark?.ok).toBe(true);
    expect(h.vtt.tables.listMarkers(h.session.id).some((row) => row.label === 'ingest-midi')).toBe(true);

    const cmdId = 'phase-n-move';
    await h.vtt.execute({ ...h.cmd('token.move', { tokenId: tokenA, x: 280, y: 70 }, cmdId), sceneInstanceId: instanceId }, h.dm);
    const dup = await h.vtt.execute({ ...h.cmd('token.move', { tokenId: tokenA, x: 280, y: 70 }, cmdId), sceneInstanceId: instanceId }, h.dm);
    expect(dup.duplicate).toBe(true);

    const cp = await h.vtt.execute({ ...h.cmd('checkpoint.create', { label: 'safe' }), sceneInstanceId: instanceId }, h.dm);
    const checkpointId = (cp.result.checkpoint as { id: string }).id;
    await h.vtt.execute(
      { ...h.cmd('fog.hide', { shape: 'rect', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }), sceneInstanceId: instanceId },
      h.dm
    );
    const preview = await h.vtt.execute(h.cmd('checkpoint.previewRestore', { checkpointId }), h.dm);
    expect(preview.result.mutatesLive).toBe(false);
    const fogBeforeRestore = h.vtt.tables.getInstance(instanceId)!.state.fog.length;
    await h.vtt.execute(h.cmd('checkpoint.restore', { checkpointId }), h.dm);
    expect(h.vtt.tables.getInstance(instanceId)!.state.fog.length).toBeLessThan(fogBeforeRestore);

    const packed = h.vtt.exportScene(sceneId);
    const imported = importScenePackage(packed);
    expect(imported.manifest.checksum).toBe(packed.manifest.checksum);
    await h.vtt.importScene(packed, h.dm, h.session.id);

    const seq = h.vtt.tables.lastSequence(h.session.id);
    const reconstructed = h.vtt.replayAt(h.session.id, seq, h.dm);
    expect(reconstructed.liveMutated).toBe(false);
    const csv = h.vtt.exportReplayCsv(h.session.id);
    expect(csv.split('\n').length).toBeGreaterThan(2);

    await h.engine.stop();
    const reopened = sqliteStore(dbPath);
    expect(reopened.getPlayer('player-1')?.character_name).toBe('Ranger');
    const vtt2 = new VttRuntime(createEngine({ store: reopened, qlab: { dryRun: true } }));
    expect(vtt2.tables.listScenes('default').length).toBeGreaterThan(0);
    const flight = vtt2.preflight(h.session.id);
    expect(flight.ready === 'ready' || flight.ready === 'ready_with_warnings').toBe(true);
    expect(flight.checks.some((check) => check.code === 'database' && check.level === 'ok')).toBe(true);
    reopened.close();
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
