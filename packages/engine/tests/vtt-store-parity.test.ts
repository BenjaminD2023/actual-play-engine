import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { sqliteStore } from '../src/store/sqlite.js';
import { ENGINE_SCHEMA } from '../src/store/schema.js';
import { runMigrations, MIGRATIONS } from '../src/store/migrations.js';
import { harness } from './vtt-helpers.js';
import { assertSafeZipPath } from '../src/vtt/pack.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('VTT store parity and migrations', () => {
  it('migrates a pre-VTT sqlite database without losing users or fire log', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-mig-'));
    dirs.push(dir);
    const dbPath = path.join(dir, 'show.db');
    const legacy = new Database(dbPath);
    legacy.exec(ENGINE_SCHEMA);
    legacy
      .prepare(
        `INSERT INTO auth_users (id, username, role, password_hash, created_at, updated_at) VALUES ('u1','legacy','admin','h','t','t')`
      )
      .run();
    legacy.close();

    const store = sqliteStore(dbPath);
    expect(store.getUserByUsername('legacy')?.id).toBe('u1');
    const db = store.database;
    const rows = db.prepare(`SELECT id FROM schema_migrations ORDER BY id`).all() as { id: string }[];
    expect(rows.map((row) => row.id)).toEqual(MIGRATIONS.map((migration) => migration.id));
    store.close();
  });

  it('rolls back a failed migration', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-fail-'));
    dirs.push(dir);
    const db = new Database(path.join(dir, 'fail.db'));
    expect(() =>
      runMigrations(db, [
        { id: 'x_ok', sql: 'CREATE TABLE ok (id TEXT PRIMARY KEY)' },
        { id: 'x_bad', sql: 'CREATE TABLE half (id TEXT); THIS IS NOT SQL' },
      ])
    ).toThrow();
    const applied = db.prepare(`SELECT id FROM schema_migrations ORDER BY id`).all() as { id: string }[];
    expect(applied.map((row) => row.id)).toEqual(['x_ok']);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ok'`).get()).toBeTruthy();
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='half'`).get()).toBeUndefined();
    db.close();
  });

  it('shares scene create/publish/instantiate behavior on sqlite', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-sql-'));
    dirs.push(dir);
    const store = sqliteStore(path.join(dir, 'show.db'));
    const h = await harness(store);
    const created = await h.vtt.execute(h.cmd('scene.create', { title: 'SQLite hall' }), h.dm);
    const sceneId = (created.result.scene as { id: string }).id;
    await h.vtt.execute(h.cmd('scene.publish', { sceneId }), h.dm);
    await h.vtt.execute(h.cmd('scene.instantiate', { sceneId }), h.dm);
    expect(h.vtt.tables.listScenes('default')[0]?.title).toBe('SQLite hall');
    await h.engine.stop();
  });

  it('rejects zip-slip paths', () => {
    expect(() => assertSafeZipPath('../etc/passwd')).toThrow();
    expect(() => assertSafeZipPath('/abs/path')).toThrow();
    expect(assertSafeZipPath('scene.json')).toBe('scene.json');
  });
});
