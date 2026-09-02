import { ProtocolError } from './errors.js';
import { PROTOCOL_VERSION } from './version.js';
import { requireInteger, requireProtocolVersion, requireRecord, requireString } from './validate.js';
import type { VttCommandType } from './commands.js';

export const VTT_EVENT_TYPES = [
  'vtt.scene.created',
  'vtt.scene.updated',
  'vtt.scene.published',
  'vtt.scene.instantiated',
  'vtt.scene.staged',
  'vtt.scene.activated',
  'vtt.scene.archived',
  'vtt.token.changed',
  'vtt.wall.changed',
  'vtt.door.changed',
  'vtt.light.changed',
  'vtt.fog.changed',
  'vtt.annotation.changed',
  'vtt.template.changed',
  'vtt.terrain.changed',
  'vtt.ping',
  'vtt.camera.changed',
  'vtt.encounter.changed',
  'vtt.combat.bound',
  'vtt.preset.ran',
  'vtt.rundown.changed',
  'vtt.announcement',
  'vtt.handout',
  'vtt.poll',
  'vtt.recording.marker',
  'vtt.checkpoint.created',
  'vtt.checkpoint.restored',
  'vtt.qlab.result',
] as const;

export type VttEventType = (typeof VTT_EVENT_TYPES)[number];

export interface DurableEvent {
  sequence: number;
  protocolVersion: number;
  sessionId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  type: VttEventType;
  actorId: string | null;
  source: string;
  payload: Record<string, unknown>;
  timestamp: string;
  commandId: string;
  commandType?: VttCommandType;
}

export function parseDurableEvent(value: unknown): DurableEvent {
  const raw = requireRecord(value, 'event');
  const type = raw.type;
  if (typeof type !== 'string' || !(VTT_EVENT_TYPES as readonly string[]).includes(type)) {
    throw new ProtocolError('invalid_request', `Unknown event type: ${String(type)}`);
  }
  return {
    sequence: requireInteger(raw.sequence, 'sequence'),
    protocolVersion: requireProtocolVersion(raw.protocolVersion ?? PROTOCOL_VERSION),
    sessionId: requireString(raw.sessionId, 'sessionId'),
    aggregateType: requireString(raw.aggregateType, 'aggregateType'),
    aggregateId: requireString(raw.aggregateId, 'aggregateId'),
    aggregateVersion: requireInteger(raw.aggregateVersion, 'aggregateVersion'),
    type: type as VttEventType,
    actorId: raw.actorId === null || raw.actorId === undefined ? null : requireString(raw.actorId, 'actorId'),
    source: requireString(raw.source, 'source'),
    payload: raw.payload === undefined ? {} : requireRecord(raw.payload, 'payload'),
    timestamp: requireString(raw.timestamp, 'timestamp'),
    commandId: requireString(raw.commandId, 'commandId'),
  };
}

export interface EphemeralEvent {
  kind: 'cursor' | 'drag' | 'presence' | 'ruler' | 'selection';
  sessionId: string;
  actorId: string;
  at: string;
  payload: Record<string, unknown>;
}
