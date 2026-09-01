import { LivePlayError } from '../errors.js';

export const RESOURCE_FIELDS = [
  'spell_slots_level_1',
  'spell_slots_level_2',
  'spell_slots_level_3',
  'spell_slots_level_4',
  'spell_slots_level_5',
  'spell_slots_level_6',
  'spell_slots_level_7',
  'spell_slots_level_8',
  'spell_slots_level_9',
  'inspiration_tokens',
] as const;

export type ResourceField = (typeof RESOURCE_FIELDS)[number];

export interface PlayerStats {
  character_name: string;
  armor_class: number;
  current_hp: number;
  max_hp: number;
  temp_hp: number;
  spell_slots_level_1: number;
  spell_slots_level_2: number;
  spell_slots_level_3: number;
  spell_slots_level_4: number;
  spell_slots_level_5: number;
  spell_slots_level_6: number;
  spell_slots_level_7: number;
  spell_slots_level_8: number;
  spell_slots_level_9: number;
  inspiration_tokens: number;
}

export interface PollDraft {
  question: string;
  options: string[];
  countdown_enabled: boolean;
}

export type PollType = 'standard' | 'betray';
export type PollDisplayVisibility = 'public' | 'audience_only';
export type PollManagementAction = 'show_results' | 'close' | 'dismiss' | 'delete';

export const DEFAULT_POLL_TYPE: PollType = 'standard';
export const DEFAULT_POLL_DISPLAY_VISIBILITY: PollDisplayVisibility = 'public';
export const BETRAY_POLL_QUESTION = 'Should the audience betray the party?';
export const BETRAY_POLL_OPTIONS = ['Betray', 'Stay Loyal'];
export const DEFAULT_POLL_COUNTDOWN_SECONDS = 10;
export const DEFAULT_POLL_RESULTS_SECONDS = 10;

export interface TimedPollState {
  is_active: number | boolean;
  show_results: number | boolean;
  countdown_enabled?: number | boolean | null;
  countdown_duration_seconds?: number | null;
  results_duration_seconds?: number | null;
  created_at?: string | null;
  results_shown_at?: string | null;
}

export interface TimedPollLifecycleUpdate {
  is_active?: 0;
  show_results?: 0 | 1;
  results_shown_at?: string;
  ended_at?: string;
}

function toInteger(value: unknown): number | null {
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

export function clampNonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = toInteger(value);
  if (parsed === null) return Math.max(0, Math.trunc(fallback));
  return Math.max(0, parsed);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['false', '0', 'off', 'no'].includes(normalized)) return false;
    if (['true', '1', 'on', 'yes'].includes(normalized)) return true;
  }
  return fallback;
}

function isEnabled(value: number | boolean | null | undefined, fallback = true): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

function secondsFrom(value: number | null | undefined, fallback: number): number {
  return Math.max(1, Math.trunc(value ?? fallback));
}

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizePollDraft(
  question: unknown,
  options: unknown,
  countdownEnabled: unknown = true
): PollDraft {
  const normalizedQuestion = typeof question === 'string' ? question.trim() : '';
  if (!normalizedQuestion) {
    throw new LivePlayError('invalid_poll', 'Vote question is required.');
  }

  const normalizedOptions = Array.isArray(options)
    ? options.map((option) => (typeof option === 'string' ? option.trim() : '')).filter(Boolean)
    : [];

  if (normalizedOptions.length < 2) {
    throw new LivePlayError('invalid_poll', 'At least two vote options are required.');
  }

  return {
    question: normalizedQuestion,
    options: normalizedOptions,
    countdown_enabled: normalizeBoolean(countdownEnabled, true),
  };
}

export function buildBetrayPollDraft(): PollDraft & {
  poll_type: 'betray';
  display_visibility: 'audience_only';
} {
  return {
    question: BETRAY_POLL_QUESTION,
    options: [...BETRAY_POLL_OPTIONS],
    countdown_enabled: true,
    poll_type: 'betray',
    display_visibility: 'audience_only',
  };
}

export function shouldShowPollOnDisplay(
  poll: { display_visibility?: string | null } | null | undefined
): boolean {
  return poll?.display_visibility !== 'audience_only';
}

