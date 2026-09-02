export const VTT_SCHEMA = `
CREATE TABLE IF NOT EXISTS vtt_assets (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  variants_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS vtt_scenes (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  draft_json TEXT NOT NULL,
  published_revision_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vtt_revisions (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  document_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  UNIQUE(scene_id, rev)
);

CREATE TABLE IF NOT EXISTS vtt_instances (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  status TEXT NOT NULL,
  state_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_event_sequence INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vtt_encounters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  document_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vtt_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vtt_rundown (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  state TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  expected_duration_ms INTEGER,
  scene_id TEXT,
  preset_id TEXT,
  cue_name TEXT,
  poll_id TEXT,
  handout_id TEXT,
  started_at TEXT,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS vtt_handouts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  asset_id TEXT,
  visibility TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vtt_handout_grants (
  handout_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  PRIMARY KEY (handout_id, player_id)
);

CREATE TABLE IF NOT EXISTS vtt_notes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  author_id TEXT,
  scene_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vtt_webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  events_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vtt_webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vtt_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  label TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS vtt_markers (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  label TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vtt_clients (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  viewer TEXT NOT NULL,
  user_id TEXT,
  last_seen TEXT NOT NULL
);
`;
