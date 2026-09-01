import type { GridConfig, GridMode, Point, WallRecord } from '@actualplay/protocol';

export function snapToGrid(point: Point, grid: GridConfig): Point {
  if (!grid.snap || grid.mode === 'gridless' || grid.size <= 0) return { ...point };
  const size = grid.size;
  const ox = grid.offsetX;
  const oy = grid.offsetY;
  if (grid.mode === 'square') {
    return {
      x: ox + Math.round((point.x - ox) / size) * size,
      y: oy + Math.round((point.y - oy) / size) * size,
    };
  }
  return snapHex(point, grid);
}

function snapHex(point: Point, grid: GridConfig): Point {
  const size = grid.size;
  const flat = grid.mode === 'hex-flat';
  const q = flat
    ? ((2 / 3) * (point.x - grid.offsetX)) / size
    : ((Math.sqrt(3) / 3) * (point.x - grid.offsetX) - (1 / 3) * (point.y - grid.offsetY)) / size;
  const r = flat
    ? ((-1 / 3) * (point.x - grid.offsetX) + (Math.sqrt(3) / 3) * (point.y - grid.offsetY)) / size
    : ((2 / 3) * (point.y - grid.offsetY)) / size;
  const cube = axialToCube(q, r);
  const rounded = roundCube(cube.x, cube.y, cube.z);
  return cubeToPixel(rounded.x, rounded.z, grid, flat);
}

function axialToCube(q: number, r: number): { x: number; y: number; z: number } {
  return { x: q, z: r, y: -q - r };
}

function roundCube(x: number, y: number, z: number): { x: number; y: number; z: number } {
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { x: rx, y: ry, z: rz };
}

function cubeToPixel(q: number, r: number, grid: GridConfig, flat: boolean): Point {
  const size = grid.size;
  if (flat) {
    return {
      x: grid.offsetX + size * (1.5 * q),
      y: grid.offsetY + size * ((Math.sqrt(3) / 2) * q + Math.sqrt(3) * r),
    };
  }
  return {
    x: grid.offsetX + size * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r),
    y: grid.offsetY + size * (1.5 * r),
  };
}

export function distance(a: Point, b: Point, mode: GridMode, gridSize: number, diagonal: 'euclidean' | 'manhattan' | '5105'): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  if (mode === 'gridless' || diagonal === 'euclidean') {
    return Math.hypot(dx, dy);
  }
  if (diagonal === 'manhattan') return dx + dy;
  const cellsX = gridSize > 0 ? dx / gridSize : dx;
  const cellsY = gridSize > 0 ? dy / gridSize : dy;
  const min = Math.min(cellsX, cellsY);
  const max = Math.max(cellsX, cellsY);
  return (min * 1.5 + (max - min)) * (gridSize || 1);
}

export function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d1 = direction(b1, b2, a1);
  const d2 = direction(b1, b2, a2);
  const d3 = direction(a1, a2, b1);
  const d4 = direction(a1, a2, b2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

function direction(a: Point, b: Point, c: Point): number {
  return (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x);
}

export function hasLineOfSight(from: Point, to: Point, walls: WallRecord[], doorsBlocked: Set<string>): boolean {
  for (const wall of walls) {
    if (!wall.blockingVision) continue;
    if (wall.kind === 'window') continue;
    if (wall.kind === 'guide') continue;
    if (segmentsIntersect(from, to, wall.a, wall.b)) {
      if (wall.id && doorsBlocked.has(wall.id) === false && wall.kind !== 'wall') continue;
      return false;
    }
  }
  return true;
}

export function inVisionCone(origin: Point, target: Point, distanceLimit: number, angleDeg: number, facingDeg = 0): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dist = Math.hypot(dx, dy);
  if (dist > distanceLimit) return false;
  if (angleDeg >= 360) return true;
  const heading = (Math.atan2(dy, dx) * 180) / Math.PI;
  let delta = heading - facingDeg;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return Math.abs(delta) <= angleDeg / 2;
}

export function defaultGrid(mode: GridMode = 'square'): GridConfig {
  return {
    mode,
    size: 70,
    offsetX: 0,
    offsetY: 0,
    opacity: 0.35,
    style: 'solid',
    unitsPerCell: 5,
    unitName: 'ft',
    rotation: 0,
    snap: true,
  };
}
