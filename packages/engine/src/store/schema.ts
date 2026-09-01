export const ENGINE_SCHEMA = `
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'dm', 'player', 'audience')),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL DEFAULT 'default',
  session_name TEXT DEFAULT '',
  session_number INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_sessions_single_active
  ON game_sessions(is_active) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS game_state (
  session_id TEXT PRIMARY KEY,
  version INTEGER DEFAULT 1 NOT NULL,
  current_turn INTEGER DEFAULT 0,
  round_number INTEGER DEFAULT 1,
  combat_mode INTEGER DEFAULT 0,
  global_announcement TEXT DEFAULT '',
  camera_visible INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  auth_user_id TEXT,
  session_id TEXT NOT NULL,
  character_name TEXT NOT NULL DEFAULT '',
  character_class TEXT DEFAULT '',
  character_level INTEGER DEFAULT 1,
  armor_class INTEGER DEFAULT 10,
  current_hp INTEGER DEFAULT 10,
  max_hp INTEGER DEFAULT 10,
  temp_hp INTEGER DEFAULT 0,
  version INTEGER DEFAULT 1 NOT NULL,
  spell_slots_level_1 INTEGER DEFAULT 0,
  spell_slots_level_2 INTEGER DEFAULT 0,
  spell_slots_level_3 INTEGER DEFAULT 0,
  spell_slots_level_4 INTEGER DEFAULT 0,
  spell_slots_level_5 INTEGER DEFAULT 0,
  spell_slots_level_6 INTEGER DEFAULT 0,
  spell_slots_level_7 INTEGER DEFAULT 0,
  spell_slots_level_8 INTEGER DEFAULT 0,
  spell_slots_level_9 INTEGER DEFAULT 0,
  inspiration_tokens INTEGER DEFAULT 0,
  portrait_url TEXT DEFAULT '',
  audience_tags TEXT DEFAULT '[]',
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player_actions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  cue_name TEXT DEFAULT '',
  cue_number TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  is_enabled INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS virtual_buttons (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT '',
  color TEXT DEFAULT '#3b82f6',
  action_type TEXT NOT NULL DEFAULT 'qlab_cue',
  action_data TEXT DEFAULT '{}',
  key_bind TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS midi_keybinds (
  id TEXT PRIMARY KEY,
  midi_type TEXT NOT NULL DEFAULT 'note_on',
  midi_channel INTEGER NOT NULL DEFAULT 0,
  midi_data1 INTEGER NOT NULL,
  midi_data2 INTEGER NOT NULL DEFAULT 0,
  action_type TEXT NOT NULL DEFAULT 'qlab_cue',
  action_data TEXT DEFAULT '{}',
  label TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS initiative_prompts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  show_results INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS initiatives (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  participant_type TEXT NOT NULL DEFAULT 'player',
  participant_name TEXT NOT NULL DEFAULT '',
  initiative_result INTEGER DEFAULT 0,
  initiative_modifier INTEGER DEFAULT 0,
  initiative_total INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  is_ready INTEGER DEFAULT 0,
  is_boss INTEGER DEFAULT 0,
  boss_damage_taken INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  question TEXT NOT NULL DEFAULT '',
  is_active INTEGER DEFAULT 1,
  show_results INTEGER DEFAULT 0,
  countdown_enabled INTEGER DEFAULT 1,
  countdown_duration_seconds INTEGER DEFAULT 10,
  results_duration_seconds INTEGER DEFAULT 10,
  results_shown_at TEXT,
  poll_type TEXT DEFAULT 'standard',
  display_visibility TEXT DEFAULT 'public',
  total_votes INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS poll_options (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL,
  option_text TEXT NOT NULL DEFAULT '',
  option_order INTEGER DEFAULT 0,
  vote_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS votes (
  poll_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (poll_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS fire_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  command_id TEXT NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  actor_id TEXT,
  cue_name TEXT,
  cue_number TEXT,
  address TEXT,
  status TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS app_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  qlab_host TEXT DEFAULT '127.0.0.1',
  qlab_port INTEGER DEFAULT 53000,
  qlab_workspace_id TEXT,
  qlab_passcode TEXT,
  show_cues TEXT DEFAULT '{}',
  midi_enabled INTEGER DEFAULT 1,
  bridge_token_hash TEXT,
  bridge_token_created_at TEXT,
  updated_at TEXT
);

INSERT OR IGNORE INTO app_config (id) VALUES ('default');
INSERT OR IGNORE INTO campaigns (id, name, is_active) VALUES ('default', 'Campaign', 1);
`;
