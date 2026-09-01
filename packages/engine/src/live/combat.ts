export type CombatCommand =
  | 'build_order'
  | 'start_combat'
  | 'dismiss_prep'
  | 'end_combat'
  | 'next_turn'
  | 'previous_turn'
  | 'new_round'
  | 'reset_counter';

export interface CombatAction {
  type: string;
  label: string;
  command: CombatCommand;
  cueName?: string;
}

export const COMBAT_ACTIONS: readonly CombatAction[] = [
  { type: 'combat_build_order', label: 'Build Order', command: 'build_order' },
  {
    type: 'combat_start_battle_1',
    label: 'Start Combat: Battle 1',
    command: 'start_combat',
    cueName: 'combat.battle-1',
  },
  {
    type: 'combat_start_battle_2',
    label: 'Start Combat: Battle 2',
    command: 'start_combat',
    cueName: 'combat.battle-2',
  },
  { type: 'combat_dismiss_prep', label: 'Dismiss Prep', command: 'dismiss_prep' },
  { type: 'combat_end', label: 'End Combat', command: 'end_combat' },
  { type: 'combat_next_turn', label: 'Next Turn', command: 'next_turn' },
  { type: 'combat_previous_turn', label: 'Previous Turn', command: 'previous_turn' },
  { type: 'combat_new_round', label: 'New Round', command: 'new_round' },
  { type: 'combat_reset_counter', label: 'Reset Counter', command: 'reset_counter' },
] as const;

export function getCombatAction(actionType: unknown): CombatAction | null {
  if (typeof actionType !== 'string') return null;
  return COMBAT_ACTIONS.find((action) => action.type === actionType) ?? null;
}

export function isCombatActionType(actionType: unknown): actionType is string {
  return getCombatAction(actionType) !== null;
}

export function isTriggeringMidiNote(midiType: unknown, velocity: unknown, data2: unknown): boolean {
  if (midiType !== 'note_on') return false;
  const value = typeof velocity === 'number' ? velocity : typeof data2 === 'number' ? data2 : 0;
  return value > 0;
}

export function calculateCombatTurn({
  direction,
  currentTurn,
  roundNumber,
  participantCount,
}: {
  direction: 'forward' | 'backward';
  currentTurn: number;
  roundNumber: number;
  participantCount: number;
}): { current_turn: number; round_number: number } {
  if (participantCount <= 0) {
    return { current_turn: 0, round_number: Math.max(1, roundNumber) };
  }

  const clampedTurn = Math.min(Math.max(0, currentTurn), participantCount - 1);
  const clampedRound = Math.max(1, roundNumber);

  if (direction === 'forward') {
    const nextTurn = (clampedTurn + 1) % participantCount;
    const nextRound = nextTurn === 0 && clampedTurn !== 0 ? clampedRound + 1 : clampedRound;
    return { current_turn: nextTurn, round_number: nextRound };
  }

  const previousTurn = clampedTurn - 1 < 0 ? participantCount - 1 : clampedTurn - 1;
  const previousRound =
    clampedTurn === 0 && previousTurn === participantCount - 1 && clampedRound > 1
      ? clampedRound - 1
      : clampedRound;

  return { current_turn: previousTurn, round_number: previousRound };
}

export function commandTypeForCombatAction(
  action: CombatAction
):
  | 'combat.build_order'
  | 'combat.start'
  | 'combat.dismiss_prep'
  | 'combat.end'
  | 'combat.next_turn'
  | 'combat.previous_turn'
  | 'combat.new_round'
  | 'combat.reset_counter' {
  switch (action.command) {
    case 'build_order':
      return 'combat.build_order';
    case 'start_combat':
      return 'combat.start';
    case 'dismiss_prep':
      return 'combat.dismiss_prep';
    case 'end_combat':
      return 'combat.end';
    case 'next_turn':
      return 'combat.next_turn';
    case 'previous_turn':
      return 'combat.previous_turn';
    case 'new_round':
      return 'combat.new_round';
    case 'reset_counter':
      return 'combat.reset_counter';
  }
}
