import type { FogOperation, GridConfig, Point, TerrainRecord } from '@actualplay/protocol';

export interface DrawPoly {
  points: Point[];
  kind: 'fog-reveal' | 'fog-hide' | 'terrain' | 'hex';
}

export function rectFromPoints(points: Point[]): Point[] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    const p = points[0]!;
    return [
      { x: p.x, y: p.y },
      { x: p.x + 70, y: p.y },
      { x: p.x + 70, y: p.y + 70 },
      { x: p.x, y: p.y + 70 },
    ];
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

export function fogPolygon(op: FogOperation): Point[] {
  if (op.shape === 'full') {
    return [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 4000 },
      { x: 0, y: 4000 },
    ];
  }
  if (op.shape === 'polygon' && op.points.length >= 3) return op.points;
  if (op.shape === 'brush' && op.points[0]) {
    const c = op.points[0];
    const r = op.radius ?? 40;
    const ring: Point[] = [];
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      ring.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
    }
    return ring;
  }
  return rectFromPoints(op.points);
}

export function terrainPolygon(region: TerrainRecord): Point[] {
  if (region.points.length >= 3) return region.points;
  return rectFromPoints(region.points);
}

export function hexCorners(cx: number, cy: number, size: number, flatTop: boolean): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = ((flatTop ? 60 * i : 60 * i - 30) * Math.PI) / 180;
    points.push({ x: cx + size * Math.cos(angle), y: cy + size * Math.sin(angle) });
  }
  return points;
}

export function hexCellCenters(
  grid: GridConfig,
  bounds = { width: 1600, height: 1000 }
): Array<{ q: number; r: number; x: number; y: number; points: Point[] }> {
  const size = Math.max(8, grid.size);
  const flat = grid.mode === 'hex-flat';
  const cells: Array<{ q: number; r: number; x: number; y: number; points: Point[] }> = [];
  const qMax = Math.ceil(bounds.width / (size * 1.5)) + 2;
  const rMax = Math.ceil(bounds.height / (size * Math.sqrt(3))) + 2;
  for (let q = 0; q < qMax; q += 1) {
    for (let r = 0; r < rMax; r += 1) {
      let x: number;
      let y: number;
      if (flat) {
        x = grid.offsetX + size * 1.5 * q;
        y = grid.offsetY + size * Math.sqrt(3) * (r + 0.5 * (q & 1));
      } else {
        x = grid.offsetX + size * Math.sqrt(3) * (q + 0.5 * (r & 1));
        y = grid.offsetY + size * 1.5 * r;
      }
      cells.push({ q, r, x, y, points: hexCorners(x, y, size, flat) });
    }
  }
  return cells;
}

export function squareGridLines(
  grid: GridConfig,
  bounds = { width: 1600, height: 1000 }
): Array<{ a: Point; b: Point }> {
  const size = Math.max(8, grid.size);
  const lines: Array<{ a: Point; b: Point }> = [];
  for (let x = grid.offsetX % size; x <= bounds.width; x += size) {
    lines.push({ a: { x, y: 0 }, b: { x, y: bounds.height } });
  }
  for (let y = grid.offsetY % size; y <= bounds.height; y += size) {
    lines.push({ a: { x: 0, y }, b: { x: bounds.width, y } });
  }
  return lines;
}

export function fogDrawList(ops: FogOperation[]): DrawPoly[] {
  return ops.map((op) => ({
    points: fogPolygon(op),
    kind: op.kind === 'hide' ? 'fog-hide' : 'fog-reveal',
  }));
}

export function terrainDrawList(regions: TerrainRecord[]): DrawPoly[] {
  return regions.map((region) => ({ points: terrainPolygon(region), kind: 'terrain' }));
}

export function gridDrawModel(grid: GridConfig, bounds = { width: 1600, height: 1000 }): { mode: GridConfig['mode']; hex: ReturnType<typeof hexCellCenters>; square: ReturnType<typeof squareGridLines> } {
  if (grid.mode === 'hex-flat' || grid.mode === 'hex-pointy') {
    return { mode: grid.mode, hex: hexCellCenters(grid, bounds), square: [] };
  }
  if (grid.mode === 'square') {
    return { mode: 'square', hex: [], square: squareGridLines(grid, bounds) };
  }
  return { mode: 'gridless', hex: [], square: [] };
}

export function assetUrl(assetId: string | null | undefined, base = '/api/actualplay'): string | null {
  if (!assetId) return null;
  return `${base}/vtt/assets/${encodeURIComponent(assetId)}?variant=display`;
}
