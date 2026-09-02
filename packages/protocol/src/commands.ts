import { ProtocolError } from './errors.js';
import { PROTOCOL_VERSION } from './version.js';
import { ANNOTATION_KINDS, DOOR_STATES, FOG_OPS, FOG_SHAPES, GRID_MODES, TEMPLATE_KINDS, TOKEN_DISPOSITIONS, TOKEN_VISIBILITY } from './types.js';
import { requireBoolean, requireEnum, requireFiniteNumber, requireInteger, requireProtocolVersion, requireRecord, requireString, optionalBoolean, optionalFiniteNumber, optionalString } from './validate.js';

export const VTT_COMMAND_TYPES = [
  'scene.create',
  'scene.updateDraft',
  'scene.publish',
  'scene.instantiate',
  'scene.stage',
  'scene.activate',
  'scene.archive',
  'token.create',
  'token.duplicate',
  'token.move',
  'token.update',
  'token.delete',
  'token.assignOwner',
  'token.setVisibility',
  'token.setCondition',
  'token.setAura',
  'token.setElevation',
  'token.lock',
  'token.unlock',
  'wall.create',
  'wall.update',
  'wall.delete',
  'door.setState',
  'light.create',
  'light.update',
  'light.delete',
  'fog.reveal',
  'fog.hide',
  'fog.reset',
  'fog.undo',
  'fog.compact',
  'annotation.upsert',
  'annotation.delete',
  'template.upsert',
  'template.delete',
  'terrain.upsert',
  'terrain.delete',
  'ping.create',
  'camera.set',
  'camera.activatePreset',
  'camera.focusToken',
  'camera.focusInitiative',
  'encounter.spawn',
  'encounter.remove',
  'combat.nextTurn',
  'combat.previousTurn',
  'combat.newRound',
  'combat.end',
  'showPreset.run',
  'rundown.advance',
  'rundown.goBack',
  'rundown.skip',
  'announcement.show',
  'announcement.clear',
  'handout.show',
  'handout.hide',
  'poll.open',
  'poll.close',
  'recording.marker',
  'checkpoint.create',
  'checkpoint.previewRestore',
  'checkpoint.restore',
] as const;

export type VttCommandType = (typeof VTT_COMMAND_TYPES)[number];

export interface CommandEnvelope {
  id: string;
  protocolVersion: number;
  type: VttCommandType;
  sessionId: string;
  sceneInstanceId?: string;
  expectedVersion?: number;
  payload: Record<string, unknown>;
}

export function isVttCommandType(value: unknown): value is VttCommandType {
  return typeof value === 'string' && (VTT_COMMAND_TYPES as readonly string[]).includes(value);
}

export function parseCommandEnvelope(value: unknown): CommandEnvelope {
  const raw = requireRecord(value, 'command');
  const type = raw.type;
  if (!isVttCommandType(type)) {
    throw new ProtocolError('invalid_request', `Unknown command type: ${String(type)}`);
  }
  const envelope: CommandEnvelope = {
    id: requireString(raw.id, 'id'),
    protocolVersion: requireProtocolVersion(raw.protocolVersion ?? PROTOCOL_VERSION),
    type,
    sessionId: requireString(raw.sessionId, 'sessionId'),
    payload: raw.payload === undefined ? {} : requireRecord(raw.payload, 'payload'),
  };
  const instanceId = optionalString(raw.sceneInstanceId);
  if (instanceId) envelope.sceneInstanceId = instanceId;
  const expected = optionalFiniteNumber(raw.expectedVersion, 'expectedVersion');
  if (expected !== undefined) envelope.expectedVersion = expected;
  validatePayload(envelope.type, envelope.payload);
  return envelope;
}

function point(raw: unknown, label: string): { x: number; y: number } {
  const obj = requireRecord(raw, label);
  return { x: requireFiniteNumber(obj.x, `${label}.x`), y: requireFiniteNumber(obj.y, `${label}.y`) };
}

