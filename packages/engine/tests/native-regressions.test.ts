import { afterEach, describe, expect, it } from 'vitest';
import { parseProject as sharedParse } from '@actualplay/protocol/production';
import { parseProject as runtimeParse } from '../src/production/spec.js';
import { emptyDocument, makeToken } from '../src/vtt/model.js';
import { harness } from './vtt-helpers.js';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { while (closers.length) await closers.pop()!(); });
async function setup() {
 const h = await harness(); closers.push(() => h.engine.stop());
 const document = emptyDocument('Visibility');
 document.tokens = [makeToken({ id: 'hero', name: 'Hero', ownerUserId: 'user-p1', playerId: 'player-1', x: 0, y: 0 }), makeToken({ id: 'far', name: 'Far NPC', x: 1000, y: 0, vision: { enabled: false, distance: 420, angle: 360, mode: 'normal' } }), makeToken({ id: 'near', name: 'Near NPC', x: 140, y: 0 }), makeToken({ id: 'hidden', name: 'Hidden NPC', visibility: 'hidden', x: 10, y: 10 })];
 const created = await h.vtt.execute(h.cmd('scene.create', { title: document.title, document }), h.dm);
 const sceneId = (created.result.scene as { id: string }).id;
 await h.vtt.execute(h.cmd('scene.publish', { sceneId }), h.dm);
 const instance = await h.vtt.execute(h.cmd('scene.instantiate', { sceneId }), h.dm);
 const id = (instance.result.instance as { id: string }).id;
 await h.vtt.execute(h.cmd('scene.activate', { instanceId: id }), h.dm);
 return { ...h, instanceId: id };
}
describe('native integration regressions', () => {
 it('uses the exact same production parser as Maker', () => { expect(runtimeParse).toBe(sharedParse); });
 it('bases vision on the observer and keeps secret walls physically occluding', async () => {
  const h = await setup(); let snap = h.vtt.snapshot(h.session.id, h.playerOne);
  expect(snap.live!.tokens.map(t => t.id)).toEqual(['hero', 'near']);
  await h.vtt.execute({ ...h.cmd('wall.create', { a: { x: 70, y: -70 }, b: { x: 70, y: 70 }, dmOnly: true }), sceneInstanceId: h.instanceId }, h.dm);
  snap = h.vtt.snapshot(h.session.id, h.playerOne);
  expect(snap.live!.tokens.map(t => t.id)).toEqual(['hero']); expect(snap.live!.walls).toHaveLength(0);
 });
 it('returns sequenced invalidations rather than hidden event payloads', async () => {
  const h = await setup(); const events = h.vtt.eventsSince(h.session.id, 0, h.playerOne);
  expect(events.length).toBeGreaterThan(0); expect(events.every(e => Object.keys(e.payload).length === 0)).toBe(true);
  expect(events.map(e => e.sequence)).toEqual(Array.from({ length: events.length }, (_, i) => i + 1));
  expect(JSON.stringify(events)).not.toMatch(/Hidden NPC|"hidden"/);
  expect(() => h.vtt.eventsSince(h.session.id, -1, h.playerOne)).toThrow();
 });
 it('deduplicates simultaneous commands and denies another actor access to cached results', async () => {
  const h = await setup(); const before = h.vtt.snapshot(h.session.id, h.dm);
  const command = { ...h.cmd('token.move', { tokenId: 'hero', x: 70, y: 70 }, 'concurrent-command'), sceneInstanceId: h.instanceId, expectedVersion: before.aggregateVersion };
  const result = await Promise.all([h.vtt.execute(command, h.dm), h.vtt.execute(command, h.dm)]);
  expect(result.some(r => r.duplicate)).toBe(true); expect(h.vtt.snapshot(h.session.id, h.dm).aggregateVersion).toBe(before.aggregateVersion + 1);
  await expect(h.vtt.execute(command, h.playerOne)).rejects.toMatchObject({ code: 'forbidden' });
 });
});
