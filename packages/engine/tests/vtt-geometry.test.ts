import { describe, expect, it } from 'vitest';
import { hasLineOfSight } from '../src/vtt/geometry.js';

describe('vision geometry', () => {
  const wall = { id: 'w1', a: { x: 50, y: 0 }, b: { x: 50, y: 100 }, blockingVision: true, blockingMovement: true, dmOnly: false, kind: 'wall' as const };

  it('blocks line of sight through a closed door wall and allows it when the door is open', () => {
    const from = { x: 0, y: 50 };
    const to = { x: 100, y: 50 };
    expect(hasLineOfSight(from, to, [wall], new Set())).toBe(false);
    expect(hasLineOfSight(from, to, [wall], new Set(['w1']))).toBe(true);
  });
});
