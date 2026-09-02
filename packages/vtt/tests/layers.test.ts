import { describe, expect, it } from 'vitest';
import { LAYER_ORDER, clampCamera, screenToWorld, tokenAtWorld } from '../src/layers.js';
import { assetUrl, fogPolygon, gridDrawModel, terrainPolygon } from '../src/draw-model.js';
import { VttConnection } from '../src/connection.js';

describe('VTT client layers', () => {
  it('keeps the required world layer order', () => {
    expect([...LAYER_ORDER]).toEqual([
      'background',
      'grid',
      'terrain',
      'walls',
      'lighting',
      'fog',
      'tokens',
      'auras',
      'annotations',
      'selection',
    ]);
  });

  it('clamps zoom and converts screen to world', () => {
    expect(clampCamera({ x: 0, y: 0, zoom: 99, rotation: 0 }).zoom).toBe(4);
    expect(screenToWorld({ x: 100, y: 50 }, { x: 10, y: 20, zoom: 2, rotation: 0 })).toEqual({ x: 60, y: 45 });
  });

  it('hits the topmost token at a world point', () => {
    const id = tokenAtWorld(
      [
        { id: 'a', x: 0, y: 0, width: 70, height: 70 },
        { id: 'b', x: 10, y: 0, width: 70, height: 70 },
      ],
      { x: 10, y: 0 }
    );
    expect(id).toBe('b');
    expect(tokenAtWorld([{ id: 'a', x: 0, y: 0, width: 20, height: 20 }], { x: 400, y: 400 })).toBeNull();
  });

  it('draws hex lattices instead of a square grid and uses stored fog/terrain geometry', () => {
    const hex = gridDrawModel({
      mode: 'hex-flat',
      size: 70,
      offsetX: 0,
      offsetY: 0,
      opacity: 1,
      style: 'solid',
      unitsPerCell: 5,
      unitName: 'ft',
      rotation: 0,
      snap: true,
    });
    expect(hex.mode).toBe('hex-flat');
    expect(hex.square).toEqual([]);
    expect(hex.hex[0]?.points).toHaveLength(6);
    const dx = (hex.hex.find((cell) => cell.q === 1 && cell.r === 0)?.x ?? 0) - (hex.hex.find((cell) => cell.q === 0 && cell.r === 0)?.x ?? 0);
    expect(dx).toBeCloseTo(105, 0);

    const pointy = gridDrawModel({
      mode: 'hex-pointy',
      size: 70,
      offsetX: 0,
      offsetY: 0,
      opacity: 1,
      style: 'solid',
      unitsPerCell: 5,
      unitName: 'ft',
      rotation: 0,
      snap: true,
    });
    expect(pointy.hex[0]?.points).toHaveLength(6);
    const square = gridDrawModel({
      mode: 'square',
      size: 70,
      offsetX: 0,
      offsetY: 0,
      opacity: 1,
      style: 'solid',
      unitsPerCell: 5,
      unitName: 'ft',
      rotation: 0,
      snap: true,
    });
    expect(square.square.length).toBeGreaterThan(4);

    const fog = fogPolygon({
      id: 'f1',
      kind: 'reveal',
      shape: 'rect',
      points: [
        { x: 40, y: 40 },
        { x: 200, y: 180 },
      ],
      createdAt: 't',
      actorId: null,
    });
    expect(fog).toEqual([
      { x: 40, y: 40 },
      { x: 200, y: 40 },
      { x: 200, y: 180 },
      { x: 40, y: 180 },
    ]);
    const terrain = terrainPolygon({
      id: 't1',
      multiplier: 2,
      label: 'difficult',
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 40 },
      ],
    });
    expect(terrain).toHaveLength(3);
    expect(assetUrl('asset-1')).toContain('/vtt/assets/asset-1');
  });

  it('fills an event gap in order and snapshots when a sequence is skipped', async () => {
    const conn = new VttConnection('/api/actualplay');
    conn.lastEventSequence = 4;
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/vtt/events')) {
        return new Response(JSON.stringify({ events: [{ sequence: 6, type: 'vtt.token.changed' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ lastEventSequence: 6, live: null, sessionId: 's' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      await conn.fillGap();
      expect(calls.some((url) => url.includes('/vtt/events?after=4'))).toBe(true);
      expect(calls.some((url) => url.includes('/vtt/snapshot'))).toBe(true);
      expect(conn.lastEventSequence).toBe(6);
    } finally {
      globalThis.fetch = original;
    }
  });
});