function validatePayload(type: VttCommandType, payload: Record<string, unknown>): void {
  switch (type) {
    case 'scene.create':
    case 'scene.updateDraft':
      requireString(payload.title ?? payload.name ?? 'Scene', 'title');
      if (payload.grid !== undefined) {
        const grid = requireRecord(payload.grid, 'grid');
        requireEnum(grid.mode ?? 'square', GRID_MODES, 'grid.mode');
      }
      return;
    case 'scene.publish':
    case 'scene.archive':
      requireString(payload.sceneId, 'sceneId');
      return;
    case 'scene.instantiate':
    case 'scene.stage':
    case 'scene.activate':
      if (!payload.sceneId && !payload.instanceId && !payload.revisionId && !payload.sceneInstanceId) {
        throw new ProtocolError('invalid_request', `${type} requires sceneId, revisionId, or instanceId.`);
      }
      return;
    case 'token.create':
      requireString(payload.name ?? 'Token', 'name');
      requireFiniteNumber(payload.x ?? 0, 'x');
      requireFiniteNumber(payload.y ?? 0, 'y');
      return;
    case 'token.move':
      requireString(payload.tokenId, 'tokenId');
      requireFiniteNumber(payload.x, 'x');
      requireFiniteNumber(payload.y, 'y');
      return;
    case 'token.update':
    case 'token.delete':
    case 'token.duplicate':
    case 'token.lock':
    case 'token.unlock':
    case 'token.setElevation':
      requireString(payload.tokenId, 'tokenId');
      return;
    case 'token.assignOwner':
      requireString(payload.tokenId, 'tokenId');
      return;
    case 'token.setVisibility':
      requireString(payload.tokenId, 'tokenId');
      requireEnum(payload.visibility, TOKEN_VISIBILITY, 'visibility');
      return;
    case 'token.setCondition':
      requireString(payload.tokenId, 'tokenId');
      requireString(payload.condition, 'condition');
      return;
    case 'token.setAura':
      requireString(payload.tokenId, 'tokenId');
      requireFiniteNumber(payload.radius ?? 0, 'radius');
      return;
    case 'wall.create':
      point(payload.a ?? { x: 0, y: 0 }, 'a');
      point(payload.b ?? { x: 1, y: 0 }, 'b');
      return;
    case 'wall.update':
    case 'wall.delete':
      requireString(payload.wallId, 'wallId');
      return;
    case 'door.setState':
      requireString(payload.doorId, 'doorId');
      requireEnum(payload.state, DOOR_STATES, 'state');
      return;
    case 'light.create':
      requireFiniteNumber(payload.x ?? 0, 'x');
      requireFiniteNumber(payload.y ?? 0, 'y');
      return;
    case 'light.update':
    case 'light.delete':
      requireString(payload.lightId, 'lightId');
      return;
    case 'fog.reveal':
    case 'fog.hide':
      requireEnum(payload.shape ?? 'rect', FOG_SHAPES, 'shape');
      return;
    case 'fog.reset':
    case 'fog.undo':
    case 'fog.compact':
      return;
    case 'annotation.upsert':
      requireEnum(payload.kind ?? 'text', ANNOTATION_KINDS, 'kind');
      return;
    case 'annotation.delete':
      requireString(payload.annotationId, 'annotationId');
      return;
    case 'template.upsert':
      requireEnum(payload.kind ?? 'circle', TEMPLATE_KINDS, 'kind');
      return;
    case 'template.delete':
      requireString(payload.templateId, 'templateId');
      return;
    case 'terrain.upsert':
      return;
    case 'terrain.delete':
      requireString(payload.terrainId, 'terrainId');
      return;
    case 'ping.create':
      requireFiniteNumber(payload.x, 'x');
      requireFiniteNumber(payload.y, 'y');
      return;
    case 'camera.set':
      requireFiniteNumber(payload.x ?? 0, 'x');
      requireFiniteNumber(payload.y ?? 0, 'y');
      requireFiniteNumber(payload.zoom ?? 1, 'zoom');
      return;
    case 'camera.activatePreset':
      requireString(payload.presetId, 'presetId');
      return;
    case 'camera.focusToken':
      requireString(payload.tokenId, 'tokenId');
      return;
    case 'camera.focusInitiative':
      return;
    case 'encounter.spawn':
      requireString(payload.encounterId, 'encounterId');
      return;
    case 'encounter.remove':
      requireString(payload.spawnId ?? payload.encounterId, 'spawnId');
      return;
    case 'combat.nextTurn':
    case 'combat.previousTurn':
    case 'combat.newRound':
    case 'combat.end':
      return;
    case 'showPreset.run':
      requireString(payload.presetId, 'presetId');
      return;
    case 'rundown.advance':
    case 'rundown.goBack':
    case 'rundown.skip':
      return;
    case 'announcement.show':
      requireString(payload.text, 'text');
      return;
    case 'announcement.clear':
      return;
    case 'handout.show':
    case 'handout.hide':
      requireString(payload.handoutId, 'handoutId');
      return;
    case 'poll.open':
      requireString(payload.question ?? payload.pollId ?? 'Poll', 'question');
      return;
    case 'poll.close':
      requireString(payload.pollId, 'pollId');
      return;
    case 'recording.marker':
      requireString(payload.label ?? 'marker', 'label');
      return;
    case 'checkpoint.create':
      requireString(payload.label ?? 'checkpoint', 'label');
      return;
    case 'checkpoint.previewRestore':
    case 'checkpoint.restore':
      requireString(payload.checkpointId, 'checkpointId');
      return;
    default: {
      const _never: never = type;
      throw new ProtocolError('invalid_request', `Unhandled command: ${_never}`);
    }
  }
}

export function commandResultSchema(ok: boolean, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ok, ...extra };
}

void requireBoolean;
void requireInteger;
void TOKEN_DISPOSITIONS;
void FOG_OPS;
