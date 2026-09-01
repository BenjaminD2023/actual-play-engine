import type { ActorContext, ProjectedLiveScene, TokenRecord, VttSnapshot, ViewerKind } from '@actualplay/protocol';
import { PROTOCOL_VERSION } from '@actualplay/protocol';
import { hasLineOfSight, inVisionCone } from './geometry.js';
import type { InstanceRow } from './tables.js';
import type { PlayerRecord } from '../store/types.js';

export function projectInstance(
  instance: InstanceRow | null,
  actor: ActorContext,
  extras: {
    players: PlayerRecord[];
    combat: { mode: boolean; round: number; currentTurn: number };
    lastEventSequence: number;
    assets: VttSnapshot['assets'];
  }
): VttSnapshot {
  const canSeeHidden = actor.capabilities.includes('viewHiddenToken');
  const live = instance ? projectLive(instance, actor, extras, canSeeHidden) : null;
  return {
    protocolVersion: PROTOCOL_VERSION,
    projection: actor.viewer,
    sessionId: instance?.session_id ?? '',
    sceneInstanceId: instance?.id ?? null,
    aggregateVersion: instance?.version ?? 0,
    lastEventSequence: extras.lastEventSequence,
    live,
    assets: extras.assets,
    connection: {
      viewer: actor.viewer,
      userId: actor.userId,
      reconnect: false,
    },
  };
}

function projectLive(
  instance: InstanceRow,
  actor: ActorContext,
  extras: {
    players: PlayerRecord[];
    combat: { mode: boolean; round: number; currentTurn: number };
  },
  canSeeHidden: boolean
): ProjectedLiveScene {
  const state = structuredClone(instance.state);
  const observer = state.tokens.find((token) => token.ownerUserId === actor.userId || token.playerId === actor.playerId);
  const blockedWalls = new Set(
    state.doors.filter((door) => door.state !== 'open' && !door.secret).map((door) => door.wallId)
  );
  const visionWalls = state.walls.filter((wall) => {
    if (wall.dmOnly && !canSeeHidden) return false;
    return wall.blockingVision;
  });

  const tokens: TokenRecord[] = [];
  for (const token of state.tokens) {
    if (token.visibility === 'hidden' && !canSeeHidden && token.ownerUserId !== actor.userId) continue;
    if (!canSeeHidden && observer && token.id !== observer.id && token.vision.enabled) {
      const origin = { x: observer.x, y: observer.y };
      const target = { x: token.x, y: token.y };
      if (!inVisionCone(origin, target, observer.vision.distance, observer.vision.angle, observer.rotation)) continue;
      const walls = visionWalls.filter((wall) => !blockedWalls.has(wall.id) || state.doors.some((door) => door.wallId === wall.id && door.state !== 'open'));
      if (!hasLineOfSight(origin, target, walls, blockedWalls)) continue;
    }
    if (!canSeeHidden) token.dmLabel = null;
    if (token.playerId) {
      const player = extras.players.find((row) => row.id === token.playerId);
      if (player) {
        token.name = player.character_name || token.name;
        token.assetId = player.portrait_url || token.assetId;
      }
    }
    tokens.push(token);
  }

  const doors = state.doors.filter((door) => canSeeHidden || !door.secret);
  const walls = state.walls.filter((wall) => canSeeHidden || !wall.dmOnly);
  const annotations = state.annotations.filter((item) => canSeeHidden || !item.dmOnly);

  const initiative = extras.combat;
  const active = extras.players.length
    ? tokens.find((token) => token.initiativeId) ?? null
    : null;

  return {
    instanceId: instance.id,
    sceneId: instance.scene_id,
    revisionId: instance.revision_id,
    title: state.title,
    status: instance.status,
    version: instance.version,
    lastEventSequence: instance.last_event_sequence,
    grid: state.grid,
    mapAssetId: state.mapAssetId,
    animated: state.animated,
    layers: state.layers,
    tokens,
    walls,
    doors,
    lights: state.lights,
    fog: canSeeHidden ? state.fog : state.fog.filter((op) => op.kind !== 'hide'),
    annotations,
    templates: state.templates,
    terrain: state.terrain,
    cameras: canSeeHidden ? state.cameras : state.cameras.filter((camera) => camera.audience !== 'dm'),
    camera: state.camera,
    announcement: state.announcement,
    combat: {
      mode: initiative.mode,
      round: initiative.round,
      currentTurn: initiative.currentTurn,
      activeTokenId: active?.id ?? null,
    },
  };
}

export function omitSecretsFromJson(value: unknown, viewer: ViewerKind): unknown {
  if (viewer === 'admin' || viewer === 'dm') return value;
  return JSON.parse(JSON.stringify(value, (key, inner: unknown) => {
    if (key === 'dmLabel' || key === 'secret' || key === 'dmOnly') return undefined;
    return inner;
  })) as unknown;
}
