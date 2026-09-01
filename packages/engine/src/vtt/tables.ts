import { createHash } from 'node:crypto';
import type { DurableEvent, SceneDocument, AssetMetadata, Capability, ScopedTokenKind } from '@actualplay/protocol';
import { PROTOCOL_VERSION } from '@actualplay/protocol';
import { createId, nowIso } from '../ids.js';
import type { LiveState } from './model.js';

export interface AuthSessionRecord {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  rotated_from: string | null;
  user_agent: string | null;
  ip: string | null;
}

export interface ScopedTokenRecord {
  id: string;
  kind: ScopedTokenKind;
  token_hash: string;
  label: string;
  session_id: string | null;
  capabilities: Capability[];
  expires_at: string;
  revoked_at: string | null;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface DurableCommandRecord {
  id: string;
  type: string;
  actor_id: string | null;
  source: string;
  session_id: string;
  aggregate_type: string | null;
  aggregate_id: string | null;
  request_hash: string;
  result_json: string;
  status: string;
  created_at: string;
}

export interface SceneRow {
  id: string;
  campaign_id: string;
  title: string;
  status: 'draft' | 'published' | 'archived';
  draft: SceneDocument;
  published_revision_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface RevisionRow {
  id: string;
  scene_id: string;
  rev: number;
  document: SceneDocument;
  created_at: string;
  created_by: string | null;
}

export interface InstanceRow {
  id: string;
  session_id: string;
  scene_id: string;
  revision_id: string;
  status: 'staged' | 'live' | 'inactive';
  state: LiveState;
  version: number;
  last_event_sequence: number;
  created_at: string;
  updated_at: string;
}

export interface EncounterRow {
  id: string;
  name: string;
  members: Array<Partial<import('@actualplay/protocol').TokenRecord> & { name: string }>;
  created_at: string;
}

export interface PresetRow {
  id: string;
  name: string;
  steps: Array<{ type: string; payload: Record<string, unknown> }>;
  created_at: string;
}

export interface RundownRow {
  id: string;
  session_id: string;
  title: string;
  sort_order: number;
  state: 'ready' | 'live' | 'completed' | 'skipped';
  notes: string;
  expected_duration_ms: number | null;
  scene_id: string | null;
  preset_id: string | null;
  cue_name: string | null;
  poll_id: string | null;
  handout_id: string | null;
  started_at: string | null;
  ended_at: string | null;
}

export interface HandoutRow {
  id: string;
  title: string;
  kind: 'markdown' | 'image' | 'pdf' | 'text';
  body: string;
  asset_id: string | null;
  visibility: 'public' | 'players' | 'dm';
  version: number;
  created_at: string;
  updated_at: string;
}

export interface NoteRow {
  id: string;
  kind: 'dm' | 'shared' | 'private';
  body: string;
  author_id: string | null;
  scene_id: string | null;
  version: number;
  updated_at: string;
}

export interface WebhookRow {
  id: string;
  url: string;
  secret_hash: string;
  events: string[];
  created_at: string;
}

export interface CheckpointRow {
  id: string;
  session_id: string;
  instance_id: string;
  label: string;
  state: LiveState;
  created_at: string;
  created_by: string | null;
}

export interface VttTables {
  createAuthSession(row: AuthSessionRecord): AuthSessionRecord;
  getAuthSession(id: string): AuthSessionRecord | null;
  revokeAuthSession(id: string): void;

  createScopedToken(row: ScopedTokenRecord): ScopedTokenRecord;
  getScopedTokenByHash(hash: string): ScopedTokenRecord | null;
  revokeScopedToken(id: string): void;
  touchScopedToken(id: string): void;

  putDurableCommand(row: DurableCommandRecord): void;
  getDurableCommand(id: string): DurableCommandRecord | null;

  appendEvent(event: Omit<DurableEvent, 'sequence'>): DurableEvent;
  listEvents(sessionId: string, after: number, limit?: number): DurableEvent[];
  lastSequence(sessionId: string): number;

  putAsset(asset: AssetMetadata): AssetMetadata;
  getAsset(id: string): AssetMetadata | null;
  getAssetByHash(hash: string): AssetMetadata | null;
  listAssets(): AssetMetadata[];

