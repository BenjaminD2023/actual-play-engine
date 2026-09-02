import { describe, expect, it } from 'vitest';
import { harness } from './vtt-helpers.js';

describe('VTT heavy-scene performance', () => {
  it('moves a token and projects a 200-token / 200-wall scene without multi-second stalls', async () => {
    const h = await harness();
    const created = await h.vtt.execute(h.cmd('scene.create', { title: 'Heavy' }), h.dm);
    const sceneId = (created.result.scene as { id: string }).id;
    await h.vtt.execute(h.cmd('scene.publish', { sceneId }), h.dm);
    const inst = await h.vtt.execute(h.cmd('scene.instantiate', { sceneId }), h.dm);
    const instanceId = (inst.result.instance as { id: string }).id;
    await h.vtt.execute({ ...h.cmd('scene.activate', { instanceId }), sceneInstanceId: instanceId }, h.dm);

    const seedStart = Date.now();
    let firstId = '';
    for (let i = 0; i < 200; i += 1) {
      const token = await h.vtt.execute(
        {
          ...h.cmd('token.create', { name: `T${i}`, x: (i % 20) * 40, y: Math.floor(i / 20) * 40 }),
          sceneInstanceId: instanceId,
        },
        h.dm
      );
      if (i === 0) firstId = (token.result.token as { id: string }).id;
      await h.vtt.execute(
        {
          ...h.cmd('wall.create', {
            a: { x: i * 2, y: 0 },
            b: { x: i * 2, y: 40 },
          }),
          sceneInstanceId: instanceId,
        },
        h.dm
      );
    }
    const seedMs = Date.now() - seedStart;
    const live = h.vtt.tables.getInstance(instanceId)!.state;
    expect(live.tokens.length).toBe(200);
    expect(live.walls.length).toBe(200);

    const moveStart = Date.now();
    await h.vtt.execute({ ...h.cmd('token.move', { tokenId: firstId, x: 12, y: 12 }), sceneInstanceId: instanceId }, h.dm);
    const moveMs = Date.now() - moveStart;

    const snapStart = Date.now();
    const snap = h.vtt.snapshot(h.session.id, h.dm, instanceId);
    const snapMs = Date.now() - snapStart;
    expect(snap.live?.tokens.length).toBe(200);

    // Generous CI bounds; measured values are printed for the build report.
    console.log(JSON.stringify({ seedMs, moveMs, snapMs, tokens: 200, walls: 200 }));
    expect(moveMs).toBeLessThan(500);
    expect(snapMs).toBeLessThan(250);
    expect(seedMs).toBeLessThan(15_000);
    await h.engine.stop();
  });
});
