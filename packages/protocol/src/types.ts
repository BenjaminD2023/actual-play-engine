import type { Capability, UserRole, ViewerKind } from './roles.js';

export const GRID_MODES = ['gridless', 'square', 'hex-flat', 'hex-pointy'] as const;
export type GridMode = (typeof GRID_MODES)[number];

export const TOKEN_VISIBILITY = ['visible', 'hidden', 'partial'] as const;
export type TokenVisibility = (typeof TOKEN_VISIBILITY)[number];

export const TOKEN_DISPOSITIONS = ['ally', 'enemy', 'neutral', 'unknown'] as const;
export type TokenDisposition = (typeof TOKEN_DISPOSITIONS)[number];

export const DOOR_STATES = ['open', 'closed', 'locked'] as const;
export type DoorState = (typeof DOOR_STATES)[number];

export const SCENE_STATUSES = ['draft', 'published', 'archived'] as const;
export type SceneStatus = (typeof SCENE_STATUSES)[number];

export const INSTANCE_STATUSES = ['staged', 'live', 'inactive'] as const;
export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

export const FOG_OPS = ['reveal', 'hide', 'reset'] as const;
export type FogOpKind = (typeof FOG_OPS)[number];

export const FOG_SHAPES = ['rect', 'polygon', 'brush', 'full'] as const;
export type FogShape = (typeof FOG_SHAPES)[number];

export const ANNOTATION_KINDS = ['text', 'freehand', 'arrow', 'rect', 'ellipse'] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

export const TEMPLATE_KINDS = ['circle', 'cone', 'line', 'rectangle'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const PRESET_STEP_STATUSES = ['ok', 'skipped', 'unconfirmed', 'failed', 'compensated'] as const;
export type PresetStepStatus = (typeof PRESET_STEP_STATUSES)[number];

export const RUNDOWN_STATES = ['ready', 'live', 'completed', 'skipped'] as const;
export type RundownState = (typeof RUNDOWN_STATES)[number];

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridConfig {
  mode: GridMode;
  size: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
  style: 'solid' | 'dotted';
  unitsPerCell: number;
  unitName: string;
  rotation: number;
  snap: boolean;
}

export interface AssetMetadata {
  id: string;
  hash: string;
  mime: string;
  byteSize: number;
  originalName: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  variants: AssetVariant[];
  createdAt: string;
  createdBy: string | null;
}

export interface AssetVariant {
  name: 'original' | 'thumb' | 'display';
  path: string;
  width: number | null;
  height: number | null;
  byteSize: number;
}

export interface TokenRecord {
  id: string;
  name: string;
  x: number;
  y: number;
  rotation: number;
  width: number;
  height: number;
  elevation: number;
  assetId: string | null;
  ownerUserId: string | null;
  playerId: string | null;
  initiativeId: string | null;
  encounterMemberId: string | null;
  visibility: TokenVisibility;
  disposition: TokenDisposition;
  locked: boolean;
  conditions: string[];
  auras: AuraRecord[];
  vision: VisionConfig;
  dmLabel: string | null;
  nameplate: boolean;
  layer: string;
}

export interface AuraRecord {
  id: string;
  radius: number;
  color: string;
  label: string;
}

export interface VisionConfig {
  enabled: boolean;
  distance: number;
  angle: number;
  mode: 'normal' | 'mono';
}

export interface WallRecord {
  id: string;
  a: Point;
  b: Point;
  blockingVision: boolean;
  blockingMovement: boolean;
  dmOnly: boolean;
  kind: 'wall' | 'window' | 'guide';
}

export interface DoorRecord {
  id: string;
  wallId: string;
  state: DoorState;
  secret: boolean;
  dmOnly: boolean;
}

export interface LightRecord {
  id: string;
  x: number;
  y: number;
  bright: number;
  dim: number;
  color: string;
  enabled: boolean;
  darkness: boolean;
}

export interface FogOperation {
  id: string;
  kind: FogOpKind;
  shape: FogShape;
  points: Point[];
  radius?: number;
  createdAt: string;
  actorId: string | null;
}

export interface AnnotationRecord {
  id: string;
  kind: AnnotationKind;
  points: Point[];
  text: string;
  color: string;
  dmOnly: boolean;
  strokeWidth: number;
}

export interface TemplateRecord {
  id: string;
  kind: TemplateKind;
  origin: Point;
  length: number;
  width: number;
  rotation: number;
  color: string;
  label: string;
}

export interface TerrainRecord {
  id: string;
  points: Point[];
  multiplier: number;
  label: string;
}

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
}

export interface CameraPreset {
  id: string;
  name: string;
  camera: CameraState;
  audience: 'dm' | 'broadcast' | 'projector' | 'player';
}

export interface LayerRecord {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  order: number;
}

export interface SceneDocument {
  title: string;
  notes: string;
  mapAssetId: string | null;
  animated: boolean;
  grid: GridConfig;
  layers: LayerRecord[];
  tokens: TokenRecord[];
  walls: WallRecord[];
  doors: DoorRecord[];
  lights: LightRecord[];
  fog: FogOperation[];
  annotations: AnnotationRecord[];
  templates: TemplateRecord[];
  terrain: TerrainRecord[];
  cameras: CameraPreset[];
  pollTemplateIds: string[];
  handoutIds: string[];
  presetIds: string[];
  qlabCueName: string | null;
}

export interface ActorContext {
  userId: string | null;
  username: string | null;
  role: UserRole | 'system' | 'midi' | 'bridge';
  viewer: ViewerKind;
  capabilities: Capability[];
  tokenId: string | null;
  playerId: string | null;
}

export interface RulesAdapterInfo {
  id: string;
  name: string;
  units: string;
  diagonal: 'euclidean' | 'manhattan' | '5105';
}
