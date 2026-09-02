export const PRODUCTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS production_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  checksum TEXT NOT NULL UNIQUE,
  manifest_json TEXT NOT NULL,
  project_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_production_revisions_project ON production_revisions(project_id);

CREATE TABLE IF NOT EXISTS production_revision_assets (
  revision_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  mime TEXT NOT NULL,
  original_name TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  role TEXT NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (revision_id, asset_id)
);

CREATE TABLE IF NOT EXISTS production_deployments (
  id TEXT PRIMARY KEY,
  package_revision_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  dm_user_ids_json TEXT NOT NULL DEFAULT '[]',
  previous_deployment_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_production_deployments_session ON production_deployments(session_id);

CREATE TABLE IF NOT EXISTS production_cue_bindings (
  deployment_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  cue_name TEXT,
  cue_number TEXT,
  osc_template_id TEXT,
  tested INTEGER NOT NULL DEFAULT 0,
  last_result TEXT,
  accepted_warning TEXT,
  PRIMARY KEY (deployment_id, slot_id)
);

CREATE TABLE IF NOT EXISTS production_actor_bindings (
  deployment_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  player_id TEXT,
  user_id TEXT,
  PRIMARY KEY (deployment_id, actor_id)
);

CREATE TABLE IF NOT EXISTS production_variables (
  deployment_id TEXT NOT NULL,
  variable_id TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (deployment_id, variable_id)
);

CREATE TABLE IF NOT EXISTS production_scene_maps (
  deployment_id TEXT NOT NULL,
  pack_scene_id TEXT NOT NULL,
  vtt_scene_id TEXT NOT NULL,
  vtt_instance_id TEXT,
  PRIMARY KEY (deployment_id, pack_scene_id)
);

CREATE TABLE IF NOT EXISTS production_id_maps (
  deployment_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  vtt_id TEXT NOT NULL,
  PRIMARY KEY (deployment_id, kind, pack_id)
);

CREATE TABLE IF NOT EXISTS production_runs (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  actor_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  steps_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_production_runs_deployment ON production_runs(deployment_id);
`;
