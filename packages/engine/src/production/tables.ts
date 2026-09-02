import type Database from 'better-sqlite3';
import { createId, nowIso } from '../ids.js';
import { runMigrations } from '../store/migrations.js';
import type {
  ActionRun,
  ActorBinding,
  CueBinding,
  DeploymentRecord,
  PackedAsset,
  ProductionProject,
  ProductionVariable,
  RevisionRow,
} from './types.js';

export interface SceneMapRow {
  packSceneId: string;
  vttSceneId: string;
  vttInstanceId: string | null;
}

export interface ProductionTables {
  putRevision(row: RevisionRow): RevisionRow;
  getRevision(id: string): RevisionRow | null;
  getRevisionByChecksum(checksum: string): RevisionRow | null;
  listRevisions(): RevisionRow[];
  putDeployment(row: DeploymentRecord): DeploymentRecord;
  getDeployment(id: string): DeploymentRecord | null;
  listDeployments(sessionId?: string): DeploymentRecord[];
  putCueBinding(deploymentId: string, binding: CueBinding): CueBinding;
  listCueBindings(deploymentId: string): CueBinding[];
  putActorBinding(deploymentId: string, binding: ActorBinding): ActorBinding;
  listActorBindings(deploymentId: string): ActorBinding[];
  setVariables(deploymentId: string, values: Record<string, boolean | number | string>): void;
  getVariables(deploymentId: string): Record<string, boolean | number | string>;
  putSceneMap(deploymentId: string, row: SceneMapRow): void;
  listSceneMaps(deploymentId: string): SceneMapRow[];
  putIdMap(deploymentId: string, kind: string, packId: string, vttId: string): void;
  getIdMap(deploymentId: string, kind: string, packId: string): string | null;
  putRun(row: ActionRun): ActionRun;
  getRun(id: string): ActionRun | null;
  listRuns(deploymentId: string): ActionRun[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cloneRevision(row: RevisionRow): RevisionRow {
  return {
    ...clone({ ...row, assets: [] }),
    assets: row.assets.map((asset) => ({ ...asset, data: Buffer.from(asset.data) })),
  };
}

export class MemoryProductionTables implements ProductionTables {
  private revisions = new Map<string, RevisionRow>();
  private deployments = new Map<string, DeploymentRecord>();
  private cues = new Map<string, CueBinding[]>();
  private actors = new Map<string, ActorBinding[]>();
  private variables = new Map<string, Record<string, boolean | number | string>>();
  private scenes = new Map<string, SceneMapRow[]>();
  private ids = new Map<string, string>();
  private runs = new Map<string, ActionRun>();

  putRevision(row: RevisionRow): RevisionRow {
    const existing = [...this.revisions.values()].find((item) => item.checksum === row.checksum);
    if (existing) return cloneRevision(existing);
    this.revisions.set(row.id, cloneRevision(row));
    return cloneRevision(row);
  }
  getRevision(id: string): RevisionRow | null {
    const row = this.revisions.get(id);
    return row ? cloneRevision(row) : null;
  }
  getRevisionByChecksum(checksum: string): RevisionRow | null {
    const row = [...this.revisions.values()].find((item) => item.checksum === checksum);
    return row ? cloneRevision(row) : null;
  }
  listRevisions(): RevisionRow[] {
    return [...this.revisions.values()].map(cloneRevision);
  }
  putDeployment(row: DeploymentRecord): DeploymentRecord {
    const next = clone(row);
    this.deployments.set(row.id, next);
    this.cues.set(row.id, clone(row.cueBindings));
    this.actors.set(row.id, clone(row.actorBindings));
    return this.getDeployment(row.id)!;
  }
  getDeployment(id: string): DeploymentRecord | null {
    const row = this.deployments.get(id);
    if (!row) return null;
    return {
      ...clone(row),
      cueBindings: clone(this.cues.get(id) ?? row.cueBindings),
      actorBindings: clone(this.actors.get(id) ?? row.actorBindings),
    };
  }
  listDeployments(sessionId?: string): DeploymentRecord[] {
    return [...this.deployments.values()]
      .filter((row) => !sessionId || row.sessionId === sessionId)
      .map((row) => this.getDeployment(row.id)!)
      .filter(Boolean);
  }
  putCueBinding(deploymentId: string, binding: CueBinding): CueBinding {
    const list = this.cues.get(deploymentId) ?? [];
    const next = [...list.filter((item) => item.slotId !== binding.slotId), clone(binding)];
    this.cues.set(deploymentId, next);
    const deployment = this.deployments.get(deploymentId);
    if (deployment) deployment.cueBindings = next;
    return clone(binding);
  }
  listCueBindings(deploymentId: string): CueBinding[] {
    return clone(this.cues.get(deploymentId) ?? []);
  }
  putActorBinding(deploymentId: string, binding: ActorBinding): ActorBinding {
    const list = this.actors.get(deploymentId) ?? [];
    const next = [...list.filter((item) => item.actorId !== binding.actorId), clone(binding)];
    this.actors.set(deploymentId, next);
    const deployment = this.deployments.get(deploymentId);
    if (deployment) deployment.actorBindings = next;
    return clone(binding);
  }
  listActorBindings(deploymentId: string): ActorBinding[] {
    return clone(this.actors.get(deploymentId) ?? []);
  }
  setVariables(deploymentId: string, values: Record<string, boolean | number | string>): void {
    this.variables.set(deploymentId, { ...values });
  }
  getVariables(deploymentId: string): Record<string, boolean | number | string> {
    return { ...(this.variables.get(deploymentId) ?? {}) };
  }
  putSceneMap(deploymentId: string, row: SceneMapRow): void {
    const list = this.scenes.get(deploymentId) ?? [];
    this.scenes.set(deploymentId, [...list.filter((item) => item.packSceneId !== row.packSceneId), { ...row }]);
  }
  listSceneMaps(deploymentId: string): SceneMapRow[] {
    return [...(this.scenes.get(deploymentId) ?? [])].map((row) => ({ ...row }));
  }
  putIdMap(deploymentId: string, kind: string, packId: string, vttId: string): void {
    this.ids.set(`${deploymentId}:${kind}:${packId}`, vttId);
  }
  getIdMap(deploymentId: string, kind: string, packId: string): string | null {
    return this.ids.get(`${deploymentId}:${kind}:${packId}`) ?? null;
  }
  putRun(row: ActionRun): ActionRun {
    this.runs.set(row.id, clone(row));
    return clone(row);
  }
  getRun(id: string): ActionRun | null {
    const row = this.runs.get(id);
    return row ? clone(row) : null;
  }
  listRuns(deploymentId: string): ActionRun[] {
    return [...this.runs.values()].filter((row) => row.deploymentId === deploymentId).map(clone);
  }
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

export class SqliteProductionTables implements ProductionTables {
  constructor(private readonly db: Database.Database) {
    runMigrations(db);
  }

  putRevision(row: RevisionRow): RevisionRow {
    const existing = this.getRevisionByChecksum(row.checksum);
    if (existing) return existing;
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO production_revisions (id, project_id, title, author, checksum, manifest_json, project_json, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          row.id,
          row.projectId,
          row.title,
          row.author,
          row.checksum,
          JSON.stringify(row.manifest),
          JSON.stringify(row.project),
          row.createdAt,
          row.createdBy
        );
      const assetStmt = this.db.prepare(
        `INSERT INTO production_revision_assets (revision_id, asset_id, hash, mime, original_name, byte_size, role, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const asset of row.assets) {
        assetStmt.run(row.id, asset.id, asset.hash, asset.mime, asset.originalName, asset.byteSize, asset.role, asset.data);
      }
    });
    insert();
    return this.getRevision(row.id)!;
  }
  getRevision(id: string): RevisionRow | null {
    const row = this.db.prepare(`SELECT * FROM production_revisions WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRevision(row) : null;
  }
  getRevisionByChecksum(checksum: string): RevisionRow | null {
    const row = this.db.prepare(`SELECT * FROM production_revisions WHERE checksum = ?`).get(checksum) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapRevision(row) : null;
  }
  listRevisions(): RevisionRow[] {
    return (this.db.prepare(`SELECT * FROM production_revisions ORDER BY created_at`).all() as Record<string, unknown>[]).map(
      (row) => this.mapRevision(row)
    );
  }
  private mapRevision(row: Record<string, unknown>): RevisionRow {
    const id = String(row.id);
    const assets = (
      this.db.prepare(`SELECT * FROM production_revision_assets WHERE revision_id = ?`).all(id) as Record<string, unknown>[]
    ).map((asset) => ({
      id: String(asset.asset_id),
      hash: String(asset.hash),
      mime: String(asset.mime),
      originalName: String(asset.original_name),
      byteSize: Number(asset.byte_size),
      role: asset.role as PackedAsset['role'],
      data: Buffer.from(asset.data as Buffer),
    }));
    return {
      id,
      projectId: String(row.project_id),
      title: String(row.title),
      author: String(row.author),
      checksum: String(row.checksum),
      manifest: parseJson(String(row.manifest_json)),
      project: parseJson(String(row.project_json)) as ProductionProject,
      assets,
      createdAt: String(row.created_at),
      createdBy: (row.created_by as string | null) ?? null,
    };
  }

  putDeployment(row: DeploymentRecord): DeploymentRecord {
    this.db
      .prepare(
        `INSERT INTO production_deployments (id, package_revision_id, session_id, status, published, dm_user_ids_json, previous_deployment_id, created_at, updated_at, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status=excluded.status,
           published=excluded.published,
           dm_user_ids_json=excluded.dm_user_ids_json,
           previous_deployment_id=excluded.previous_deployment_id,
           updated_at=excluded.updated_at,
           published_at=excluded.published_at`
      )
      .run(
        row.id,
        row.packageRevisionId,
        row.sessionId,
        row.status,
        row.published ? 1 : 0,
        JSON.stringify(row.dmUserIds),
        row.previousDeploymentId ?? null,
        row.createdAt ?? nowIso(),
        row.updatedAt ?? nowIso(),
        row.publishedAt ?? null
      );
    return this.getDeployment(row.id)!;
  }
  getDeployment(id: string): DeploymentRecord | null {
    const row = this.db.prepare(`SELECT * FROM production_deployments WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapDeployment(row) : null;
  }
  listDeployments(sessionId?: string): DeploymentRecord[] {
    const rows = sessionId
      ? (this.db.prepare(`SELECT * FROM production_deployments WHERE session_id = ?`).all(sessionId) as Record<string, unknown>[])
      : (this.db.prepare(`SELECT * FROM production_deployments`).all() as Record<string, unknown>[]);
    return rows.map((row) => this.mapDeployment(row));
  }
  private mapDeployment(row: Record<string, unknown>): DeploymentRecord {
    const id = String(row.id);
    return {
      id,
      packageRevisionId: String(row.package_revision_id),
      sessionId: String(row.session_id),
      status: row.status as DeploymentRecord['status'],
      published: Boolean(row.published),
      dmUserIds: parseJson(String(row.dm_user_ids_json)),
      previousDeploymentId: (row.previous_deployment_id as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      publishedAt: (row.published_at as string | null) ?? null,
      cueBindings: this.listCueBindings(id),
      actorBindings: this.listActorBindings(id),
    };
  }

  putCueBinding(deploymentId: string, binding: CueBinding): CueBinding {
    this.db
      .prepare(
        `INSERT INTO production_cue_bindings (deployment_id, slot_id, kind, cue_name, cue_number, osc_template_id, tested, last_result, accepted_warning)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(deployment_id, slot_id) DO UPDATE SET
           kind=excluded.kind, cue_name=excluded.cue_name, cue_number=excluded.cue_number,
           osc_template_id=excluded.osc_template_id, tested=excluded.tested, last_result=excluded.last_result,
           accepted_warning=excluded.accepted_warning`
      )
      .run(
        deploymentId,
        binding.slotId,
        binding.kind,
        binding.cueName,
        binding.cueNumber,
        binding.oscTemplateId,
        binding.tested ? 1 : 0,
        binding.lastResult,
        binding.acceptedWarning
      );
    return binding;
  }
  listCueBindings(deploymentId: string): CueBinding[] {
    return (
      this.db.prepare(`SELECT * FROM production_cue_bindings WHERE deployment_id = ?`).all(deploymentId) as Record<string, unknown>[]
    ).map((row) => ({
      slotId: String(row.slot_id),
      kind: row.kind as CueBinding['kind'],
      cueName: (row.cue_name as string | null) ?? null,
      cueNumber: (row.cue_number as string | null) ?? null,
      oscTemplateId: (row.osc_template_id as string | null) ?? null,
      tested: Boolean(row.tested),
      lastResult: (row.last_result as CueBinding['lastResult']) ?? null,
      acceptedWarning: (row.accepted_warning as string | null) ?? null,
    }));
  }

  putActorBinding(deploymentId: string, binding: ActorBinding): ActorBinding {
    this.db
      .prepare(
        `INSERT INTO production_actor_bindings (deployment_id, actor_id, player_id, user_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(deployment_id, actor_id) DO UPDATE SET player_id=excluded.player_id, user_id=excluded.user_id`
      )
      .run(deploymentId, binding.actorId, binding.playerId, binding.userId);
    return binding;
  }
  listActorBindings(deploymentId: string): ActorBinding[] {
    return (
      this.db.prepare(`SELECT * FROM production_actor_bindings WHERE deployment_id = ?`).all(deploymentId) as Record<
        string,
        unknown
      >[]
    ).map((row) => ({
      actorId: String(row.actor_id),
      playerId: (row.player_id as string | null) ?? null,
      userId: (row.user_id as string | null) ?? null,
    }));
  }

  setVariables(deploymentId: string, values: Record<string, boolean | number | string>): void {
    const stmt = this.db.prepare(
      `INSERT INTO production_variables (deployment_id, variable_id, value_json) VALUES (?, ?, ?)
       ON CONFLICT(deployment_id, variable_id) DO UPDATE SET value_json=excluded.value_json`
    );
    const tx = this.db.transaction(() => {
      for (const [variableId, value] of Object.entries(values)) {
        stmt.run(deploymentId, variableId, JSON.stringify(value));
      }
    });
    tx();
  }
  getVariables(deploymentId: string): Record<string, boolean | number | string> {
    const out: Record<string, boolean | number | string> = {};
    for (const row of this.db.prepare(`SELECT variable_id, value_json FROM production_variables WHERE deployment_id = ?`).all(
      deploymentId
    ) as { variable_id: string; value_json: string }[]) {
      out[row.variable_id] = parseJson(row.value_json);
    }
    return out;
  }

  putSceneMap(deploymentId: string, row: SceneMapRow): void {
    this.db
      .prepare(
        `INSERT INTO production_scene_maps (deployment_id, pack_scene_id, vtt_scene_id, vtt_instance_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(deployment_id, pack_scene_id) DO UPDATE SET vtt_scene_id=excluded.vtt_scene_id, vtt_instance_id=excluded.vtt_instance_id`
      )
      .run(deploymentId, row.packSceneId, row.vttSceneId, row.vttInstanceId);
  }
  listSceneMaps(deploymentId: string): SceneMapRow[] {
    return (
      this.db.prepare(`SELECT * FROM production_scene_maps WHERE deployment_id = ?`).all(deploymentId) as Record<string, unknown>[]
    ).map((row) => ({
      packSceneId: String(row.pack_scene_id),
      vttSceneId: String(row.vtt_scene_id),
      vttInstanceId: (row.vtt_instance_id as string | null) ?? null,
    }));
  }

  putIdMap(deploymentId: string, kind: string, packId: string, vttId: string): void {
    this.db
      .prepare(
        `INSERT INTO production_id_maps (deployment_id, kind, pack_id, vtt_id) VALUES (?, ?, ?, ?)
         ON CONFLICT(deployment_id, kind, pack_id) DO UPDATE SET vtt_id=excluded.vtt_id`
      )
      .run(deploymentId, kind, packId, vttId);
  }
  getIdMap(deploymentId: string, kind: string, packId: string): string | null {
    const row = this.db
      .prepare(`SELECT vtt_id FROM production_id_maps WHERE deployment_id = ? AND kind = ? AND pack_id = ?`)
      .get(deploymentId, kind, packId) as { vtt_id: string } | undefined;
    return row?.vtt_id ?? null;
  }

  putRun(row: ActionRun): ActionRun {
    this.db
      .prepare(
        `INSERT INTO production_runs (id, deployment_id, action_id, actor_id, started_at, ended_at, steps_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET ended_at=excluded.ended_at, steps_json=excluded.steps_json`
      )
      .run(row.id, row.deploymentId, row.actionId, row.actorId, row.startedAt, row.endedAt, JSON.stringify(row.steps));
    return row;
  }
  getRun(id: string): ActionRun | null {
    const row = this.db.prepare(`SELECT * FROM production_runs WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      deploymentId: String(row.deployment_id),
      actionId: String(row.action_id),
      actorId: (row.actor_id as string | null) ?? null,
      startedAt: String(row.started_at),
      endedAt: (row.ended_at as string | null) ?? null,
      steps: parseJson(String(row.steps_json)),
    };
  }
  listRuns(deploymentId: string): ActionRun[] {
    return (this.db.prepare(`SELECT id FROM production_runs WHERE deployment_id = ?`).all(deploymentId) as { id: string }[])
      .map((row) => this.getRun(row.id)!)
      .filter(Boolean);
  }
}

export function seedVariables(vars: ProductionVariable[]): Record<string, boolean | number | string> {
  const out: Record<string, boolean | number | string> = {};
  for (const variable of vars) out[variable.id] = variable.defaultValue;
  return out;
}

export function newDeploymentId(): string {
  return createId();
}
