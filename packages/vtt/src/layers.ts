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
