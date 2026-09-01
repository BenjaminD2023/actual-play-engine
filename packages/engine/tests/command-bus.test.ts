import { describe, expect, it } from 'vitest';
import { createEngine } from '../src/engine.js';
import { memoryStore } from '../src/store/memory.js';
import { createId } from '../src/ids.js';

describe('CommandBus', () => {
  it('fires a mapped show cue through dry-run QLab and logs it', async () => {
    const engine = createEngine({
      qlab: { dryRun: true },
      cues: { 'show.welcome': '1', 'combat.battle-1': '10' },
    });
    await engine.start();

    const result = await engine.fireShowCue('show.welcome', { source: 'dm' });
    expect(result.ok).toBe(true);
    expect(result.confirmed ?? result.qlab?.confirmed).toBe(true);
    expect(result.qlab?.address).toContain('/cue/1/start');
    expect(engine.store.listFireLog()[0]?.cueName).toBe('show.welcome');

    await engine.stop();
  });

  it('resolves legacy battle1 names to combat.battle-1', async () => {
    const engine = createEngine({
      qlab: { dryRun: true },
      cues: { 'combat.battle-1': '10' },
    });
    await engine.start();
    const result = await engine.fireShowCue('battle1', { source: 'admin' });
    expect(result.ok).toBe(true);
    expect(result.cueNumber).toBe('10');
    await engine.stop();
  });

  it('does not silently skip an unmapped cue', async () => {
    const engine = createEngine({ qlab: { dryRun: true }, cues: {} });
    await engine.start();
    const result = await engine.fireShowCue('show.end', { source: 'dm' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not mapped/);
    await engine.stop();
  });

  it('dedupes the same command id', async () => {
    const engine = createEngine({
      qlab: { dryRun: true },
      cues: { 'show.welcome': '1' },
    });
    await engine.start();
    const id = createId();
    await engine.dispatch({
      id,
      type: 'show.fire',
      source: 'dm',
      payload: { name: 'show.welcome' },
    });
    await engine.dispatch({
      id,
      type: 'show.fire',
      source: 'dm',
      payload: { name: 'show.welcome' },
    });
    expect(engine.store.listFireLog()).toHaveLength(1);
    await engine.stop();
  });

  it('refuses audience GO on the theatre', async () => {
    const engine = createEngine({ qlab: { dryRun: true }, cues: { 'show.welcome': '1' } });
    await engine.start();
    await expect(engine.fireShowCue('show.welcome', { source: 'audience' })).rejects.toThrow(/cannot control/i);
    await engine.stop();
  });

  it('keeps MIDI, combat start, and HTTP on one log', async () => {
    const store = memoryStore();
    const engine = createEngine({
      store,
      qlab: { dryRun: true },
      cues: { 'combat.battle-1': '10' },
    });
    await engine.start();
    engine.ensureSession();
    store.createPlayer({
      id: 'p1',
      auth_user_id: null,
      session_id: store.getActiveSession()!.id,
      character_name: 'Wizard',
      character_class: 'Wizard',
      character_level: 3,
      armor_class: 12,
      current_hp: 10,
      max_hp: 10,
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
    await engine.startCombat('combat.battle-1', { source: 'midi' });
    await engine.fireShowCue('combat.battle-1', { source: 'admin' });

    const types = engine.store.listFireLog().map((entry) => entry.type);
    expect(types).toContain('show.fire');
    expect(types).toContain('combat.build_order');
    await engine.stop();
  });
});
