import { createEngine, createId, nowIso, sqliteStore } from '@actualplay/engine';
import { bootstrapAdmin } from '@actualplay/next';
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

void engine.start().then(async () => {
  await bootstrapAdmin(engine, { username: 'admin', password: 'admin' });
  const admin = engine.store.getUserByUsername('admin');
  if (admin && !engine.store.getUserByUsername('dm')) {
    const now = nowIso();
    engine.store.createUser({
      id: createId(),
      first_name: 'Dana',
      last_name: null,
      username: 'dm',
      email: 'dm@local',
      role: 'dm',
      password_hash: admin.password_hash,
      created_at: now,
      updated_at: now,
    });
  }
});
