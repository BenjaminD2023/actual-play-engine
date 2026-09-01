import type {
  CameraState,
  GridConfig,
  GridMode,
  LayerRecord,
  SceneDocument,
  TokenRecord,
  VisionConfig,
} from '@actualplay/protocol';
import { createId, nowIso } from '../ids.js';
import { defaultGrid } from './geometry.js';

export function defaultVision(): VisionConfig {
  return { enabled: true, distance: 420, angle: 360, mode: 'normal' };
}

export function defaultCamera(): CameraState {
  return { x: 0, y: 0, zoom: 1, rotation: 0 };
}

export function defaultLayers(): LayerRecord[] {
  return [
    { id: 'map', name: 'Map', visible: true, locked: true, order: 0 },
    { id: 'tokens', name: 'Tokens', visible: true, locked: false, order: 1 },
  ];
}

export function emptyDocument(title = 'Untitled scene', mode: GridMode = 'square'): SceneDocument {
  return {
    title,
    notes: '',
    mapAssetId: null,
    animated: false,
    grid: defaultGrid(mode),
    layers: defaultLayers(),
    tokens: [],
    walls: [],
    doors: [],
    lights: [],
    fog: [],
    annotations: [],
    templates: [],
    terrain: [],
    cameras: [],
    pollTemplateIds: [],
    handoutIds: [],
    presetIds: [],
    qlabCueName: null,
  };
}

export interface LiveState {
  title: string;
  mapAssetId: string | null;
  animated: boolean;
  grid: GridConfig;
  layers: LayerRecord[];
  tokens: TokenRecord[];
  walls: SceneDocument['walls'];
  doors: SceneDocument['doors'];
  lights: SceneDocument['lights'];
  fog: SceneDocument['fog'];
  annotations: SceneDocument['annotations'];
  templates: SceneDocument['templates'];
  terrain: SceneDocument['terrain'];
  cameras: SceneDocument['cameras'];
  camera: CameraState;
  announcement: string;
  visibleHandoutIds: string[];
  spawnIds: string[];
}

export function liveFromDocument(doc: SceneDocument): LiveState {
  return {
    title: doc.title,
    mapAssetId: doc.mapAssetId,
    animated: doc.animated,
    grid: structuredClone(doc.grid),
    layers: structuredClone(doc.layers),
    tokens: structuredClone(doc.tokens),
    walls: structuredClone(doc.walls),
    doors: structuredClone(doc.doors),
    lights: structuredClone(doc.lights),
    fog: structuredClone(doc.fog),
    annotations: structuredClone(doc.annotations),
    templates: structuredClone(doc.templates),
    terrain: structuredClone(doc.terrain),
    cameras: structuredClone(doc.cameras),
    camera: defaultCamera(),
    announcement: '',
    visibleHandoutIds: [],
    spawnIds: [],
  };
}

export function documentFromLive(state: LiveState): SceneDocument {
  return {
    title: state.title,
    notes: '',
    mapAssetId: state.mapAssetId,
    animated: state.animated,
    grid: structuredClone(state.grid),
    layers: structuredClone(state.layers),
    tokens: structuredClone(state.tokens),
    walls: structuredClone(state.walls),
    doors: structuredClone(state.doors),
    lights: structuredClone(state.lights),
    fog: structuredClone(state.fog),
    annotations: structuredClone(state.annotations),
    templates: structuredClone(state.templates),
    terrain: structuredClone(state.terrain),
    cameras: structuredClone(state.cameras),
    pollTemplateIds: [],
    handoutIds: [],
    presetIds: [],
    qlabCueName: null,
  };
}

export function makeToken(partial: Partial<TokenRecord> & { name?: string }): TokenRecord {
  return {
    id: partial.id ?? createId(),
    name: partial.name ?? 'Token',
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    rotation: partial.rotation ?? 0,
    width: partial.width ?? 70,
    height: partial.height ?? 70,
    elevation: partial.elevation ?? 0,
    assetId: partial.assetId ?? null,
    ownerUserId: partial.ownerUserId ?? null,
    playerId: partial.playerId ?? null,
    initiativeId: partial.initiativeId ?? null,
    encounterMemberId: partial.encounterMemberId ?? null,
    visibility: partial.visibility ?? 'visible',
    disposition: partial.disposition ?? 'neutral',
    locked: partial.locked ?? false,
    conditions: partial.conditions ?? [],
    auras: partial.auras ?? [],
    vision: partial.vision ?? defaultVision(),
    dmLabel: partial.dmLabel ?? null,
    nameplate: partial.nameplate ?? true,
    layer: partial.layer ?? 'tokens',
  };
}

export function stamp(): string {
  return nowIso();
}
