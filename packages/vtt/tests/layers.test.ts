import { describe, expect, it } from 'vitest';
import { LAYER_ORDER, clampCamera, screenToWorld, tokenAtWorld } from '../src/layers.js';

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
});
