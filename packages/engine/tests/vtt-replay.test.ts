import { describe, expect, it } from 'vitest';
import { harness } from './vtt-helpers.js';

describe('VTT replay reconstruction', () => {
  it('rebuilds an earlier token position without mutating live state', async () => {
    const h = await harness();
    const created = await h.vtt.execute(h.cmd('scene.create', { title: 'Replay hall' }), h.dm);
    const sceneId = (created.result.scene as { id: string }).id;
    await h.vtt.execute(h.cmd('scene.publish', { sceneId }), h.dm);
    const inst = await h.vtt.execute(h.cmd('scene.instantiate', { sceneId }), h.dm);
    const instanceId = (inst.result.instance as { id: string }).id;
    await h.vtt.execute({ ...h.cmd('scene.activate', { instanceId }), sceneInstanceId: instanceId }, h.dm);
    const token = await h.vtt.execute(
      { ...h.cmd('token.create', { name: 'Ranger', x: 0, y: 0 }), sceneInstanceId: instanceId },
      h.dm
    );
    const tokenId = (token.result.token as { id: string }).id;
    const beforeSeq = h.vtt.tables.lastSequence(h.session.id);
    const versionBefore = h.vtt.tables.getInstance(instanceId)!.version;
    await h.vtt.execute({ ...h.cmd('token.move', { tokenId, x: 210, y: 70 }), sceneInstanceId: instanceId }, h.dm);
    expect(h.vtt.tables.getInstance(instanceId)!.state.tokens[0]?.x).toBe(210);

    const reconstructed = h.vtt.replayAt(h.session.id, beforeSeq, h.dm);
    expect(reconstructed.liveMutated).toBe(false);
    expect(reconstructed.live?.tokens.find((item) => item.id === tokenId)?.x).toBe(0);
    expect(h.vtt.tables.getInstance(instanceId)!.state.tokens[0]?.x).toBe(210);
    expect(h.vtt.tables.getInstance(instanceId)!.version).toBe(versionBefore + 1);
    const csv = h.vtt.exportReplayCsv(h.session.id);
    expect(csv.startsWith('sequence,at,category,type')).toBe(true);
    expect(csv).toContain('vtt.token.changed');
    await h.engine.stop();
  });
});
