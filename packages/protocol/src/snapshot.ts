import type { ViewerKind } from './roles.js';
import type {
  AnnotationRecord,
  AssetMetadata,
  CameraPreset,
  CameraState,
  DoorRecord,
  FogOperation,
  GridConfig,
  LayerRecord,
  LightRecord,
  TemplateRecord,
  TerrainRecord,
  TokenRecord,
  WallRecord,
} from './types.js';

export interface ProjectedLiveScene {
  instanceId: string;
  sceneId: string;
  revisionId: string;
  title: string;
  status: string;
  version: number;
  lastEventSequence: number;
  grid: GridConfig;
  mapAssetId: string | null;
  animated: boolean;
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
  camera: CameraState;
  announcement: string;
  combat: {
    mode: boolean;
    round: number;
    currentTurn: number;
    activeTokenId: string | null;
  };
}

export interface VttSnapshot {
  protocolVersion: number;
  projection: ViewerKind;
  sessionId: string;
  sceneInstanceId: string | null;
  aggregateVersion: number;
  lastEventSequence: number;
  live: ProjectedLiveScene | null;
  assets: AssetMetadata[];
  connection: {
    viewer: ViewerKind;
    userId: string | null;
    reconnect: boolean;
  };
}

export interface ReplayFrame {
  sequence: number;
  at: string;
  type: string;
  summary: string;
}
