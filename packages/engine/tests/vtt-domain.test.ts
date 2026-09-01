import { describe, expect, it } from 'vitest';
import { ProtocolError } from '@actualplay/protocol';
import { harness } from './vtt-helpers.js';

describe('VTT domain', () => {
  it('includes sessionId in snapshots before a live instance exists', async () => {
    const h = await harness();
    const snap = h.vtt.snapshot(h.session.id, h.dm);
    expect(snap.sessionId).toBe(h.session.id);
    expect(snap.live).toBeNull();
    await h.engine.stop();
  });

  it('rejects unknown command types', async () => {
    const h = await harness();
    await expect(
      h.vtt.execute({ id: 'x', protocolVersion: 1, type: 'token.explode', sessionId: h.session.id, payload: {} }, h.dm)
    ).rejects.toBeInstanceOf(ProtocolError);
    await h.engine.stop();
  });

  it('publishes an immutable revision and live moves do not change it', async () => {
    const h = await harness();
    const created = await h.vtt.execute(h.cmd('scene.create', { title: 'Hall' }), h.dm);
    const sceneId = (created.result.scene as { id: string }).id;
    await h.vtt.execute(h.cmd('scene.updateDraft', { sceneId, title: 'Hall draft' }), h.dm);
    const published = await h.vtt.execute(h.cmd('scene.publish', { sceneId }), h.dm);
    const revisionId = (published.result.revision as { id: string }).id;
    const before = h.vtt.tables.getRevision(revisionId)!;
    const inst = await h.vtt.execute(h.cmd('scene.instantiate', { sceneId }), h.dm);
    const instanceId = (inst.result.instance as { id: string }).id;
    await h.vtt.execute({ ...h.cmd('scene.activate', { instanceId }), sceneInstanceId: instanceId }, h.dm);
    const token = await h.vtt.execute(
      { ...h.cmd('token.create', { name: 'Ranger', x: 0, y: 0, ownerUserId: 'user-p1', playerId: 'player-1' }), sceneInstanceId: instanceId },
      h.dm
    );
    const tokenId = (token.result.token as { id: string }).id;
    await h.vtt.execute({ ...h.cmd('token.move', { tokenId, x: 140, y: 70 }), sceneInstanceId: instanceId }, h.dm);
    const after = h.vtt.tables.getRevision(revisionId)!;
    expect(after.document).toEqual(before.document);
    expect(h.vtt.tables.getInstance(instanceId)!.state.tokens[0]?.x).toBe(140);
    await h.engine.stop();
  });

  it('enforces token ownership and omits hidden enemies from player snapshots', async () => {
    const h = await harness();
    const created = await h.vtt.execute(h.cmd('scene.create', { title: 'Cave' }), h.dm);
    const sceneId = (created.result.scene as { id: string }).id;
    await h.vtt.execute(h.cmd('scene.publish', { sceneId }), h.dm);
    const inst = await h.vtt.execute(h.cmd('scene.instantiate', { sceneId }), h.dm);
    const instanceId = (inst.result.instance as { id: string }).id;
    await h.vtt.execute({ ...h.cmd('scene.activate', { instanceId }), sceneInstanceId: instanceId }, h.dm);
    const a = await h.vtt.execute(
      { ...h.cmd('token.create', { name: 'Ranger', x: 0, y: 0, ownerUserId: 'user-p1', playerId: 'player-1' }), sceneInstanceId: instanceId },
      h.dm
    );
    const b = await h.vtt.execute(
      { ...h.cmd('token.create', { name: 'Cleric', x: 70, y: 0, ownerUserId: 'user-p2', playerId: 'player-2' }), sceneInstanceId: instanceId },
      h.dm
    );
    await h.vtt.execute(
      { ...h.cmd('token.create', { name: 'Lurker', x: 200, y: 200, visibility: 'hidden', disposition: 'enemy' }), sceneInstanceId: instanceId },
      h.dm
    );
    const tokenA = (a.result.token as { id: string }).id;
    const tokenB = (b.result.token as { id: string }).id;
    await expect(
      h.vtt.execute({ ...h.cmd('token.move', { tokenId: tokenB, x: 10, y: 10 }), sceneInstanceId: instanceId }, h.playerOne)
    ).rejects.toMatchObject({ code: 'forbidden' });
    await h.vtt.execute({ ...h.cmd('token.move', { tokenId: tokenA, x: 70, y: 70 }), sceneInstanceId: instanceId }, h.playerOne);
    const playerSnap = h.vtt.snapshot(h.session.id, h.playerOne, instanceId);
    expect(JSON.stringify(playerSnap)).not.toContain('Lurker');
    expect(JSON.stringify(h.vtt.snapshot(h.session.id, h.dm, instanceId))).toContain('Lurker');
    const broadcast = h.vtt.actorFrom({ userId: null, role: 'system', viewer: 'broadcast' });
    expect(JSON.stringify(h.vtt.snapshot(h.session.id, broadcast, instanceId))).not.toContain('Lurker');
    const projector = h.vtt.actorFrom({ userId: null, role: 'system', viewer: 'projector' });
    expect(JSON.stringify(h.vtt.snapshot(h.session.id, projector, instanceId))).not.toContain('Lurker');
    await h.engine.stop();
  });

  it('replays a durable command id and rejects a different body', async () => {
    const h = await harness();
    const created = await h.vtt.execute(h.cmd('scene.create', { title: 'Idem' }, 'create-1'), h.dm);
    const sceneId = (created.result.scene as { id: string }).id;
    const replay = await h.vtt.execute(h.cmd('scene.create', { title: 'Idem' }, 'create-1'), h.dm);
    expect(replay.duplicate).toBe(true);
    expect(h.vtt.tables.listScenes('default')).toHaveLength(1);
    await expect(h.vtt.execute(h.cmd('scene.create', { title: 'Other' }, 'create-1'), h.dm)).rejects.toMatchObject({
      code: 'duplicate_command',
    });
    expect(sceneId).toBeTruthy();
    await h.engine.stop();
  });

  it('supports fog, doors, grids, checkpoints, and replay without mutating live on preview', async () => {
    const h = await harness();
    const created = await h.vtt.execute(h.cmd('scene.create', { title: 'Grid' }), h.dm);
    const sceneId = (created.result.scene as { id: string }).id;
    await h.vtt.execute(h.cmd('scene.updateDraft', { sceneId, grid: { mode: 'gridless' } }), h.dm);
    await h.vtt.execute(h.cmd('scene.updateDraft', { sceneId, grid: { mode: 'hex-flat' } }), h.dm);
    await h.vtt.execute(h.cmd('scene.updateDraft', { sceneId, grid: { mode: 'hex-pointy' } }), h.dm);
    await h.vtt.execute(h.cmd('scene.updateDraft', { sceneId, grid: { mode: 'square' } }), h.dm);
    await h.vtt.execute(h.cmd('scene.publish', { sceneId }), h.dm);
    const inst = await h.vtt.execute(h.cmd('scene.instantiate', { sceneId }), h.dm);
    const instanceId = (inst.result.instance as { id: string }).id;
    await h.vtt.execute({ ...h.cmd('scene.activate', { instanceId }), sceneInstanceId: instanceId }, h.dm);
    await h.vtt.execute(
      { ...h.cmd('wall.create', { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, door: true }), sceneInstanceId: instanceId },
      h.dm
    );
    const doorId = h.vtt.tables.getInstance(instanceId)!.state.doors[0]!.id;
    await h.vtt.execute({ ...h.cmd('door.setState', { doorId, state: 'open' }), sceneInstanceId: instanceId }, h.dm);
    await h.vtt.execute(
      { ...h.cmd('fog.reveal', { shape: 'rect', points: [{ x: 0, y: 0 }, { x: 70, y: 70 }] }), sceneInstanceId: instanceId },
      h.dm
    );
    const cp = await h.vtt.execute({ ...h.cmd('checkpoint.create', { label: 'safe' }), sceneInstanceId: instanceId }, h.dm);
    await h.vtt.execute(
      { ...h.cmd('fog.hide', { shape: 'rect', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }), sceneInstanceId: instanceId },
      h.dm
    );
    const preview = await h.vtt.execute(
      h.cmd('checkpoint.previewRestore', { checkpointId: (cp.result.checkpoint as { id: string }).id }),
      h.dm
    );
    expect(preview.result.mutatesLive).toBe(false);
    expect(h.vtt.tables.getInstance(instanceId)!.state.fog).toHaveLength(2);
    await h.vtt.execute(h.cmd('checkpoint.restore', { checkpointId: (cp.result.checkpoint as { id: string }).id }), h.dm);
    expect(h.vtt.tables.getInstance(instanceId)!.state.fog).toHaveLength(1);
    expect(h.vtt.replay(h.session.id).some((frame) => frame.type === 'vtt.checkpoint.restored')).toBe(true);
    await h.engine.stop();
  });
});