export function getTimedPollLifecycleUpdate(
  poll: TimedPollState,
  now = new Date()
): TimedPollLifecycleUpdate | null {
  if (!isEnabled(poll.is_active, false) || !isEnabled(poll.countdown_enabled, true)) {
    return null;
  }

  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const countdownMs =
    secondsFrom(poll.countdown_duration_seconds, DEFAULT_POLL_COUNTDOWN_SECONDS) * 1000;
  const resultsMs = secondsFrom(poll.results_duration_seconds, DEFAULT_POLL_RESULTS_SECONDS) * 1000;

  if (!isEnabled(poll.show_results, false)) {
    const createdMs = parseDateMs(poll.created_at);
    if (createdMs !== null && nowMs - createdMs >= countdownMs) {
      return { show_results: 1, results_shown_at: nowIso };
    }
    return null;
  }

  const resultsShownMs = parseDateMs(poll.results_shown_at);
  if (resultsShownMs !== null && nowMs - resultsShownMs >= resultsMs) {
    return { is_active: 0, show_results: 0, ended_at: nowIso };
  }

  return null;
}

export function normalizeCharacterPatch(
  body: Record<string, unknown>,
  currentPlayer: PlayerStats
): { updates: Partial<PlayerStats>; bumpsVersion: boolean } {
  const updates: Partial<PlayerStats> = {};

  if (body.character_name !== undefined) {
    const characterName = String(body.character_name).trim();
    if (!characterName) {
      throw new LivePlayError('invalid_character', 'Character name is required.');
    }
    updates.character_name = characterName;
  }

  if (body.armor_class !== undefined) {
    updates.armor_class = clampNonNegativeInteger(body.armor_class, currentPlayer.armor_class);
  }

  const nextMaxHp =
    body.max_hp !== undefined
      ? Math.max(1, clampNonNegativeInteger(body.max_hp, currentPlayer.max_hp))
      : currentPlayer.max_hp;

  if (body.max_hp !== undefined) {
    updates.max_hp = nextMaxHp;
  }

  if (body.current_hp !== undefined) {
    updates.current_hp = Math.min(
      nextMaxHp,
      clampNonNegativeInteger(body.current_hp, currentPlayer.current_hp)
    );
  } else if (body.max_hp !== undefined && currentPlayer.current_hp > nextMaxHp) {
    updates.current_hp = nextMaxHp;
  }

  if (body.temp_hp !== undefined) {
    updates.temp_hp = clampNonNegativeInteger(body.temp_hp, currentPlayer.temp_hp);
  }

  for (const field of RESOURCE_FIELDS) {
    if (body[field] !== undefined) {
      updates[field] = clampNonNegativeInteger(body[field], currentPlayer[field]);
    }
  }

  const bumpsVersion = ['armor_class', 'current_hp', 'max_hp', 'temp_hp', ...RESOURCE_FIELDS].some(
    (field) => field in updates
  );

  if (Object.keys(updates).length === 0) {
    throw new LivePlayError('invalid_character', 'No supported character updates were provided.');
  }

  return { updates, bumpsVersion };
}

export function parseInitiativeSubmission(body: Record<string, unknown>): {
  initiative_result: number;
  initiative_modifier: number;
  initiative_total: number;
} {
  const initiativeResult = toInteger(body.initiative_result);
  const initiativeModifier = toInteger(body.initiative_modifier) ?? 0;

  if (initiativeResult === null || initiativeResult < 1 || initiativeResult > 20) {
    throw new LivePlayError('invalid_initiative', 'Enter the d20 roll as a whole number from 1 to 20.');
  }
  if (initiativeModifier < -99 || initiativeModifier > 99) {
    throw new LivePlayError('invalid_initiative', 'Enter an initiative modifier between -99 and 99.');
  }

  return {
    initiative_result: initiativeResult,
    initiative_modifier: initiativeModifier,
    initiative_total: initiativeResult + initiativeModifier,
  };
}

export function buildQuickPollQuestion(characterName: string): string {
  const normalizedName = characterName.trim() || 'the audience character';
  return `What should ${normalizedName} do?`;
}

export function normalizePollManagementAction(value: unknown): PollManagementAction {
  if (value === 'show_results' || value === 'close' || value === 'dismiss' || value === 'delete') {
    return value;
  }
  throw new LivePlayError('invalid_poll', 'Unknown poll action.');
}

export function syncEditableNameDraft(currentDraft: string, serverName: string, isEditing: boolean): string {
  return isEditing ? currentDraft : serverName;
}
