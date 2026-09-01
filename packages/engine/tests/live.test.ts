import { describe, expect, it } from 'vitest';
import { applyHpButtonDelta } from '../src/live/hp.js';
import { calculateCombatTurn, isTriggeringMidiNote } from '../src/live/combat.js';
import {
  BETRAY_POLL_OPTIONS,
  BETRAY_POLL_QUESTION,
  buildBetrayPollDraft,
  getTimedPollLifecycleUpdate,
  normalizeCharacterPatch,
  normalizePollDraft,
  shouldShowPollOnDisplay,
} from '../src/audience/polls.js';
import { LivePlayError } from '../src/errors.js';
import { createEngine } from '../src/engine.js';
import { memoryStore } from '../src/store/memory.js';
import { createId } from '../src/ids.js';
import { MidiDedupe } from '../src/midi/keybinds.js';
import { verifyBridgeToken, hashBridgeToken } from '../src/midi/token.js';

describe('HP', () => {
  it('heals without exceeding max and spends temp HP first', () => {
    expect(applyHpButtonDelta({ current_hp: 8, max_hp: 10, temp_hp: 0, delta: 5 })).toEqual({
      current_hp: 10,
      temp_hp: 0,
    });
    expect(applyHpButtonDelta({ current_hp: 8, max_hp: 10, temp_hp: 3, delta: -4 })).toEqual({
      current_hp: 7,
      temp_hp: 0,
    });
  });
});

describe('combat turns', () => {
  it('advances rounds only when wrapping from later turns', () => {
    expect(
      calculateCombatTurn({ direction: 'forward', currentTurn: 2, roundNumber: 3, participantCount: 3 })
    ).toEqual({ current_turn: 0, round_number: 4 });
    expect(
      calculateCombatTurn({ direction: 'backward', currentTurn: 0, roundNumber: 1, participantCount: 4 })
    ).toEqual({ current_turn: 3, round_number: 1 });
  });

  it('ignores note-off and zero-velocity note-on', () => {
    expect(isTriggeringMidiNote('note_on', 127, 127)).toBe(true);
    expect(isTriggeringMidiNote('note_on', 0, 0)).toBe(false);
    expect(isTriggeringMidiNote('note_off', 0, 0)).toBe(false);
  });
});

describe('polls', () => {
  it('rejects empty questions and requires two options', () => {
    expect(() => normalizePollDraft('   ', ['Attack', 'Defend'])).toThrow(LivePlayError);
    expect(() => normalizePollDraft('What now?', ['Attack', '   '])).toThrow(LivePlayError);
    expect(normalizePollDraft('  What now? ', [' Attack ', '', ' Defend '])).toEqual({
      question: 'What now?',
      options: ['Attack', 'Defend'],
      countdown_enabled: true,
    });
  });

  it('builds an audience-only betray vote', () => {
    expect(buildBetrayPollDraft()).toEqual({
      question: BETRAY_POLL_QUESTION,
      options: BETRAY_POLL_OPTIONS,
      countdown_enabled: true,
      poll_type: 'betray',
      display_visibility: 'audience_only',
    });
    expect(shouldShowPollOnDisplay({ display_visibility: 'audience_only' })).toBe(false);
  });

  it('advances timed poll lifecycle', () => {
    expect(
      getTimedPollLifecycleUpdate(
        {
          is_active: 1,
          show_results: 0,
          countdown_enabled: 1,
          countdown_duration_seconds: 10,
          results_duration_seconds: 10,
          created_at: '2026-06-07T12:00:00.000Z',
          results_shown_at: null,
        },
        new Date('2026-06-07T12:00:10.000Z')
      )
    ).toEqual({
      show_results: 1,
      results_shown_at: '2026-06-07T12:00:10.000Z',
    });
  });

  it('clamps character patches', () => {
    const player = {
      character_name: 'Wizard',
      armor_class: 12,
      current_hp: 20,
      max_hp: 30,
      temp_hp: 0,
      spell_slots_level_1: 2,
      spell_slots_level_2: 1,
      spell_slots_level_3: 0,
      spell_slots_level_4: 0,
      spell_slots_level_5: 0,
      spell_slots_level_6: 0,
      spell_slots_level_7: 0,
      spell_slots_level_8: 0,
      spell_slots_level_9: 0,
      inspiration_tokens: 1,
    };
    expect(normalizeCharacterPatch({ current_hp: 99 }, player).updates.current_hp).toBe(30);
  });
});

describe('engine live play', () => {
  it('builds combat order and starts a mapped battle cue', async () => {
    const store = memoryStore();
    const engine = createEngine({
      store,
      qlab: { dryRun: true },
      cues: { 'combat.battle-1': '10' },
    });
    await engine.start();
    const session = engine.ensureSession();
    store.createPlayer({
      id: 'p1',
      auth_user_id: null,
      session_id: session.id,
      character_name: 'Fighter',
      character_class: 'Fighter',
      character_level: 1,
      armor_class: 16,
      current_hp: 12,
      max_hp: 12,
      temp_hp: 0,
      version: 1,
      spell_slots_level_1: 0,
      spell_slots_level_2: 0,
      spell_slots_level_3: 0,
      spell_slots_level_4: 0,
      spell_slots_level_5: 0,
      spell_slots_level_6: 0,
      spell_slots_level_7: 0,
      spell_slots_level_8: 0,
      spell_slots_level_9: 0,
      inspiration_tokens: 0,
      portrait_url: '',
      audience_tags: '[]',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await engine.dispatch({ id: createId(), type: 'combat.build_order', source: 'dm' });
    expect(store.listInitiative(session.id)).toHaveLength(1);
    const started = await engine.startCombat('combat.battle-1', { source: 'dm' });
    expect(started.ok).toBe(true);
    expect(started.cueNumber).toBe('10');
    await engine.stop();
  });

  it('rejects a second audience vote from the same fingerprint', () => {
    const engine = createEngine({ qlab: { dryRun: true } });
    engine.ensureSession();
    const poll = engine.openPoll({ question: 'Go left?', options: ['Left', 'Right'] });
    const option = engine.store.listPollOptions(poll.id)[0]!;
    engine.vote(poll.id, option.id, 'device-1');
    expect(() => engine.vote(poll.id, option.id, 'device-1')).toThrow(/already voted/i);
  });
});

describe('MIDI helpers', () => {
  it('dedupes combat fires inside the window', () => {
    const dedupe = new MidiDedupe(500);
    expect(dedupe.shouldSkip('combat.start', 0, 36, 1000)).toBe(false);
    expect(dedupe.shouldSkip('combat.start', 0, 36, 1100)).toBe(true);
    expect(dedupe.shouldSkip('combat.start', 0, 36, 1600)).toBe(false);
  });

  it('compares bridge tokens with a hash, never the raw secret', () => {
    const token = 'super-secret-token';
    const hash = hashBridgeToken(token);
    expect(verifyBridgeToken(token, hash)).toBe(true);
    expect(verifyBridgeToken('nope', hash)).toBe(false);
  });
});
