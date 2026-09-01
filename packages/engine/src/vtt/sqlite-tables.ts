import type Database from 'better-sqlite3';
import type { AssetMetadata, DurableEvent } from '@actualplay/protocol';
import { PROTOCOL_VERSION } from '@actualplay/protocol';
import { createId, nowIso } from '../ids.js';
import { runMigrations } from '../store/migrations.js';
import type {
  AuthSessionRecord,
  CheckpointRow,
  DurableCommandRecord,
  EncounterRow,
  HandoutRow,
  InstanceRow,
  NoteRow,
  PresetRow,
  RevisionRow,
  RundownRow,
  SceneRow,
  ScopedTokenRecord,
  VttTables,
  WebhookRow,
} from './tables.js';

function parse<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

export class SqliteVttTables implements VttTables {
  constructor(private readonly db: Database.Database) {
    runMigrations(db);
  }

  createAuthSession(row: AuthSessionRecord): AuthSessionRecord {
    this.db
      .prepare(
        `INSERT INTO auth_sessions (id, user_id, created_at, expires_at, revoked_at, rotated_from, user_agent, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(row.id, row.user_id, row.created_at, row.expires_at, row.revoked_at, row.rotated_from, row.user_agent, row.ip);
    return row;
  }
  getAuthSession(id: string): AuthSessionRecord | null {
    const row = this.db.prepare(`SELECT * FROM auth_sessions WHERE id = ?`).get(id) as AuthSessionRecord | undefined;
    return row ?? null;
  }
  revokeAuthSession(id: string): void {
    this.db.prepare(`UPDATE auth_sessions SET revoked_at = ? WHERE id = ?`).run(nowIso(), id);
  }

  createScopedToken(row: ScopedTokenRecord): ScopedTokenRecord {
    this.db
      .prepare(
        `INSERT INTO scoped_tokens (id, kind, token_hash, label, session_id, capabilities, expires_at, revoked_at, created_by, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.kind,
        row.token_hash,
        row.label,
        row.session_id,
        JSON.stringify(row.capabilities),
        row.expires_at,
        row.revoked_at,
        row.created_by,
        row.created_at,
        row.last_used_at
      );
    return row;
  }
  getScopedTokenByHash(hash: string): ScopedTokenRecord | null {
    const row = this.db.prepare(`SELECT * FROM scoped_tokens WHERE token_hash = ? AND revoked_at IS NULL`).get(hash) as
      | (Omit<ScopedTokenRecord, 'capabilities'> & { capabilities: string })
      | undefined;
    if (!row) return null;
    return { ...row, capabilities: parse(row.capabilities) };
  }
  revokeScopedToken(id: string): void {
    this.db.prepare(`UPDATE scoped_tokens SET revoked_at = ? WHERE id = ?`).run(nowIso(), id);
  }
  touchScopedToken(id: string): void {
    this.db.prepare(`UPDATE scoped_tokens SET last_used_at = ? WHERE id = ?`).run(nowIso(), id);
  }

  putDurableCommand(row: DurableCommandRecord): void {
    this.db
      .prepare(
        `INSERT INTO durable_commands (id, type, actor_id, source, session_id, aggregate_type, aggregate_id, request_hash, result_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`
      )
      .run(
        row.id,
        row.type,
        row.actor_id,
        row.source,
        row.session_id,
        row.aggregate_type,
        row.aggregate_id,
        row.request_hash,
        row.result_json,
        row.status,
        row.created_at
      );
  }
  getDurableCommand(id: string): DurableCommandRecord | null {
    return (this.db.prepare(`SELECT * FROM durable_commands WHERE id = ?`).get(id) as DurableCommandRecord | undefined) ?? null;
  }

  appendEvent(event: Omit<DurableEvent, 'sequence'>): DurableEvent {
    const info = this.db
      .prepare(
        `INSERT INTO durable_events (protocol_version, session_id, aggregate_type, aggregate_id, aggregate_version, type, actor_id, source, payload_json, timestamp, command_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.protocolVersion ?? PROTOCOL_VERSION,
        event.sessionId,
        event.aggregateType,
        event.aggregateId,
        event.aggregateVersion,
        event.type,
        event.actorId,
        event.source,
        JSON.stringify(event.payload),
        event.timestamp,
        event.commandId
      );
    return { ...event, sequence: Number(info.lastInsertRowid) };
  }
  listEvents(sessionId: string, after: number, limit = 500): DurableEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM durable_events WHERE session_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?`
      )
      .all(sessionId, after, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      sequence: Number(row.sequence),
      protocolVersion: Number(row.protocol_version),
      sessionId: String(row.session_id),
      aggregateType: String(row.aggregate_type),
      aggregateId: String(row.aggregate_id),
      aggregateVersion: Number(row.aggregate_version),
      type: row.type as DurableEvent['type'],
      actorId: (row.actor_id as string | null) ?? null,
      source: String(row.source),
      payload: parse(String(row.payload_json)),
      timestamp: String(row.timestamp),
      commandId: String(row.command_id),
    }));
  }
  lastSequence(sessionId: string): number {
    const row = this.db.prepare(`SELECT MAX(sequence) as m FROM durable_events WHERE session_id = ?`).get(sessionId) as { m: number | null };
    return row.m ?? 0;
  }

  putAsset(asset: AssetMetadata): AssetMetadata {
    this.db
      .prepare(
        `INSERT INTO vtt_assets (id, hash, mime, byte_size, original_name, width, height, duration_ms, variants_json, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET variants_json = excluded.variants_json`
      )
      .run(
        asset.id,
        asset.hash,
        asset.mime,
        asset.byteSize,
        asset.originalName,
        asset.width,
        asset.height,
        asset.durationMs,
        JSON.stringify(asset.variants),
        asset.createdAt,
        asset.createdBy
      );
    return asset;
  }
  getAsset(id: string): AssetMetadata | null {
    const row = this.db.prepare(`SELECT * FROM vtt_assets WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapAsset(row) : null;
  }
  getAssetByHash(hash: string): AssetMetadata | null {
    const row = this.db.prepare(`SELECT * FROM vtt_assets WHERE hash = ?`).get(hash) as Record<string, unknown> | undefined;
    return row ? this.mapAsset(row) : null;
  }
  listAssets(): AssetMetadata[] {
    return (this.db.prepare(`SELECT * FROM vtt_assets`).all() as Record<string, unknown>[]).map((row) => this.mapAsset(row));
  }
  private mapAsset(row: Record<string, unknown>): AssetMetadata {
    return {
      id: String(row.id),
      hash: String(row.hash),
      mime: String(row.mime),
      byteSize: Number(row.byte_size),
      originalName: String(row.original_name),
      width: row.width === null || row.width === undefined ? null : Number(row.width),
      height: row.height === null || row.height === undefined ? null : Number(row.height),
      durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
      variants: parse(String(row.variants_json)),
      createdAt: String(row.created_at),
      createdBy: (row.created_by as string | null) ?? null,
    };
  }

  putScene(row: SceneRow): SceneRow {
    this.db
      .prepare(
        `INSERT INTO vtt_scenes (id, campaign_id, title, status, draft_json, published_revision_id, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, status=excluded.status, draft_json=excluded.draft_json,
           published_revision_id=excluded.published_revision_id, version=excluded.version, updated_at=excluded.updated_at`
      )
      .run(row.id, row.campaign_id, row.title, row.status, JSON.stringify(row.draft), row.published_revision_id, row.version, row.created_at, row.updated_at);
    return row;
  }
  getScene(id: string): SceneRow | null {
    const row = this.db.prepare(`SELECT * FROM vtt_scenes WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapScene(row) : null;
  }
  listScenes(campaignId: string): SceneRow[] {
    return (this.db.prepare(`SELECT * FROM vtt_scenes WHERE campaign_id = ?`).all(campaignId) as Record<string, unknown>[]).map((row) => this.mapScene(row));
  }
  private mapScene(row: Record<string, unknown>): SceneRow {
    return {
      id: String(row.id),
      campaign_id: String(row.campaign_id),
      title: String(row.title),
      status: row.status as SceneRow['status'],
      draft: parse(String(row.draft_json)),
      published_revision_id: (row.published_revision_id as string | null) ?? null,
      version: Number(row.version),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }

  putRevision(row: RevisionRow): RevisionRow {
    this.db
      .prepare(
        `INSERT INTO vtt_revisions (id, scene_id, rev, document_json, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(row.id, row.scene_id, row.rev, JSON.stringify(row.document), row.created_at, row.created_by);
    return row;
  }
  getRevision(id: string): RevisionRow | null {
    const row = this.db.prepare(`SELECT * FROM vtt_revisions WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      scene_id: String(row.scene_id),
      rev: Number(row.rev),
      document: parse(String(row.document_json)),
      created_at: String(row.created_at),
      created_by: (row.created_by as string | null) ?? null,
    };
  }
  listRevisions(sceneId: string): RevisionRow[] {
    const rows = this.db.prepare(`SELECT * FROM vtt_revisions WHERE scene_id = ? ORDER BY rev`).all(sceneId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      scene_id: String(row.scene_id),
      rev: Number(row.rev),
      document: parse(String(row.document_json)),
      created_at: String(row.created_at),
      created_by: (row.created_by as string | null) ?? null,
    }));
  }

  putInstance(row: InstanceRow): InstanceRow {
    this.db
      .prepare(
        `INSERT INTO vtt_instances (id, session_id, scene_id, revision_id, status, state_json, version, last_event_sequence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status=excluded.status, state_json=excluded.state_json, version=excluded.version,
           last_event_sequence=excluded.last_event_sequence, updated_at=excluded.updated_at`
      )
      .run(
        row.id,
        row.session_id,
        row.scene_id,
        row.revision_id,
        row.status,
        JSON.stringify(row.state),
        row.version,
        row.last_event_sequence,
        row.created_at,
        row.updated_at
      );
    return row;
  }
  getInstance(id: string): InstanceRow | null {
    const row = this.db.prepare(`SELECT * FROM vtt_instances WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapInstance(row) : null;
  }
  listInstances(sessionId: string): InstanceRow[] {
    return (this.db.prepare(`SELECT * FROM vtt_instances WHERE session_id = ?`).all(sessionId) as Record<string, unknown>[]).map((row) => this.mapInstance(row));
  }
  liveInstance(sessionId: string): InstanceRow | null {
    const row = this.db.prepare(`SELECT * FROM vtt_instances WHERE session_id = ? AND status = 'live' LIMIT 1`).get(sessionId) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapInstance(row) : null;
  }
  private mapInstance(row: Record<string, unknown>): InstanceRow {
    return {
      id: String(row.id),
      session_id: String(row.session_id),
      scene_id: String(row.scene_id),
      revision_id: String(row.revision_id),
      status: row.status as InstanceRow['status'],
      state: parse(String(row.state_json)),
      version: Number(row.version),
      last_event_sequence: Number(row.last_event_sequence),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }

  putEncounter(row: EncounterRow): EncounterRow {
    this.db.prepare(`INSERT INTO vtt_encounters (id, name, document_json, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, document_json=excluded.document_json`).run(row.id, row.name, JSON.stringify(row.members), row.created_at);
    return row;
  }
  getEncounter(id: string): EncounterRow | null {
    const row = this.db.prepare(`SELECT * FROM vtt_encounters WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { id: String(row.id), name: String(row.name), members: parse(String(row.document_json)), created_at: String(row.created_at) };
  }
  listEncounters(): EncounterRow[] {
    return (this.db.prepare(`SELECT * FROM vtt_encounters`).all() as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      members: parse(String(row.document_json)),
      created_at: String(row.created_at),
    }));
  }

  putPreset(row: PresetRow): PresetRow {
    this.db.prepare(`INSERT INTO vtt_presets (id, name, steps_json, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, steps_json=excluded.steps_json`).run(row.id, row.name, JSON.stringify(row.steps), row.created_at);
    return row;
  }
  getPreset(id: string): PresetRow | null {
    const row = this.db.prepare(`SELECT * FROM vtt_presets WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { id: String(row.id), name: String(row.name), steps: parse(String(row.steps_json)), created_at: String(row.created_at) };
  }
  listPresets(): PresetRow[] {
    return (this.db.prepare(`SELECT * FROM vtt_presets`).all() as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      steps: parse(String(row.steps_json)),
      created_at: String(row.created_at),
    }));
  }

  putRundown(row: RundownRow): RundownRow {
    this.db
      .prepare(
        `INSERT INTO vtt_rundown (id, session_id, title, sort_order, state, notes, expected_duration_ms, scene_id, preset_id, cue_name, poll_id, handout_id, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, sort_order=excluded.sort_order, state=excluded.state, notes=excluded.notes,
           started_at=excluded.started_at, ended_at=excluded.ended_at`
      )
      .run(
        row.id,
        row.session_id,
        row.title,
        row.sort_order,
        row.state,
        row.notes,
        row.expected_duration_ms,
        row.scene_id,
        row.preset_id,
        row.cue_name,
        row.poll_id,
        row.handout_id,
        row.started_at,
        row.ended_at
      );
    return row;
  }
  listRundown(sessionId: string): RundownRow[] {
    return (this.db.prepare(`SELECT * FROM vtt_rundown WHERE session_id = ? ORDER BY sort_order`).all(sessionId) as Record<string, unknown>[]).map((row) => this.mapRundown(row));
  }
  getRundown(id: string): RundownRow | null {
    const row = this.db.prepare(`SELECT * FROM vtt_rundown WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRundown(row) : null;
  }
  private mapRundown(row: Record<string, unknown>): RundownRow {
    return {
      id: String(row.id),
      session_id: String(row.session_id),
      title: String(row.title),
      sort_order: Number(row.sort_order),
      state: row.state as RundownRow['state'],
      notes: String(row.notes ?? ''),
      expected_duration_ms: row.expected_duration_ms === null || row.expected_duration_ms === undefined ? null : Number(row.expected_duration_ms),
      scene_id: (row.scene_id as string | null) ?? null,
      preset_id: (row.preset_id as string | null) ?? null,
      cue_name: (row.cue_name as string | null) ?? null,
      poll_id: (row.poll_id as string | null) ?? null,
      handout_id: (row.handout_id as string | null) ?? null,
      started_at: (row.started_at as string | null) ?? null,
      ended_at: (row.ended_at as string | null) ?? null,
    };
  }

  putHandout(row: HandoutRow): HandoutRow {
    this.db
      .prepare(
        `INSERT INTO vtt_handouts (id, title, kind, body, asset_id, visibility, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, body=excluded.body, visibility=excluded.visibility, version=excluded.version, updated_at=excluded.updated_at`
      )
      .run(row.id, row.title, row.kind, row.body, row.asset_id, row.visibility, row.version, row.created_at, row.updated_at);
    return row;
  }
  getHandout(id: string): HandoutRow | null {
    const row = this.db.prepare(`SELECT * FROM vtt_handouts WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapHandout(row) : null;
  }
  listHandouts(): HandoutRow[] {
    return (this.db.prepare(`SELECT * FROM vtt_handouts`).all() as Record<string, unknown>[]).map((row) => this.mapHandout(row));
  }
  private mapHandout(row: Record<string, unknown>): HandoutRow {
    return {
      id: String(row.id),
      title: String(row.title),
      kind: row.kind as HandoutRow['kind'],
      body: String(row.body),
      asset_id: (row.asset_id as string | null) ?? null,
      visibility: row.visibility as HandoutRow['visibility'],
      version: Number(row.version),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }
  grantHandout(handoutId: string, playerId: string): void {
    this.db.prepare(`INSERT OR IGNORE INTO vtt_handout_grants (handout_id, player_id) VALUES (?, ?)`).run(handoutId, playerId);
  }
  handoutGrants(handoutId: string): string[] {
    return (this.db.prepare(`SELECT player_id FROM vtt_handout_grants WHERE handout_id = ?`).all(handoutId) as { player_id: string }[]).map((row) => row.player_id);
  }

  putNote(row: NoteRow): NoteRow {
    this.db
      .prepare(
        `INSERT INTO vtt_notes (id, kind, body, author_id, scene_id, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET body=excluded.body, version=excluded.version, updated_at=excluded.updated_at`
      )
      .run(row.id, row.kind, row.body, row.author_id, row.scene_id, row.version, row.updated_at);
    return row;
  }
  getNote(id: string): NoteRow | null {
    const row = this.db.prepare(`SELECT * FROM vtt_notes WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      kind: row.kind as NoteRow['kind'],
      body: String(row.body),
      author_id: (row.author_id as string | null) ?? null,
      scene_id: (row.scene_id as string | null) ?? null,
      version: Number(row.version),
      updated_at: String(row.updated_at),
    };
  }
  listNotes(): NoteRow[] {
    return (this.db.prepare(`SELECT * FROM vtt_notes`).all() as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      kind: row.kind as NoteRow['kind'],
      body: String(row.body),
      author_id: (row.author_id as string | null) ?? null,
      scene_id: (row.scene_id as string | null) ?? null,
      version: Number(row.version),
      updated_at: String(row.updated_at),
    }));
  }

  putWebhook(row: WebhookRow): WebhookRow {
    this.db.prepare(`INSERT INTO vtt_webhooks (id, url, secret_hash, events_json, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      row.id,
      row.url,
      row.secret_hash,
      JSON.stringify({ events: row.events, secret: row.secret ?? '' }),
      row.created_at
    );
    return row;
  }
  listWebhooks(): WebhookRow[] {
    return (this.db.prepare(`SELECT * FROM vtt_webhooks`).all() as Record<string, unknown>[]).map((row) => {
      const parsed = parse<string[] | { events: string[]; secret?: string }>(String(row.events_json));
      const events = Array.isArray(parsed) ? parsed : parsed.events;
      const secret = Array.isArray(parsed) ? '' : parsed.secret ?? '';
      return {
        id: String(row.id),
        url: String(row.url),
        secret_hash: String(row.secret_hash),
        secret,
        events,
        created_at: String(row.created_at),
      };
    });
  }
  recordDelivery(id: string, webhookId: string, eventType: string, status: string, attempts: number, lastError: string | null): void {
    this.db
      .prepare(
        `INSERT INTO vtt_webhook_deliveries (id, webhook_id, event_type, status, attempts, last_error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, webhookId, eventType, status, attempts, lastError, nowIso());
  }
  listDeliveries() {
    return (this.db.prepare(`SELECT * FROM vtt_webhook_deliveries`).all() as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      webhook_id: String(row.webhook_id),
      event_type: String(row.event_type),
      status: String(row.status),
      attempts: Number(row.attempts),
      last_error: (row.last_error as string | null) ?? null,
    }));
  }

  putCheckpoint(row: CheckpointRow): CheckpointRow {
    this.db
      .prepare(
        `INSERT INTO vtt_checkpoints (id, session_id, instance_id, label, state_json, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(row.id, row.session_id, row.instance_id, row.label, JSON.stringify(row.state), row.created_at, row.created_by);
    return row;
  }
  getCheckpoint(id: string): CheckpointRow | null {
    const row = this.db.prepare(`SELECT * FROM vtt_checkpoints WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      session_id: String(row.session_id),
      instance_id: String(row.instance_id),
      label: String(row.label),
      state: parse(String(row.state_json)),
      created_at: String(row.created_at),
      created_by: (row.created_by as string | null) ?? null,
    };
  }
  listCheckpoints(sessionId: string): CheckpointRow[] {
    return (this.db.prepare(`SELECT * FROM vtt_checkpoints WHERE session_id = ?`).all(sessionId) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      session_id: String(row.session_id),
      instance_id: String(row.instance_id),
      label: String(row.label),
      state: parse(String(row.state_json)),
      created_at: String(row.created_at),
      created_by: (row.created_by as string | null) ?? null,
    }));
  }

  addMarker(sessionId: string, label: string, sequence: number) {
    const id = createId();
    const created_at = nowIso();
    this.db.prepare(`INSERT INTO vtt_markers (id, session_id, label, sequence, created_at) VALUES (?, ?, ?, ?, ?)`).run(id, sessionId, label, sequence, created_at);
    return { id, label, sequence, created_at };
  }
  listMarkers(sessionId: string) {
    return (this.db.prepare(`SELECT * FROM vtt_markers WHERE session_id = ?`).all(sessionId) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      label: String(row.label),
      sequence: Number(row.sequence),
      created_at: String(row.created_at),
    }));
  }

  touchClient(id: string, sessionId: string, viewer: string, userId: string | null): void {
    this.db
      .prepare(
        `INSERT INTO vtt_clients (id, session_id, viewer, user_id, last_seen) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen, viewer=excluded.viewer`
      )
      .run(id, sessionId, viewer, userId, nowIso());
  }
  listClients(sessionId: string) {
    return (this.db.prepare(`SELECT * FROM vtt_clients WHERE session_id = ?`).all(sessionId) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      viewer: String(row.viewer),
      user_id: (row.user_id as string | null) ?? null,
      last_seen: String(row.last_seen),
    }));
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
