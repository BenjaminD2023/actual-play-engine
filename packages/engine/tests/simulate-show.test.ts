import { afterEach, describe, expect, it } from 'vitest';
import { createEngine } from '../src/engine.js';
import { MockQLabServer } from '../src/mock-qlab/server.js';
import { memoryStore } from '../src/store/memory.js';
import { createId } from '../src/ids.js';

const servers: MockQLabServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.stop();
  }
});

describe('simulate-show', () => {
  it('runs welcome → combat → panic against a mock QLab', async () => {
    const mock = new MockQLabServer();
    servers.push(mock);
    const { host, port } = await mock.start();
    const store = memoryStore();
    const engine = createEngine({
      store,
      qlab: { host, port, heartbeatIntervalMs: 60_000 },
      cues: {
        'show.welcome': '1',
        'combat.battle-1': '10',
        'show.end': '99',
      },
    });

    await engine.start();
    const session = engine.ensureSession('Sim');
    store.createPlayer({
      id: 'p1',
      auth_user_id: null,
      session_id: session.id,
      character_name: 'Sim Hero',
      character_class: 'Bard',
      character_level: 5,
      armor_class: 14,
      current_hp: 30,
      max_hp: 30,
      temp_hp: 0,
      version: 1,
      spell_slots_level_1: 4,
      spell_slots_level_2: 3,
      spell_slots_level_3: 2,
      spell_slots_level_4: 0,
      spell_slots_level_5: 0,
      spell_slots_level_6: 0,
      spell_slots_level_7: 0,
      spell_slots_level_8: 0,
      spell_slots_level_9: 0,
      inspiration_tokens: 1,
      portrait_url: '',
      audience_tags: '[]',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const welcome = await engine.fireShowCue('show.welcome', { source: 'admin' });
    expect(welcome.ok).toBe(true);
    expect(welcome.qlab?.confirmed).toBe(true);

    await engine.dispatch({ id: createId(), type: 'combat.build_order', source: 'dm' });
    const combat = await engine.startCombat('combat.battle-1', { source: 'dm' });
    expect(combat.ok).toBe(true);
    expect(combat.cueNumber).toBe('10');

    const panic = await engine.panic({ source: 'dm' });
    expect(panic.ok).toBe(true);

    const addresses = mock.received.map((message) => message.address);
    expect(addresses.some((address) => address.endsWith('/cue/1/start'))).toBe(true);
    expect(addresses.some((address) => address.endsWith('/cue/10/start'))).toBe(true);
    expect(addresses.some((address) => address.endsWith('/panic'))).toBe(true);

    const log = engine.store.listFireLog();
    expect(log.some((entry) => entry.cueName === 'show.welcome' && entry.confirmed)).toBe(true);
    expect(log.some((entry) => entry.type === 'qlab.panic' && entry.confirmed)).toBe(true);

    await engine.stop();
  });
});
