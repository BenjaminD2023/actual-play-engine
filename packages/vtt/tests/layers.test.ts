import { describe, expect, it } from 'vitest';
import { LAYER_ORDER, clampCamera, screenToWorld } from '../src/layers.js';

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
});
