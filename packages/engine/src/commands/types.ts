import type { CommandSource } from '../auth/roles.js';
import type { QLabAckStatus, QLabCommandResult } from '../qlab/types.js';

export type CommandType =
  | 'qlab.start'
  | 'qlab.stopCue'
  | 'qlab.go'
  | 'qlab.stop'
  | 'qlab.panic'
  | 'qlab.reset'
  | 'qlab.custom'
  | 'show.fire'
  | 'combat.build_order'
  | 'combat.start'
  | 'combat.dismiss_prep'
  | 'combat.end'
  | 'combat.next_turn'
  | 'combat.previous_turn'
  | 'combat.new_round'
  | 'combat.reset_counter'
  | 'player.action';

export interface CommandMeta {
  id?: string;
  source: CommandSource;
  actorId?: string | null;
}

export interface EngineCommand extends CommandMeta {
  id: string;
  type: CommandType;
  payload?: Record<string, unknown>;
}

export interface CommandResult {
  commandId: string;
  type: CommandType;
  ok: boolean;
  skipped?: string;
  qlab?: QLabCommandResult;
  status: QLabAckStatus | 'skipped' | 'error';
  cueName?: string;
  cueNumber?: string;
  error?: string;
}

export interface FireLogEntry {
  id: string;
  at: string;
  commandId: string;
  type: string;
  source: CommandSource;
  actorId: string | null;
  cueName: string | null;
  cueNumber: string | null;
  address: string | null;
  status: CommandResult['status'];
  confirmed: boolean;
  error: string | null;
}
