import { PROTOCOL_VERSION, type VttCommandType } from '@actualplay/protocol';
import { createEngine } from '../src/engine.js';
import type { EngineStore } from '../src/store/types.js';
import { createId, nowIso } from '../src/ids.js';

export async function harness(store?: EngineStore) {
  const engine = createEngine({
    store,
    qlab: { dryRun: true },
    cues: { 'show.welcome': '1', 'show.end': '99' },
    vtt: { enabled: true, assetRoot: '/tmp/actualplay-vtt-assets' },
  });
  await engine.start();
  const session = engine.ensureSession('VTT');
  const now = nowIso();
  const dm = engine.store.createUser({
    id: 'user-dm',
    first_name: 'Dana',
    last_name: 'Master',
    username: 'dm',
    email: 'dm@local',
    role: 'dm',
    password_hash: 'x',
    created_at: now,
    updated_at: now,
  });
  const p1 = engine.store.createUser({
    id: 'user-p1',
    first_name: 'Pat',
    last_name: 'One',
    username: 'p1',
    email: 'p1@local',
    role: 'player',
    password_hash: 'x',
    created_at: now,
    updated_at: now,
  });
  const p2 = engine.store.createUser({
    id: 'user-p2',
    first_name: 'Quinn',
    last_name: 'Two',
    username: 'p2',
    email: 'p2@local',
    role: 'player',
    password_hash: 'x',
    created_at: now,
    updated_at: now,
  });
  const player1 = engine.store.createPlayer({
    id: 'player-1',
    auth_user_id: p1.id,
    session_id: session.id,
    character_name: 'Ranger',
    character_class: 'ranger',
    character_level: 3,
    armor_class: 15,
    current_hp: 24,
    max_hp: 24,
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
    created_at: now,
    updated_at: now,
  });
  const player2 = engine.store.createPlayer({
    id: 'player-2',
    auth_user_id: p2.id,
    session_id: session.id,
    character_name: 'Cleric',
    character_class: 'cleric',
    character_level: 3,
    armor_class: 16,
    current_hp: 20,
    max_hp: 20,
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
    created_at: now,
    updated_at: now,
  });
  const vtt = engine.vtt;
  return {
    engine,
    vtt,
    session,
    dm: vtt.actorFrom({ userId: dm.id, role: 'dm' }),
    playerOne: vtt.actorFrom({ userId: p1.id, role: 'player', playerId: player1.id }),
    playerTwo: vtt.actorFrom({ userId: p2.id, role: 'player', playerId: player2.id }),
    audience: vtt.actorFrom({ userId: 'aud', role: 'audience' }),
    broadcast: vtt.actorFrom({ userId: null, role: 'system', viewer: 'broadcast' }),
    cmd: (type: VttCommandType, payload: Record<string, unknown> = {}, id = createId()) => ({
      id,
      protocolVersion: PROTOCOL_VERSION,
      type,
      sessionId: session.id,
      payload,
    }),
  };
}


