export const LAYER_ORDER = [
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
] as const;

export type LayerName = (typeof LAYER_ORDER)[number];

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
}

export function clampCamera(camera: Camera, bounds = { minZoom: 0.2, maxZoom: 4 }): Camera {
  return {
    ...camera,
    zoom: Math.min(bounds.maxZoom, Math.max(bounds.minZoom, camera.zoom)),
  };
}

export function screenToWorld(screen: { x: number; y: number }, camera: Camera): { x: number; y: number } {
  return {
    x: camera.x + screen.x / camera.zoom,
    y: camera.y + screen.y / camera.zoom,
  };
}

export function tokenAtWorld(
  tokens: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  world: { x: number; y: number }
): string | null {
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (!token) continue;
    const radius = Math.max(12, token.width / 2, token.height / 2);
    const dx = world.x - token.x;
    const dy = world.y - token.y;
    if (dx * dx + dy * dy <= radius * radius) return token.id;
  }
  return null;
}
