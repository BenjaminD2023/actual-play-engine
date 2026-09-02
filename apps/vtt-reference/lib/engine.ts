import { createEngine, nowIso, sqliteStore, type PlayerRecord } from '@actualplay/engine';
import { bootstrapUser } from '@actualplay/next';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const engine = createEngine({
  store: sqliteStore(path.join(dataDir, 'show.db')),
  qlab: { dryRun: true },
  cues: {
    'show.welcome': '1',
    'show.end': '99',
    'combat.battle-1': '10',
  },
  vtt: { enabled: true, assetRoot: path.join(dataDir, 'assets') },
});

export const engineReady = (async () => {
  await engine.start();
  await bootstrapUser(engine, { id: 'user-admin', username: 'admin', password: 'admin', role: 'admin' });
  await bootstrapUser(engine, { id: 'user-dm', username: 'dm', password: 'dm', role: 'dm' });
  await bootstrapUser(engine, { id: 'user-p1', username: 'p1', password: 'p1', role: 'player' });
  await bootstrapUser(engine, { id: 'user-p2', username: 'p2', password: 'p2', role: 'player' });
  await bootstrapUser(engine, { id: 'user-aud', username: 'audience', password: 'audience', role: 'audience' });
  const session = engine.ensureSession('Reference session');
  seedPlayer(session.id, 'player-1', 'user-p1', 'Ranger');
  seedPlayer(session.id, 'player-2', 'user-p2', 'Cleric');
})();

function seedPlayer(sessionId: string, id: string, authUserId: string, name: string): void {
  if (engine.store.getPlayer(id)) return;
  const now = nowIso();
  const player: PlayerRecord = {
    id,
    auth_user_id: authUserId,
    session_id: sessionId,
    character_name: name,
    character_class: 'adventurer',
    character_level: 3,
    armor_class: 14,
    current_hp: 22,
    max_hp: 22,
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
  };
  engine.store.createPlayer(player);
}
