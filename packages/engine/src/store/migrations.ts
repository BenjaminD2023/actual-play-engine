import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ENGINE_SCHEMA } from './schema.js';
import { VTT_SCHEMA } from '../vtt/schema.js';

export interface Migration {
  id: string;
  sql: string;
}

export interface MigrationReport {
  applied: string[];
  already: string[];
  checksums: Record<string, string>;
}

export const FOUNDATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  rotated_from TEXT,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE IF NOT EXISTS scoped_tokens (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  session_id TEXT,
  capabilities TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS durable_commands (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  actor_id TEXT,
  source TEXT NOT NULL,
  session_id TEXT NOT NULL,
  aggregate_type TEXT,
  aggregate_id TEXT,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS durable_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  protocol_version INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_version INTEGER NOT NULL,
  type TEXT NOT NULL,
  actor_id TEXT,
  source TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  command_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_durable_events_session ON durable_events(session_id, sequence);
`;

export const MIGRATIONS: Migration[] = [
  { id: '001_baseline', sql: ENGINE_SCHEMA },
  { id: '002_foundation', sql: FOUNDATION_SCHEMA },
  { id: '003_vtt', sql: VTT_SCHEMA },
];

export function checksumSql(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export function runMigrations(db: Database.Database): MigrationReport {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const existing = db.prepare(`SELECT id, checksum FROM schema_migrations`).all() as { id: string; checksum: string }[];
  const applied = new Set(existing.map((row) => row.id));
  const hasCampaigns = Boolean(
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'campaigns'`).get()
  );

  const report: MigrationReport = { applied: [], already: [...applied], checksums: {} };

  if (hasCampaigns && !applied.has('001_baseline')) {
    const checksum = checksumSql(ENGINE_SCHEMA);
    db.prepare(`INSERT INTO schema_migrations (id, checksum, applied_at) VALUES (?, ?, ?)`).run(
      '001_baseline',
      checksum,
      new Date().toISOString()
    );
    applied.add('001_baseline');
    report.already.push('001_baseline');
    report.checksums['001_baseline'] = checksum;
  }

  for (const migration of MIGRATIONS) {
    const checksum = checksumSql(migration.sql);
    report.checksums[migration.id] = checksum;
    if (applied.has(migration.id)) continue;
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(`INSERT INTO schema_migrations (id, checksum, applied_at) VALUES (?, ?, ?)`).run(
        migration.id,
        checksum,
        new Date().toISOString()
      );
    });
    apply();
    report.applied.push(migration.id);
    applied.add(migration.id);
  }
  return report;
}

export function migrationStatus(db: Database.Database): { id: string; checksum: string; applied_at: string }[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  return db.prepare(`SELECT id, checksum, applied_at FROM schema_migrations ORDER BY id`).all() as {
    id: string;
    checksum: string;
    applied_at: string;
  }[];
}
