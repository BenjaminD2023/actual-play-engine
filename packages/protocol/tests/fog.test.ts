import { describe, expect, it } from 'vitest';
import { isPointRevealed } from '../src/fog.js';
import type { FogOperation } from '../src/types.js';
const op = (kind: FogOperation['kind'], a = 0, b = 100): FogOperation => ({ id: `${kind}-${a}`, kind, shape: 'rect', points: [{ x: a, y: a }, { x: b, y: b }], createdAt: '', actorId: null });
describe('ordered fog composition', () => {
  it('starts clear and can cover only a selected region', () => { expect(isPointRevealed([], { x: 50, y: 50 })).toBe(true); expect(isPointRevealed([op('hide')], { x: 50, y: 50 })).toBe(false); expect(isPointRevealed([op('hide')], { x: 200, y: 200 })).toBe(true); });
  it('keeps overlapping reveals clear and lets a later hide win', () => { const ops = [op('reveal'), op('reveal', 30, 150)]; expect(isPointRevealed(ops, { x: 50, y: 50 })).toBe(true); expect(isPointRevealed(ops, { x: 200, y: 200 })).toBe(false); expect(isPointRevealed([...ops, op('hide', 40, 60)], { x: 50, y: 50 })).toBe(false); });
  it('supports reset, full reveal, polygon and brush masks', () => { const full = { ...op('reveal'), shape: 'full' as const }; expect(isPointRevealed([full, op('reset')], { x: 1000, y: 1000 })).toBe(false); expect(isPointRevealed([op('reset'), full], { x: 1000, y: 1000 })).toBe(true); expect(isPointRevealed([{ ...op('reveal'), shape: 'brush', points: [{ x: 0, y: 0 }], radius: 30 }], { x: 10, y: 10 })).toBe(true); expect(isPointRevealed([{ ...op('reveal'), shape: 'polygon', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }] }], { x: 90, y: 90 })).toBe(false); });
});
