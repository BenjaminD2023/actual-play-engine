import {
  commandTypeForCombatAction,
  getCombatAction,
  isCombatActionType,
} from '../live/combat.js';
import type { CommandType } from '../commands/types.js';

export interface MidiEvent {
  type?: string;
  midiType?: string;
  channel?: number;
  data1?: number;
  data2?: number;
  note?: number | null;
  velocity?: number | null;
  command?: number;
  status?: number;
  raw?: number[];
  deviceName?: string;
  bridgeId?: string;
  source?: string;
  actionType?: string;
  actionData?: Record<string, unknown>;
  label?: string;
  suppressQlab?: boolean;
  timestamp?: number;
}

export interface MidiKeybind {
  id: string;
  midi_type: string;
  midi_channel: number;
  midi_data1: number;
  midi_data2: number;
  action_type: string;
  action_data: Record<string, unknown>;
  label: string;
  is_active: boolean;
}

export function parseActionData(
  raw: string | Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function getActionTarget(actionData: Record<string, unknown> | undefined): string | undefined {
  if (!actionData) return undefined;
  const note = typeof actionData.note === 'string' ? actionData.note.trim() : '';
  if (note) return note;
  const cueNumber = typeof actionData.cueNumber === 'string' ? actionData.cueNumber.trim() : '';
  if (cueNumber) return cueNumber;
  const cueName = typeof actionData.cueName === 'string' ? actionData.cueName.trim() : '';
  return cueName || undefined;
}

export function midiActionToCommandType(actionType: string): CommandType | null {
  switch (actionType) {
    case 'qlab_go':
      return 'qlab.go';
    case 'qlab_cue':
      return 'qlab.start';
    case 'qlab_stop':
      return 'qlab.stop';
    case 'qlab_panic':
      return 'qlab.panic';
    case 'qlab_reset':
      return 'qlab.reset';
    case 'qlab_cue_stop':
      return 'qlab.stopCue';
    case 'osc_custom':
      return 'qlab.custom';
    default: {
      if (!isCombatActionType(actionType)) return null;
      const action = getCombatAction(actionType);
      return action ? commandTypeForCombatAction(action) : null;
    }
  }
}
