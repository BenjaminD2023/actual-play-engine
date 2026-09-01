import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sqliteStore } from '../src/store/sqlite.js';
import { createEngine } from '../src/engine.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('sqlite store', () => {
  it('persists show cues and fire log', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'actualplay-'));
    dirs.push(dir);
    const dbPath = path.join(dir, 'show.db');
    const store = sqliteStore(dbPath);
    const engine = createEngine({
      store,
      qlab: { dryRun: true },
      cues: { 'show.welcome': '1' },
    });
    await engine.start();
    const result = await engine.fireShowCue('show.welcome', { source: 'admin' });
    expect(result.ok).toBe(true);
    await engine.stop();

    const reopened = sqliteStore(dbPath);
    expect(reopened.getConfig().cues['show.welcome']).toBe('1');
    expect(reopened.listFireLog()[0]?.cueName).toBe('show.welcome');
    reopened.close();
  });
});