  putScene(row: SceneRow): SceneRow;
  getScene(id: string): SceneRow | null;
  listScenes(campaignId: string): SceneRow[];

  putRevision(row: RevisionRow): RevisionRow;
  getRevision(id: string): RevisionRow | null;
  listRevisions(sceneId: string): RevisionRow[];

  putInstance(row: InstanceRow): InstanceRow;
  getInstance(id: string): InstanceRow | null;
  listInstances(sessionId: string): InstanceRow[];
  liveInstance(sessionId: string): InstanceRow | null;

  putEncounter(row: EncounterRow): EncounterRow;
  getEncounter(id: string): EncounterRow | null;
  listEncounters(): EncounterRow[];

  putPreset(row: PresetRow): PresetRow;
  getPreset(id: string): PresetRow | null;
  listPresets(): PresetRow[];

  putRundown(row: RundownRow): RundownRow;
  listRundown(sessionId: string): RundownRow[];
  getRundown(id: string): RundownRow | null;

  putHandout(row: HandoutRow): HandoutRow;
  getHandout(id: string): HandoutRow | null;
  listHandouts(): HandoutRow[];
  grantHandout(handoutId: string, playerId: string): void;
  handoutGrants(handoutId: string): string[];

  putNote(row: NoteRow): NoteRow;
  getNote(id: string): NoteRow | null;
  listNotes(): NoteRow[];

  putWebhook(row: WebhookRow): WebhookRow;
  listWebhooks(): WebhookRow[];
  recordDelivery(id: string, webhookId: string, eventType: string, status: string, attempts: number, lastError: string | null): void;
  listDeliveries(): { id: string; webhook_id: string; event_type: string; status: string; attempts: number; last_error: string | null }[];

  putCheckpoint(row: CheckpointRow): CheckpointRow;
  getCheckpoint(id: string): CheckpointRow | null;
  listCheckpoints(sessionId: string): CheckpointRow[];

  addMarker(sessionId: string, label: string, sequence: number): { id: string; label: string; sequence: number; created_at: string };
  listMarkers(sessionId: string): { id: string; label: string; sequence: number; created_at: string }[];

  touchClient(id: string, sessionId: string, viewer: string, userId: string | null): void;
  listClients(sessionId: string): { id: string; viewer: string; user_id: string | null; last_seen: string }[];

