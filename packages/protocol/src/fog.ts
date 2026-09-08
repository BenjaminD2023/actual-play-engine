import type { FogOperation, Point } from './types.js';

export function fogContains(op: FogOperation, point: Point): boolean {
  if (op.shape === 'full' || op.kind === 'reset') return true;
  const points = op.points;
  if (!points.length) return false;
  if (op.shape === 'brush') return Math.hypot(point.x - points[0]!.x, point.y - points[0]!.y) <= (op.radius ?? 40);
  if (op.shape === 'rect') {
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    return point.x >= Math.min(...xs) && point.x <= Math.max(...xs) && point.y >= Math.min(...ys) && point.y <= Math.max(...ys);
  }
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!, b = points[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Reveal starts from a covered map; hide starts from a clear map. Operations then compose in order. */
export function isPointRevealed(ops: FogOperation[], point: Point): boolean {
  let visible = ops.length === 0 || ops[0]?.kind === 'hide';
  for (const op of ops) if (fogContains(op, point)) visible = op.kind === 'reveal';
  return visible;
}
