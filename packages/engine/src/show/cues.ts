import { ShowCueError } from '../errors.js';
import { assertCueNumber } from '../qlab/addresses.js';

export type ShowCueMap = Record<string, string>;

export function normalizeShowCueMap(input: ShowCueMap | undefined): ShowCueMap {
  const result: ShowCueMap = {};
  if (!input) return result;
  for (const [name, cueNumber] of Object.entries(input)) {
    const trimmedName = name.trim();
    const trimmedCue = cueNumber.trim();
    if (!trimmedName) continue;
    if (!trimmedCue) continue;
    result[trimmedName] = assertCueNumber(trimmedCue);
  }
  return result;
}

export class ShowCues {
  private map: ShowCueMap;

  constructor(map: ShowCueMap = {}) {
    this.map = normalizeShowCueMap(map);
  }

  list(): ShowCueMap {
    return { ...this.map };
  }

  has(name: string): boolean {
    return this.resolveCueNumber(name) !== null;
  }

  set(name: string, cueNumber: string): void {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new ShowCueError('invalid_name', 'Show cue name is required.');
    }
    this.map[trimmedName] = assertCueNumber(cueNumber);
  }

  remove(name: string): void {
    delete this.map[name];
  }

  replace(map: ShowCueMap): void {
    this.map = normalizeShowCueMap(map);
  }

  resolve(name: string): string {
    const cueNumber = this.resolveCueNumber(name);
    if (!cueNumber) {
      throw new ShowCueError(
        'missing_cue',
        `Show cue "${name}" is not mapped to a QLab cue number.`
      );
    }
    return cueNumber;
  }

  private resolveCueNumber(name: string): string | null {
    const trimmed = name.trim();
    const direct = this.map[trimmed];
    if (direct) return direct;
    const aliases = LEGACY_ALIASES[trimmed];
    if (!aliases) return null;
    for (const alias of aliases) {
      const mapped = this.map[alias];
      if (mapped) return mapped;
    }
    return null;
  }
}

const LEGACY_ALIASES: Record<string, string[]> = {
  welcome: ['show.welcome'],
  end: ['show.end'],
  battle: ['combat.battle-1', 'battle1'],
  battle1: ['combat.battle-1'],
  battle2: ['combat.battle-2'],
  'combat.battle-1': ['battle1', 'battle'],
  'combat.battle-2': ['battle2'],
  'show.welcome': ['welcome'],
  'show.end': ['end'],
};