  transaction<T>(fn: () => T): T;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryVttTables implements VttTables {
  private sessions = new Map<string, AuthSessionRecord>();
  private tokens = new Map<string, ScopedTokenRecord>();
  private commands = new Map<string, DurableCommandRecord>();
  private events: DurableEvent[] = [];
  private nextSeq = 1;
  private assets = new Map<string, AssetMetadata>();
  private scenes = new Map<string, SceneRow>();
  private revisions = new Map<string, RevisionRow>();
  private instances = new Map<string, InstanceRow>();
  private encounters = new Map<string, EncounterRow>();
  private presets = new Map<string, PresetRow>();
  private rundown = new Map<string, RundownRow>();
  private handouts = new Map<string, HandoutRow>();
  private grants = new Map<string, Set<string>>();
  private notes = new Map<string, NoteRow>();
  private webhooks = new Map<string, WebhookRow>();
  private deliveries: { id: string; webhook_id: string; event_type: string; status: string; attempts: number; last_error: string | null }[] = [];
  private checkpoints = new Map<string, CheckpointRow>();
  private markers: { id: string; session_id: string; label: string; sequence: number; created_at: string }[] = [];
  private clients = new Map<string, { id: string; session_id: string; viewer: string; user_id: string | null; last_seen: string }>();

  createAuthSession(row: AuthSessionRecord): AuthSessionRecord {
    this.sessions.set(row.id, clone(row));
    return clone(row);
  }
  getAuthSession(id: string): AuthSessionRecord | null {
    const row = this.sessions.get(id);
    return row ? clone(row) : null;
  }
  revokeAuthSession(id: string): void {
    const row = this.sessions.get(id);
    if (row) row.revoked_at = nowIso();
  }

  createScopedToken(row: ScopedTokenRecord): ScopedTokenRecord {
    this.tokens.set(row.id, clone(row));
    return clone(row);
  }
  getScopedTokenByHash(hash: string): ScopedTokenRecord | null {
    return [...this.tokens.values()].find((row) => row.token_hash === hash && !row.revoked_at) ?? null;
  }
  revokeScopedToken(id: string): void {
    const row = this.tokens.get(id);
    if (row) row.revoked_at = nowIso();
  }
  touchScopedToken(id: string): void {
    const row = this.tokens.get(id);
    if (row) row.last_used_at = nowIso();
  }

  putDurableCommand(row: DurableCommandRecord): void {
    this.commands.set(row.id, clone(row));
  }
  getDurableCommand(id: string): DurableCommandRecord | null {
    const row = this.commands.get(id);
    return row ? clone(row) : null;
  }

  appendEvent(event: Omit<DurableEvent, 'sequence'>): DurableEvent {
    const stored: DurableEvent = { ...event, sequence: this.nextSeq++ };
    this.events.push(stored);
    return clone(stored);
  }
  listEvents(sessionId: string, after: number, limit = 500): DurableEvent[] {
    return this.events.filter((event) => event.sessionId === sessionId && event.sequence > after).slice(0, limit).map(clone);
  }
  lastSequence(sessionId: string): number {
    return this.events.reduce((max, event) => (event.sessionId === sessionId ? Math.max(max, event.sequence) : max), 0);
  }

  putAsset(asset: AssetMetadata): AssetMetadata {
    this.assets.set(asset.id, clone(asset));
    return clone(asset);
  }
  getAsset(id: string): AssetMetadata | null {
    return this.assets.get(id) ? clone(this.assets.get(id)!) : null;
  }
  getAssetByHash(hash: string): AssetMetadata | null {
    return [...this.assets.values()].find((asset) => asset.hash === hash) ?? null;
  }
  listAssets(): AssetMetadata[] {
    return [...this.assets.values()].map(clone);
  }

  putScene(row: SceneRow): SceneRow {
    this.scenes.set(row.id, clone(row));
    return clone(row);
  }
  getScene(id: string): SceneRow | null {
    return this.scenes.get(id) ? clone(this.scenes.get(id)!) : null;
  }
  listScenes(campaignId: string): SceneRow[] {
    return [...this.scenes.values()].filter((row) => row.campaign_id === campaignId).map(clone);
  }

  putRevision(row: RevisionRow): RevisionRow {
    this.revisions.set(row.id, clone(row));
    return clone(row);
  }
  getRevision(id: string): RevisionRow | null {
    return this.revisions.get(id) ? clone(this.revisions.get(id)!) : null;
  }
  listRevisions(sceneId: string): RevisionRow[] {
    return [...this.revisions.values()].filter((row) => row.scene_id === sceneId).map(clone);
  }

  putInstance(row: InstanceRow): InstanceRow {
    this.instances.set(row.id, clone(row));
    return clone(row);
  }
  getInstance(id: string): InstanceRow | null {
    return this.instances.get(id) ? clone(this.instances.get(id)!) : null;
  }
  listInstances(sessionId: string): InstanceRow[] {
    return [...this.instances.values()].filter((row) => row.session_id === sessionId).map(clone);
  }
  liveInstance(sessionId: string): InstanceRow | null {
    return [...this.instances.values()].find((row) => row.session_id === sessionId && row.status === 'live') ?? null;
  }

  putEncounter(row: EncounterRow): EncounterRow {
    this.encounters.set(row.id, clone(row));
    return clone(row);
  }
  getEncounter(id: string): EncounterRow | null {
    return this.encounters.get(id) ? clone(this.encounters.get(id)!) : null;
  }
  listEncounters(): EncounterRow[] {
    return [...this.encounters.values()].map(clone);
  }

  putPreset(row: PresetRow): PresetRow {
    this.presets.set(row.id, clone(row));
    return clone(row);
  }
  getPreset(id: string): PresetRow | null {
    return this.presets.get(id) ? clone(this.presets.get(id)!) : null;
  }
  listPresets(): PresetRow[] {
    return [...this.presets.values()].map(clone);
  }

  putRundown(row: RundownRow): RundownRow {
    this.rundown.set(row.id, clone(row));
    return clone(row);
  }
  listRundown(sessionId: string): RundownRow[] {
    return [...this.rundown.values()].filter((row) => row.session_id === sessionId).sort((a, b) => a.sort_order - b.sort_order).map(clone);
  }
  getRundown(id: string): RundownRow | null {
    return this.rundown.get(id) ? clone(this.rundown.get(id)!) : null;
  }

  putHandout(row: HandoutRow): HandoutRow {
    this.handouts.set(row.id, clone(row));
    return clone(row);
  }
  getHandout(id: string): HandoutRow | null {
    return this.handouts.get(id) ? clone(this.handouts.get(id)!) : null;
  }
  listHandouts(): HandoutRow[] {
    return [...this.handouts.values()].map(clone);
  }
  grantHandout(handoutId: string, playerId: string): void {
    const set = this.grants.get(handoutId) ?? new Set<string>();
    set.add(playerId);
    this.grants.set(handoutId, set);
  }
  handoutGrants(handoutId: string): string[] {
    return [...(this.grants.get(handoutId) ?? [])];
  }

  putNote(row: NoteRow): NoteRow {
    this.notes.set(row.id, clone(row));
    return clone(row);
  }
  getNote(id: string): NoteRow | null {
    return this.notes.get(id) ? clone(this.notes.get(id)!) : null;
  }
  listNotes(): NoteRow[] {
    return [...this.notes.values()].map(clone);
  }

  putWebhook(row: WebhookRow): WebhookRow {
    this.webhooks.set(row.id, clone(row));
    return clone(row);
  }
  listWebhooks(): WebhookRow[] {
    return [...this.webhooks.values()].map(clone);
  }
  recordDelivery(id: string, webhookId: string, eventType: string, status: string, attempts: number, lastError: string | null): void {
    this.deliveries.push({ id, webhook_id: webhookId, event_type: eventType, status, attempts, last_error: lastError });
  }
  listDeliveries() {
    return [...this.deliveries];
  }

  putCheckpoint(row: CheckpointRow): CheckpointRow {
    this.checkpoints.set(row.id, clone(row));
    return clone(row);
  }
  getCheckpoint(id: string): CheckpointRow | null {
    return this.checkpoints.get(id) ? clone(this.checkpoints.get(id)!) : null;
  }
  listCheckpoints(sessionId: string): CheckpointRow[] {
    return [...this.checkpoints.values()].filter((row) => row.session_id === sessionId).map(clone);
  }

  addMarker(sessionId: string, label: string, sequence: number) {
    const row = { id: createId(), session_id: sessionId, label, sequence, created_at: nowIso() };
    this.markers.push(row);
    return { id: row.id, label, sequence, created_at: row.created_at };
  }
  listMarkers(sessionId: string) {
    return this.markers.filter((row) => row.session_id === sessionId).map((row) => ({ id: row.id, label: row.label, sequence: row.sequence, created_at: row.created_at }));
  }

  touchClient(id: string, sessionId: string, viewer: string, userId: string | null): void {
    this.clients.set(id, { id, session_id: sessionId, viewer, user_id: userId, last_seen: nowIso() });
  }
  listClients(sessionId: string) {
    return [...this.clients.values()].filter((row) => row.session_id === sessionId).map((row) => ({ id: row.id, viewer: row.viewer, user_id: row.user_id, last_seen: row.last_seen }));
  }

  transaction<T>(fn: () => T): T {
    return fn();
  }
}

export function hashRequest(type: string, sessionId: string, payload: unknown): string {
  return createHash('sha256').update(JSON.stringify({ type, sessionId, payload })).digest('hex');
}

export function emptyEvent(partial: Omit<DurableEvent, 'sequence' | 'protocolVersion'> & { protocolVersion?: number }): Omit<DurableEvent, 'sequence'> {
  return {
    protocolVersion: partial.protocolVersion ?? PROTOCOL_VERSION,
    sessionId: partial.sessionId,
    aggregateType: partial.aggregateType,
    aggregateId: partial.aggregateId,
    aggregateVersion: partial.aggregateVersion,
    type: partial.type,
    actorId: partial.actorId,
    source: partial.source,
    payload: partial.payload,
    timestamp: partial.timestamp,
    commandId: partial.commandId,
  };
}
