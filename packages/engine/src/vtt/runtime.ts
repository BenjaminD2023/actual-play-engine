import { createHmac, randomBytes } from 'node:crypto';
import {
  parseCommandEnvelope,
  ProtocolError,
  PROTOCOL_VERSION,
  type ActorContext,
  type CommandEnvelope,
  type DurableEvent,
  type PresetStepStatus,
  type TokenRecord,
  type VttSnapshot,
  type ViewerKind,
} from '@actualplay/protocol';
import type { ActualPlayEngine } from '../engine.js';
import { createId, nowIso } from '../ids.js';
import { hashBridgeToken } from '../midi/token.js';
import { SqliteStore } from '../store/sqlite.js';
import { AssetService } from './assets.js';
import { assertCapability, capabilitiesFor, isReadOnlyViewer, viewerFromRole } from './capabilities.js';
import { snapToGrid } from './geometry.js';
import { emptyDocument, liveFromDocument, makeToken, stamp, type LiveState } from './model.js';
import { applyReplayEvent, categorizeReplay } from './replay-apply.js';
import { MIGRATIONS, migrationStatus } from '../store/migrations.js';
import { exportScenePackage, extractZipEntries, importScenePackage } from './pack.js';
import { omitSecretsFromJson, projectInstance } from './projection.js';
import { RulesRegistry } from './rules.js';
import { hashRequest, MemoryVttTables, type InstanceRow, type VttTables } from './tables.js';
import { SqliteVttTables } from './sqlite-tables.js';
import { isRegisteredAction } from './actions.js';

export interface VttRuntimeOptions {
  enabled?: boolean;
  assetRoot?: string;
  tables?: VttTables;
}

export interface CommandOutcome {
  ok: boolean;
  duplicate?: boolean;
  version?: number;
  sequence?: number;
  result: Record<string, unknown>;
}

export class VttRuntime {
  readonly tables: VttTables;
  readonly assets: AssetService;
  readonly rules = new RulesRegistry();
  readonly enabled: boolean;
  private ephemeral: Array<{ at: number; event: Record<string, unknown> }> = [];

  constructor(
    private readonly engine: ActualPlayEngine,
    options: VttRuntimeOptions = {}
  ) {
    this.enabled = options.enabled !== false;
    this.tables = options.tables ?? tablesFor(engine);
    this.assets = new AssetService(this.tables, options.assetRoot ?? './data/assets');
  }

  actorFrom(input: { userId?: string | null; role: ActorContext['role']; viewer?: ViewerKind; playerId?: string | null; tokenId?: string | null }): ActorContext {
    const viewer = input.viewer ?? viewerFromRole(input.role);
    return {
      userId: input.userId ?? null,
      username: null,
      role: input.role,
      viewer,
      capabilities: capabilitiesFor(viewer),
      tokenId: input.tokenId ?? null,
      playerId: input.playerId ?? null,
    };
  }

  createSession(userId: string, ttlMs = 24 * 60 * 60 * 1000, meta?: { userAgent?: string; ip?: string }): string {
    const id = randomBytes(24).toString('base64url');
    this.tables.createAuthSession({
      id,
      user_id: userId,
      created_at: nowIso(),
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
      revoked_at: null,
      rotated_from: null,
      user_agent: meta?.userAgent ?? null,
      ip: meta?.ip ?? null,
    });
    return id;
  }

  resolveSession(id: string): { userId: string } | null {
    const row = this.tables.getAuthSession(id);
    if (!row || row.revoked_at) return null;
    if (Date.parse(row.expires_at) < Date.now()) return null;
    return { userId: row.user_id };
  }

  revokeSession(id: string): void {
    this.tables.revokeAuthSession(id);
  }

  issueScopedToken(kind: ActorContext['viewer'] extends infer _ ? import('@actualplay/protocol').ScopedTokenKind : never, label: string, sessionId: string | null, createdBy: string | null) {
    const raw = randomBytes(32).toString('base64url');
    const hash = hashBridgeToken(raw);
    const viewer = kind === 'bridge' ? 'operator' : (kind as ViewerKind);
    const row = this.tables.createScopedToken({
      id: createId(),
      kind,
      token_hash: hash,
      label,
      session_id: sessionId,
      capabilities: capabilitiesFor(viewer),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      revoked_at: null,
      created_by: createdBy,
      created_at: nowIso(),
      last_used_at: null,
    });
    return { token: raw, record: row };
  }

  resolveScopedToken(raw: string) {
    const row = this.tables.getScopedTokenByHash(hashBridgeToken(raw));
    if (!row || row.revoked_at) return null;
    if (Date.parse(row.expires_at) < Date.now()) return null;
    this.tables.touchScopedToken(row.id);
    return row;
  }

  snapshot(sessionId: string, actor: ActorContext, instanceId?: string): VttSnapshot {
    const instance = instanceId ? this.tables.getInstance(instanceId) : this.tables.liveInstance(sessionId) ?? this.tables.listInstances(sessionId)[0] ?? null;
    const game = this.engine.store.getActiveSession() ? this.engine.store.getGameState(sessionId) : { combat_mode: false, round_number: 1, current_turn: 0 };
    const snap = projectInstance(instance, actor, {
      players: this.engine.store.listPlayers(sessionId),
      combat: { mode: game.combat_mode, round: game.round_number, currentTurn: game.current_turn },
      initiative: this.engine.store.listInitiative(sessionId),
      lastEventSequence: this.tables.lastSequence(sessionId),
      assets: this.tables.listAssets(),
    });
    snap.sessionId = sessionId;
    return omitSecretsFromJson(snap, actor.viewer) as VttSnapshot;
  }

  eventsSince(sessionId: string, after: number): DurableEvent[] {
    return this.tables.listEvents(sessionId, after);
  }

  async execute(raw: unknown, actor: ActorContext): Promise<CommandOutcome> {
    if (!this.enabled) throw new ProtocolError('unavailable', 'VTT is disabled on this engine.');
    if (isReadOnlyViewer(actor.viewer) && typeof raw === 'object' && raw && 'type' in raw) {
      const type = String((raw as { type: string }).type);
      if (type !== 'ping.create') {
        throw new ProtocolError('forbidden', 'This credential is read-only.');
      }
    }
    const envelope = parseCommandEnvelope(raw);
    const requestHash = hashRequest(envelope.type, envelope.sessionId, envelope.payload);
    const existing = this.tables.getDurableCommand(envelope.id);
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new ProtocolError('duplicate_command', 'Command id reused with a different body.');
      }
      return { ok: true, duplicate: true, result: JSON.parse(existing.result_json) as Record<string, unknown> };
    }

    const outcome = await this.dispatch(envelope, actor);
    this.tables.putDurableCommand({
      id: envelope.id,
      type: envelope.type,
      actor_id: actor.userId,
      source: actor.role,
      session_id: envelope.sessionId,
      aggregate_type: 'scene_instance',
      aggregate_id: envelope.sceneInstanceId ?? null,
      request_hash: requestHash,
      result_json: JSON.stringify(outcome.result),
      status: outcome.ok ? 'ok' : 'error',
      created_at: nowIso(),
    });
    await this.fanoutWebhooks(envelope.type, outcome.result);
    return outcome;
  }

  private async dispatch(envelope: CommandEnvelope, actor: ActorContext): Promise<CommandOutcome> {
    switch (envelope.type) {
      case 'scene.create':
        return this.createScene(envelope, actor);
      case 'scene.updateDraft':
        return this.updateDraft(envelope, actor);
      case 'scene.publish':
        return this.publishScene(envelope, actor);
      case 'scene.instantiate':
        return this.instantiate(envelope, actor);
      case 'scene.stage':
        return this.setInstanceStatus(envelope, actor, 'staged', 'stageScene');
      case 'scene.activate':
        return this.setInstanceStatus(envelope, actor, 'live', 'activateScene');
      case 'scene.archive':
        return this.archiveScene(envelope, actor);
      case 'token.create':
        return this.mutateLive(envelope, actor, 'manageTokens', (state) => {
          const token = makeToken({
            name: String(envelope.payload.name ?? 'Token'),
            x: Number(envelope.payload.x ?? 0),
            y: Number(envelope.payload.y ?? 0),
            ownerUserId: typeof envelope.payload.ownerUserId === 'string' ? envelope.payload.ownerUserId : null,
            playerId: typeof envelope.payload.playerId === 'string' ? envelope.payload.playerId : null,
            disposition: envelope.payload.disposition === 'enemy' ? 'enemy' : 'ally',
            visibility: envelope.payload.visibility === 'hidden' ? 'hidden' : 'visible',
          });
          const snapped = snapToGrid({ x: token.x, y: token.y }, state.grid);
          token.x = snapped.x;
          token.y = snapped.y;
          state.tokens.push(token);
          return { token };
        });
      case 'token.move':
        return this.moveToken(envelope, actor);
      case 'token.update':
      case 'token.setElevation':
      case 'token.setVisibility':
      case 'token.setCondition':
      case 'token.setAura':
      case 'token.assignOwner':
      case 'token.lock':
      case 'token.unlock':
        return this.updateToken(envelope, actor);
      case 'token.duplicate':
        return this.mutateLive(envelope, actor, 'manageTokens', (state) => {
          const token = this.requireToken(state, String(envelope.payload.tokenId));
          const copy = makeToken({ ...token, id: createId(), name: `${token.name} copy`, x: token.x + 70, y: token.y });
          state.tokens.push(copy);
          return { token: copy };
        });
      case 'token.delete':
        return this.mutateLive(envelope, actor, 'manageTokens', (state) => {
          const id = String(envelope.payload.tokenId);
          state.tokens = state.tokens.filter((token) => token.id !== id);
          return { deleted: id };
        });
      case 'wall.create':
        return this.mutateLive(envelope, actor, 'editWalls', (state) => {
          const wall = {
            id: createId(),
            a: { x: Number((envelope.payload.a as { x: number }).x), y: Number((envelope.payload.a as { y: number }).y) },
            b: { x: Number((envelope.payload.b as { x: number }).x), y: Number((envelope.payload.b as { y: number }).y) },
            blockingVision: envelope.payload.blockingVision !== false,
            blockingMovement: envelope.payload.blockingMovement !== false,
            dmOnly: Boolean(envelope.payload.dmOnly),
            kind: envelope.payload.kind === 'window' ? 'window' as const : envelope.payload.kind === 'guide' ? 'guide' as const : 'wall' as const,
          };
          state.walls.push(wall);
          if (envelope.payload.door) {
            state.doors.push({
              id: createId(),
              wallId: wall.id,
              state: 'closed',
              secret: Boolean(envelope.payload.secret),
              dmOnly: Boolean(envelope.payload.dmOnly),
            });
          }
          return { wall };
        });
      case 'wall.update':
        return this.mutateLive(envelope, actor, 'editWalls', (state) => {
          const wall = state.walls.find((item) => item.id === envelope.payload.wallId);
          if (!wall) throw new ProtocolError('not_found', 'Wall not found.');
          if (envelope.payload.a) wall.a = envelope.payload.a as { x: number; y: number };
          if (envelope.payload.b) wall.b = envelope.payload.b as { x: number; y: number };
          return { wall };
        });
      case 'wall.delete':
        return this.mutateLive(envelope, actor, 'editWalls', (state) => {
          const id = String(envelope.payload.wallId);
          state.walls = state.walls.filter((wall) => wall.id !== id);
          state.doors = state.doors.filter((door) => door.wallId !== id);
          return { deleted: id };
        });
      case 'door.setState':
        return this.mutateLive(envelope, actor, 'editWalls', (state) => {
          const door = state.doors.find((item) => item.id === envelope.payload.doorId);
          if (!door) throw new ProtocolError('not_found', 'Door not found.');
          door.state = envelope.payload.state as typeof door.state;
          return { door };
        }, 'vtt.door.changed');
      case 'light.create':
        return this.mutateLive(envelope, actor, 'editLights', (state) => {
          const light = {
            id: createId(),
            x: Number(envelope.payload.x ?? 0),
            y: Number(envelope.payload.y ?? 0),
            bright: Number(envelope.payload.bright ?? 140),
            dim: Number(envelope.payload.dim ?? 280),
            color: String(envelope.payload.color ?? '#ffe9a8'),
            enabled: envelope.payload.enabled !== false,
            darkness: Boolean(envelope.payload.darkness),
          };
          state.lights.push(light);
          return { light };
        });
      case 'light.update':
        return this.mutateLive(envelope, actor, 'editLights', (state) => {
          const light = state.lights.find((item) => item.id === envelope.payload.lightId);
          if (!light) throw new ProtocolError('not_found', 'Light not found.');
          Object.assign(light, envelope.payload);
          return { light };
        });
      case 'light.delete':
        return this.mutateLive(envelope, actor, 'editLights', (state) => {
          const id = String(envelope.payload.lightId);
          state.lights = state.lights.filter((item) => item.id !== id);
          return { deleted: id };
        });
      case 'fog.reveal':
      case 'fog.hide':
      case 'fog.reset':
      case 'fog.undo':
      case 'fog.compact':
        return this.mutateFog(envelope, actor);
      case 'annotation.upsert':
        return this.mutateLive(envelope, actor, 'prepareScene', (state) => {
          const id = String(envelope.payload.annotationId ?? createId());
          const next = {
            id,
            kind: (envelope.payload.kind ?? 'text') as 'text',
            points: (envelope.payload.points as { x: number; y: number }[]) ?? [{ x: 0, y: 0 }],
            text: String(envelope.payload.text ?? ''),
            color: String(envelope.payload.color ?? '#ffffff'),
            dmOnly: Boolean(envelope.payload.dmOnly),
            strokeWidth: Number(envelope.payload.strokeWidth ?? 2),
          };
          state.annotations = [...state.annotations.filter((item) => item.id !== id), next];
          return { annotation: next };
        }, 'vtt.annotation.changed');
      case 'annotation.delete':
        return this.mutateLive(envelope, actor, 'prepareScene', (state) => {
          const id = String(envelope.payload.annotationId);
          state.annotations = state.annotations.filter((item) => item.id !== id);
          return { deleted: id };
        }, 'vtt.annotation.changed');
      case 'template.upsert':
        return this.mutateLive(envelope, actor, 'prepareScene', (state) => {
          const id = String(envelope.payload.templateId ?? createId());
          const next = {
            id,
            kind: (envelope.payload.kind ?? 'circle') as 'circle',
            origin: (envelope.payload.origin as { x: number; y: number }) ?? { x: 0, y: 0 },
            length: Number(envelope.payload.length ?? 70),
            width: Number(envelope.payload.width ?? 70),
            rotation: Number(envelope.payload.rotation ?? 0),
            color: String(envelope.payload.color ?? '#88ccff'),
            label: String(envelope.payload.label ?? ''),
          };
          state.templates = [...state.templates.filter((item) => item.id !== id), next];
          return { template: next };
        }, 'vtt.template.changed');
      case 'template.delete':
        return this.mutateLive(envelope, actor, 'prepareScene', (state) => {
          const id = String(envelope.payload.templateId);
          state.templates = state.templates.filter((item) => item.id !== id);
          return { deleted: id };
        }, 'vtt.template.changed');
      case 'terrain.upsert':
        return this.mutateLive(envelope, actor, 'prepareScene', (state) => {
          const id = String(envelope.payload.terrainId ?? createId());
          const next = {
            id,
            points: (envelope.payload.points as { x: number; y: number }[]) ?? [],
            multiplier: Number(envelope.payload.multiplier ?? 2),
            label: String(envelope.payload.label ?? 'difficult'),
          };
          state.terrain = [...state.terrain.filter((item) => item.id !== id), next];
          return { terrain: next };
        }, 'vtt.terrain.changed');
      case 'terrain.delete':
        return this.mutateLive(envelope, actor, 'prepareScene', (state) => {
          const id = String(envelope.payload.terrainId);
          state.terrain = state.terrain.filter((item) => item.id !== id);
          return { deleted: id };
        }, 'vtt.terrain.changed');
      case 'ping.create':
        this.pushEphemeral({ kind: 'ping', x: envelope.payload.x, y: envelope.payload.y, actorId: actor.userId });
        return { ok: true, result: { ping: true } };
      case 'camera.set':
        return this.mutateLive(envelope, actor, 'controlCamera', (state) => {
          state.camera = {
            x: Number(envelope.payload.x ?? state.camera.x),
            y: Number(envelope.payload.y ?? state.camera.y),
            zoom: Number(envelope.payload.zoom ?? state.camera.zoom),
            rotation: Number(envelope.payload.rotation ?? 0),
          };
          return { camera: state.camera };
        }, 'vtt.camera.changed');
      case 'camera.activatePreset':
        return this.mutateLive(envelope, actor, 'controlCamera', (state) => {
          const preset = state.cameras.find((item) => item.id === envelope.payload.presetId);
          if (!preset) throw new ProtocolError('not_found', 'Camera preset not found.');
          state.camera = { ...preset.camera };
          return { camera: state.camera };
        }, 'vtt.camera.changed');
      case 'camera.focusToken':
        return this.mutateLive(envelope, actor, 'controlCamera', (state) => {
          const token = this.requireToken(state, String(envelope.payload.tokenId));
          state.camera = { ...state.camera, x: token.x, y: token.y };
          return { camera: state.camera };
        }, 'vtt.camera.changed');
      case 'camera.focusInitiative':
        return this.focusInitiative(envelope, actor);
      case 'encounter.spawn':
        return this.spawnEncounter(envelope, actor);
      case 'encounter.remove':
        return this.mutateLive(envelope, actor, 'manageTokens', (state) => {
          const id = String(envelope.payload.spawnId ?? envelope.payload.encounterId);
          state.tokens = state.tokens.filter((token) => token.encounterMemberId !== id && token.id !== id);
          state.spawnIds = state.spawnIds.filter((item) => item !== id);
          return { removed: id };
        }, 'vtt.encounter.changed');
      case 'combat.nextTurn':
      case 'combat.previousTurn':
      case 'combat.newRound':
      case 'combat.end':
        return await this.combat(envelope, actor);
      case 'showPreset.run':
        return await this.runPreset(envelope, actor);
      case 'rundown.advance':
      case 'rundown.goBack':
      case 'rundown.skip':
        return this.rundown(envelope, actor);
      case 'announcement.show':
        return this.mutateLive(envelope, actor, 'runShowPreset', (state) => {
          state.announcement = String(envelope.payload.text);
          this.engine.store.updateGameState(envelope.sessionId, { global_announcement: state.announcement });
          return { announcement: state.announcement };
        }, 'vtt.announcement');
      case 'announcement.clear':
        return this.mutateLive(envelope, actor, 'runShowPreset', (state) => {
          state.announcement = '';
          this.engine.store.updateGameState(envelope.sessionId, { global_announcement: '' });
          return { announcement: '' };
        }, 'vtt.announcement');
      case 'handout.show':
      case 'handout.hide':
        return this.handout(envelope, actor);
      case 'poll.open':
      case 'poll.close':
        return this.poll(envelope, actor);
      case 'recording.marker': {
        const seq = this.tables.lastSequence(envelope.sessionId);
        const marker = this.tables.addMarker(envelope.sessionId, String(envelope.payload.label ?? 'marker'), seq);
        this.append(envelope, actor, envelope.sessionId, seq, 'vtt.recording.marker', marker);
        return { ok: true, result: { marker } };
      }
      case 'checkpoint.create':
        return this.checkpointCreate(envelope, actor);
      case 'checkpoint.previewRestore':
        return this.checkpointPreview(envelope, actor);
      case 'checkpoint.restore':
        return this.checkpointRestore(envelope, actor);
      default:
        throw new ProtocolError('invalid_request', `Unknown command type: ${String(envelope.type)}`);
    }
  }

  private createScene(envelope: CommandEnvelope, actor: ActorContext): CommandOutcome {
    assertCapability(actor.capabilities, 'prepareScene');
    const title = String(envelope.payload.title ?? envelope.payload.name ?? 'Scene');
    const mode = envelope.payload.grid && typeof envelope.payload.grid === 'object' ? (envelope.payload.grid as { mode?: string }).mode : 'square';
    const draft = emptyDocument(title, mode === 'hex-flat' || mode === 'hex-pointy' || mode === 'gridless' ? mode : 'square');
    if (envelope.payload.document && typeof envelope.payload.document === 'object') {
      Object.assign(draft, structuredClone(envelope.payload.document));
    }
    if (envelope.payload.mapAssetId) draft.mapAssetId = String(envelope.payload.mapAssetId);
    if (envelope.payload.animated) draft.animated = true;
    const row = this.tables.putScene({
      id: createId(),
      campaign_id: String(envelope.payload.campaignId ?? 'default'),
      title,
      status: 'draft',
      draft,
      published_revision_id: null,
      version: 1,
      created_at: stamp(),
      updated_at: stamp(),
    });
    this.append(envelope, actor, row.id, 1, 'vtt.scene.created', { sceneId: row.id });
    return { ok: true, result: { scene: row } };
  }

  private updateDraft(envelope: CommandEnvelope, actor: ActorContext): CommandOutcome {
    assertCapability(actor.capabilities, 'prepareScene');
    const scene = this.tables.getScene(String(envelope.payload.sceneId));
    if (!scene) throw new ProtocolError('not_found', 'Scene not found.');
    const draft = { ...scene.draft, ...(envelope.payload.document as object ?? {}), title: String(envelope.payload.title ?? scene.draft.title) };
    if (envelope.payload.grid) draft.grid = { ...draft.grid, ...(envelope.payload.grid as object) };
    if (typeof envelope.payload.mapAssetId === 'string') draft.mapAssetId = envelope.payload.mapAssetId;
    if (typeof envelope.payload.animated === 'boolean') draft.animated = envelope.payload.animated;
    if (typeof envelope.payload.notes === 'string') draft.notes = envelope.payload.notes;
    const updated = this.tables.putScene({ ...scene, draft, title: draft.title, updated_at: stamp(), version: scene.version + 1 });
    this.append(envelope, actor, scene.id, updated.version, 'vtt.scene.updated', { sceneId: scene.id });
    return { ok: true, version: updated.version, result: { scene: updated } };
  }

  private publishScene(envelope: CommandEnvelope, actor: ActorContext): CommandOutcome {
    assertCapability(actor.capabilities, 'publishScene');
    const scene = this.tables.getScene(String(envelope.payload.sceneId));
    if (!scene) throw new ProtocolError('not_found', 'Scene not found.');
    const rev = this.tables.listRevisions(scene.id).length + 1;
    const revision = this.tables.putRevision({
      id: createId(),
      scene_id: scene.id,
      rev,
      document: structuredClone(scene.draft),
      created_at: stamp(),
      created_by: actor.userId,
    });
    const updated = this.tables.putScene({
      ...scene,
      status: 'published',
      published_revision_id: revision.id,
      updated_at: stamp(),
      version: scene.version + 1,
    });
    this.append(envelope, actor, scene.id, updated.version, 'vtt.scene.published', { revisionId: revision.id, rev });
    return { ok: true, result: { scene: updated, revision } };
  }

  private instantiate(envelope: CommandEnvelope, actor: ActorContext): CommandOutcome {
    assertCapability(actor.capabilities, 'instantiateScene');
    const scene = this.tables.getScene(String(envelope.payload.sceneId));
    if (!scene?.published_revision_id) throw new ProtocolError('scene_not_published', 'Scene has no published revision.');
    const revision = this.tables.getRevision(String(envelope.payload.revisionId ?? scene.published_revision_id));
    if (!revision) throw new ProtocolError('not_found', 'Revision not found.');
    const instance = this.tables.putInstance({
      id: createId(),
      session_id: envelope.sessionId,
      scene_id: scene.id,
      revision_id: revision.id,
      status: 'staged',
      state: liveFromDocument(revision.document),
      version: 1,
      last_event_sequence: 0,
      created_at: stamp(),
      updated_at: stamp(),
    });
    this.append(envelope, actor, instance.id, 1, 'vtt.scene.instantiated', { instanceId: instance.id });
    return { ok: true, result: { instance } };
  }

  private setInstanceStatus(envelope: CommandEnvelope, actor: ActorContext, status: 'staged' | 'live', cap: 'stageScene' | 'activateScene'): CommandOutcome {
    assertCapability(actor.capabilities, cap);
    const instance = this.requireInstance(envelope);
    if (status === 'live') {
      for (const other of this.tables.listInstances(envelope.sessionId)) {
        if (other.id !== instance.id && other.status === 'live') {
          this.tables.putInstance({ ...other, status: 'inactive', updated_at: stamp() });
        }
      }
    }
    const updated = this.tables.putInstance({ ...instance, status, updated_at: stamp(), version: instance.version + 1 });
    this.append(envelope, actor, updated.id, updated.version, status === 'live' ? 'vtt.scene.activated' : 'vtt.scene.staged', { instanceId: updated.id });
    return { ok: true, version: updated.version, result: { instance: updated } };
  }

  private archiveScene(envelope: CommandEnvelope, actor: ActorContext): CommandOutcome {
    assertCapability(actor.capabilities, 'prepareScene');
    const scene = this.tables.getScene(String(envelope.payload.sceneId));
    if (!scene) throw new ProtocolError('not_found', 'Scene not found.');
    const updated = this.tables.putScene({ ...scene, status: 'archived', updated_at: stamp() });
    this.append(envelope, actor, scene.id, scene.version, 'vtt.scene.archived', { sceneId: scene.id });
    return { ok: true, result: { scene: updated } };
  }

  private moveToken(envelope: CommandEnvelope, actor: ActorContext): CommandOutcome {
    return this.mutateLive(envelope, actor, 'controlToken', (state) => {
      const token = this.requireToken(state, String(envelope.payload.tokenId));
      this.assertTokenControl(actor, token);
      if (token.locked) throw new ProtocolError('forbidden', 'Token is locked.');
      const snapped = snapToGrid({ x: Number(envelope.payload.x), y: Number(envelope.payload.y) }, state.grid);
      token.x = snapped.x;
      token.y = snapped.y;
      if (typeof envelope.payload.rotation === 'number') token.rotation = envelope.payload.rotation;
      return { token };
    }, 'vtt.token.changed');
  }

  private updateToken(envelope: CommandEnvelope, actor: ActorContext): CommandOutcome {
    const cap = envelope.type === 'token.assignOwner' ? 'assignTokenOwner' : 'controlToken';
    return this.mutateLive(envelope, actor, cap, (state) => {
      const token = this.requireToken(state, String(envelope.payload.tokenId));
      if (envelope.type !== 'token.assignOwner') this.assertTokenControl(actor, token);
      if (envelope.type === 'token.lock') token.locked = true;
      if (envelope.type === 'token.unlock') token.locked = false;
      if (envelope.type === 'token.setVisibility') token.visibility = envelope.payload.visibility as TokenRecord['visibility'];
      if (envelope.type === 'token.setElevation') token.elevation = Number(envelope.payload.elevation ?? 0);
      if (envelope.type === 'token.assignOwner') {
        token.ownerUserId = typeof envelope.payload.ownerUserId === 'string' ? envelope.payload.ownerUserId : null;
        token.playerId = typeof envelope.payload.playerId === 'string' ? envelope.payload.playerId : token.playerId;
      }
      if (envelope.type === 'token.setCondition') {
        const condition = String(envelope.payload.condition);
        const remove = Boolean(envelope.payload.remove);
        token.conditions = remove ? token.conditions.filter((item) => item !== condition) : [...new Set([...token.conditions, condition])];
      }
      if (envelope.type === 'token.setAura') {
        token.auras = [
          ...token.auras.filter((aura) => aura.id !== envelope.payload.auraId),
          {
            id: String(envelope.payload.auraId ?? createId()),
            radius: Number(envelope.payload.radius ?? 35),
            color: String(envelope.payload.color ?? '#66ff99'),
            label: String(envelope.payload.label ?? ''),
          },
        ];
      }
      if (envelope.type === 'token.update') {
        if (typeof envelope.payload.name === 'string') token.name = envelope.payload.name;
        if (typeof envelope.payload.width === 'number') token.width = envelope.payload.width;
        if (typeof envelope.payload.height === 'number') token.height = envelope.payload.height;
        if (typeof envelope.payload.rotation === 'number') token.rotation = envelope.payload.rotation;
        if (typeof envelope.payload.assetId === 'string') token.assetId = envelope.payload.assetId;
        if (typeof envelope.payload.initiativeId === 'string') token.initiativeId = envelope.payload.initiativeId;
      }
      return { token };
    }, 'vtt.token.changed');
  }

  private mutateFog(envelope: CommandEnvelope, actor: ActorContext): CommandOutcome {
    return this.mutateLive(envelope, actor, 'editFog', (state) => {
      if (envelope.type === 'fog.reset') {
        state.fog = [{ id: createId(), kind: 'reset', shape: 'full', points: [], createdAt: stamp(), actorId: actor.userId }];
      } else if (envelope.type === 'fog.undo') {
        state.fog = state.fog.slice(0, -1);
      } else if (envelope.type === 'fog.compact') {
        const last = state.fog.at(-1);
        state.fog = last ? [last] : [];
      } else {
        state.fog.push({
          id: createId(),
          kind: envelope.type === 'fog.hide' ? 'hide' : 'reveal',
          shape: (envelope.payload.shape as 'rect') ?? 'rect',
          points: (envelope.payload.points as { x: number; y: number }[]) ?? [],
          createdAt: stamp(),
          actorId: actor.userId,
        });
      }
      return { fog: state.fog };
    }, 'vtt.fog.changed');
  }

  private spawnEncounter(envelope: CommandEnvelope, actor: ActorContext): CommandOutcome {
    assertCapability(actor.capabilities, 'manageTokens');
    const encounter = this.tables.getEncounter(String(envelope.payload.encounterId));
    if (!encounter) throw new ProtocolError('not_found', 'Encounter not found.');
    return this.mutateLive(envelope, actor, 'manageTokens', (state) => {
      const spawned: TokenRecord[] = [];
      encounter.members.forEach((member, index) => {
        const token = makeToken({
          ...member,
          name: member.name,
          x: Number(envelope.payload.x ?? 0) + index * 70,
          y: Number(envelope.payload.y ?? 0),
          disposition: 'enemy',
          encounterMemberId: encounter.id,
        });
        state.tokens.push(token);
        spawned.push(token);
      });
      state.spawnIds.push(encounter.id);
      return { spawned };
    }, 'vtt.encounter.changed');
  }

  private async combat(envelope: CommandEnvelope, actor: ActorContext): Promise<CommandOutcome> {
    assertCapability(actor.capabilities, 'runShowPreset');
    const map: Record<string, 'next_turn' | 'previous_turn' | 'new_round' | 'end'> = {
      'combat.nextTurn': 'next_turn',
      'combat.previousTurn': 'previous_turn',
      'combat.newRound': 'new_round',
      'combat.end': 'end',
    };
    const command = map[envelope.type];
    if (!command) throw new ProtocolError('invalid_request', `Unsupported combat command: ${envelope.type}`);
    const source = actor.role === 'midi' || actor.role === 'bridge' || actor.role === 'system' ? actor.role : actor.role;
    const result = await this.engine.dispatch({
      id: createId(),
      type: `combat.${command}`,
      source,
      actorId: actor.userId,
      payload: {},
    });
    return { ok: true, result: { combat: command, qlab: result } };
  }

  private async runPreset(envelope: CommandEnvelope, actor: ActorContext): Promise<CommandOutcome> {
    assertCapability(actor.capabilities, 'runShowPreset');
    const preset = this.tables.getPreset(String(envelope.payload.presetId));
    if (!preset) throw new ProtocolError('not_found', 'Preset not found.');
    const steps: Array<{ type: string; status: PresetStepStatus; detail?: unknown }> = [];
    const showSource = actor.role === 'admin' || actor.role === 'dm' || actor.role === 'system' || actor.role === 'midi' || actor.role === 'bridge' ? actor.role : 'dm';
    for (const step of preset.steps) {
      try {
        if (step.type === 'qlab' || step.type === 'qlab_cue') {
          const cue = String(step.payload.cueName ?? step.payload.cueNumber ?? '');
          const result = await this.engine.fireShowCue(cue, { source: showSource, actorId: actor.userId });
          const status: PresetStepStatus = result.qlab?.confirmed ? 'ok' : result.status === 'unconfirmed' ? 'unconfirmed' : result.ok ? 'ok' : 'failed';
          steps.push({ type: step.type, status, detail: result });
        } else if (step.type === 'activate_scene' || step.type === 'scene.activate') {
          this.setInstanceStatus({ ...envelope, payload: step.payload, type: 'scene.activate' }, actor, 'live', 'activateScene');
          steps.push({ type: step.type, status: 'ok' });
        } else if (step.type === 'announcement') {
          this.engine.store.updateGameState(envelope.sessionId, { global_announcement: String(step.payload.text ?? '') });
          steps.push({ type: step.type, status: 'ok' });
        } else {
          steps.push({ type: step.type, status: 'skipped' });
        }
      } catch (error) {
        steps.push({ type: step.type, status: 'failed', detail: error instanceof Error ? error.message : 'failed' });
      }
    }
    this.append(envelope, actor, String(envelope.payload.presetId), 0, 'vtt.preset.ran', { steps });
    return { ok: true, result: { steps } };
  }

  private rundown(envelope: CommandEnvelope, actor: ActorContext): CommandOutcome {
    assertCapability(actor.capabilities, 'advanceRundown');
    const items = this.tables.listRundown(envelope.sessionId);
    const current = items.find((item) => item.state === 'live') ?? items.find((item) => item.state === 'ready');
    if (!current) throw new ProtocolError('not_found', 'Rundown is empty.');
    const index = items.findIndex((item) => item.id === current.id);
    if (envelope.type === 'rundown.skip') {
      this.tables.putRundown({ ...current, state: 'skipped', ended_at: stamp() });
    } else if (envelope.type === 'rundown.goBack') {
      this.tables.putRundown({ ...current, state: 'ready', started_at: null });
      const prev = items[index - 1];
      if (prev) this.tables.putRundown({ ...prev, state: 'live', started_at: stamp() });
    } else {
      this.tables.putRundown({ ...current, state: 'completed', ended_at: stamp() });
      const next = items[index + 1];
      if (next) this.tables.putRundown({ ...next, state: 'live', started_at: stamp() });
    }
    const list = this.tables.listRundown(envelope.sessionId);
    this.append(envelope, actor, current.id, 0, 'vtt.rundown.changed', { items: list });
    return { ok: true, result: { rundown: list } };
  }

  private handout(envelope: CommandEnvelope, actor: ActorContext): CommandOutcome {
    assertCapability(actor.capabilities, 'viewHandout');
    const handout = this.tables.getHandout(String(envelope.payload.handoutId));
    if (!handout) throw new ProtocolError('not_found', 'Handout not found.');
    if (handout.visibility === 'dm' && !actor.capabilities.includes('viewHiddenToken')) {
      throw new ProtocolError('forbidden', 'Handout is DM-only.');
    }
    return this.mutateLive(envelope, actor, 'runShowPreset', (state) => {
      if (envelope.type === 'handout.show') {
        if (!state.visibleHandoutIds.includes(handout.id)) state.visibleHandoutIds.push(handout.id);
      } else {
        state.visibleHandoutIds = state.visibleHandoutIds.filter((id) => id !== handout.id);
      }
      return { handout: handout.id, visible: state.visibleHandoutIds };
    }, 'vtt.handout');
  }

  private poll(envelope: CommandEnvelope, actor: ActorContext): CommandOutcome {
    assertCapability(actor.capabilities, 'runShowPreset');
    if (envelope.type === 'poll.open') {
      const poll = this.engine.openPoll({
        question: envelope.payload.question,
        options: envelope.payload.options ?? ['Yes', 'No'],
      });
      this.append(envelope, actor, poll.id, 0, 'vtt.poll', { pollId: poll.id });
      return { ok: true, result: { poll } };
    }
    const poll = this.engine.managePoll(String(envelope.payload.pollId), 'close');
    this.append(envelope, actor, poll.id, 0, 'vtt.poll', { pollId: poll.id, closed: true });
    return { ok: true, result: { poll } };
  }

  private checkpointCreate(envelope: CommandEnvelope, actor: ActorContext): CommandOutcome {
    assertCapability(actor.capabilities, 'restoreCheckpoint');
    const instance = this.requireInstance(envelope);
    const row = this.tables.putCheckpoint({
      id: createId(),
      session_id: envelope.sessionId,
      instance_id: instance.id,
      label: String(envelope.payload.label ?? 'checkpoint'),
      state: structuredClone(instance.state),
      created_at: stamp(),
      created_by: actor.userId,
    });
    this.append(envelope, actor, instance.id, instance.version, 'vtt.checkpoint.created', { checkpointId: row.id });
    return { ok: true, result: { checkpoint: { id: row.id, label: row.label } } };
  }

  private checkpointPreview(envelope: CommandEnvelope, actor: ActorContext): CommandOutcome {
    assertCapability(actor.capabilities, 'restoreCheckpoint');
    const row = this.tables.getCheckpoint(String(envelope.payload.checkpointId));
    if (!row) throw new ProtocolError('not_found', 'Checkpoint not found.');
    return { ok: true, result: { preview: row.state, mutatesLive: false } };
  }

  private checkpointRestore(envelope: CommandEnvelope, actor: ActorContext): CommandOutcome {
    assertCapability(actor.capabilities, 'restoreCheckpoint');
    const row = this.tables.getCheckpoint(String(envelope.payload.checkpointId));
    if (!row) throw new ProtocolError('not_found', 'Checkpoint not found.');
    const instance = this.tables.getInstance(row.instance_id);
    if (!instance) throw new ProtocolError('not_found', 'Instance not found.');
    const updated = this.tables.putInstance({
      ...instance,
      state: structuredClone(row.state),
      version: instance.version + 1,
      updated_at: stamp(),
    });
    this.append(envelope, actor, instance.id, updated.version, 'vtt.checkpoint.restored', {
      checkpointId: row.id,
      audit: true,
      state: structuredClone(row.state),
    });
    return { ok: true, version: updated.version, result: { instance: updated, restored: row.id } };
  }

  private focusInitiative(envelope: CommandEnvelope, actor: ActorContext): CommandOutcome {
    const session = this.engine.store.getGameState(envelope.sessionId);
    const order = this.engine.store.listInitiative(envelope.sessionId);
    const current = order[session.current_turn];
    return this.mutateLive(envelope, actor, 'controlCamera', (state) => {
      const token = current ? state.tokens.find((item) => item.playerId === current.participant_id || item.initiativeId === current.id) : undefined;
      if (token) state.camera = { ...state.camera, x: token.x, y: token.y };
      return { camera: state.camera, tokenId: token?.id ?? null };
    }, 'vtt.camera.changed');
  }

  async handleRegisteredAction(action: string, payload: Record<string, unknown>, actor: ActorContext, sessionId: string): Promise<CommandOutcome> {
    if (action === 'production_action') {
      if (!this.engine.production.enabled) throw new ProtocolError('unavailable', 'Production is disabled on this engine.');
      const run = await this.engine.production.executeAction(
        String(payload.deploymentId ?? ''),
        String(payload.actionId ?? ''),
        actor
      );
      const qlab = run.steps.find((step) => step.qlab)?.qlab;
      const failed = run.steps.some((step) => step.status === 'failed');
      const unconfirmed = run.steps.some((step) => step.status === 'unconfirmed');
      return { ok: !failed && !unconfirmed, result: { run, qlab } };
    }
    if (!this.enabled) throw new ProtocolError('unavailable', 'VTT is disabled on this engine.');
    if (!isRegisteredAction(action)) throw new ProtocolError('invalid_request', `Unknown registered action: ${action}`);
    const map: Record<string, CommandEnvelope['type']> = {
      show_preset: 'showPreset.run',
      stage_scene: 'scene.stage',
      activate_scene: 'scene.activate',
      advance_rundown: 'rundown.advance',
      go_back: 'rundown.goBack',
      next_turn: 'combat.nextTurn',
      previous_turn: 'combat.previousTurn',
      focus_active_token: 'camera.focusInitiative',
      camera_preset: 'camera.activatePreset',
      fog_region: 'fog.reveal',
      open_poll: 'poll.open',
      close_poll: 'poll.close',
      show_handout: 'handout.show',
      hide_handout: 'handout.hide',
      recording_marker: 'recording.marker',
    };
    const showSource = actor.role === 'admin' || actor.role === 'dm' || actor.role === 'system' || actor.role === 'midi' || actor.role === 'bridge' ? actor.role : 'dm';
    if (action === 'qlab_cue') {
      const result = await this.engine.fireShowCue(String(payload.cueName ?? payload.cueNumber ?? ''), {
        source: showSource,
        actorId: actor.userId,
      });
      return { ok: result.ok, result: { qlab: result } };
    }
    if (action === 'panic') {
      const result = await this.engine.panic({ source: showSource, actorId: actor.userId });
      return { ok: result.ok, result: { qlab: result } };
    }
    if (action === 'production_action') {
      if (!this.engine.production) throw new ProtocolError('unavailable', 'Production runtime is not attached.');
      const run = await this.engine.production.executeAction(
        String(payload.deploymentId ?? ''),
        String(payload.actionId ?? ''),
        actor
      );
      const steps = Array.isArray((run as { steps?: Array<{ status: string }> })?.steps)
        ? (run as { steps: Array<{ status: string }> }).steps
        : [];
      const unconfirmed = steps.some((step) => step.status === 'unconfirmed');
      const failed = steps.some((step) => step.status === 'failed' || step.status === 'blocked');
      return { ok: !unconfirmed && !failed, result: { run } };
    }
    const type = map[action];
    return this.execute(
      { id: createId(), protocolVersion: PROTOCOL_VERSION, type, sessionId, payload },
      actor
    );
  }

  createEncounter(name: string, members: Array<Partial<TokenRecord> & { name: string }>) {
    return this.tables.putEncounter({ id: createId(), name, members, created_at: stamp() });
  }

  createPreset(name: string, steps: Array<{ type: string; payload: Record<string, unknown> }>) {
    return this.tables.putPreset({ id: createId(), name, steps, created_at: stamp() });
  }

  addRundown(sessionId: string, title: string, extra: Partial<{ scene_id: string; preset_id: string; cue_name: string; poll_id: string; handout_id: string; notes: string }> = {}) {
    const sort = this.tables.listRundown(sessionId).length;
    return this.tables.putRundown({
      id: createId(),
      session_id: sessionId,
      title,
      sort_order: sort,
      state: sort === 0 ? 'live' : 'ready',
      notes: extra.notes ?? '',
      expected_duration_ms: null,
      scene_id: extra.scene_id ?? null,
      preset_id: extra.preset_id ?? null,
      cue_name: extra.cue_name ?? null,
      poll_id: extra.poll_id ?? null,
      handout_id: extra.handout_id ?? null,
      started_at: sort === 0 ? stamp() : null,
      ended_at: null,
    });
  }

  createHandout(title: string, body: string, visibility: 'public' | 'players' | 'dm' = 'public') {
    return this.tables.putHandout({
      id: createId(),
      title,
      kind: 'markdown',
      body,
      asset_id: null,
      visibility,
      version: 1,
      created_at: stamp(),
      updated_at: stamp(),
    });
  }

  createNote(kind: 'dm' | 'shared' | 'private', body: string, authorId: string | null) {
    return this.tables.putNote({ id: createId(), kind, body, author_id: authorId, scene_id: null, version: 1, updated_at: stamp() });
  }

  createWebhook(url: string, secret: string, events: string[]) {
    return this.tables.putWebhook({
      id: createId(),
      url,
      secret_hash: hashBridgeToken(secret),
      secret,
      events,
      created_at: stamp(),
    });
  }

  library(sessionId: string) {
    return {
      scenes: this.tables.listScenes('default').map((scene) => ({
        id: scene.id,
        title: scene.title,
        status: scene.status,
        version: scene.version,
      })),
      instances: this.tables.listInstances(sessionId).map((instance) => ({
        id: instance.id,
        status: instance.status,
        sceneId: instance.scene_id,
        title: instance.state.title,
      })),
      presets: this.tables.listPresets().map((preset) => ({ id: preset.id, name: preset.name })),
      handouts: this.tables.listHandouts().map((handout) => ({ id: handout.id, title: handout.title })),
      rundown: this.tables.listRundown(sessionId),
      qlab: this.engine.health().qlab,
    };
  }

  uploadAsset(buffer: Buffer, name: string, actor: ActorContext, mime?: string) {
    assertCapability(actor.capabilities, 'manageAssets');
    return this.assets.store(buffer, name, actor.userId, mime);
  }

  exportScene(sceneId: string) {
    const scene = this.tables.getScene(sceneId);
    if (!scene) throw new ProtocolError('not_found', 'Scene not found.');
    return exportScenePackage(scene.title, scene.draft, []);
  }

  importScene(raw: unknown, actor: ActorContext, sessionId: string) {
    assertCapability(actor.capabilities, 'prepareScene');
    const pack = importScenePackage(raw);
    const created = this.createScene(
      {
        id: createId(),
        protocolVersion: PROTOCOL_VERSION,
        type: 'scene.create',
        sessionId,
        payload: { title: pack.scene.title, document: pack.scene.document },
      },
      actor
    );
    return created;
  }

  importZip(buffer: Buffer, actor: ActorContext, sessionId: string) {
    const entries = extractZipEntries(buffer);
    const json = entries.find((entry) => entry.name.endsWith('.json'));
    if (!json) throw new ProtocolError('invalid_request', 'Archive missing scene JSON.');
    return this.importScene(JSON.parse(json.data.toString('utf8')), actor, sessionId);
  }

  preflight(sessionId: string) {
    const checks: Array<{ code: string; level: 'ok' | 'warn' | 'fail'; message: string; action: string }> = [];
    const push = (code: string, level: 'ok' | 'warn' | 'fail', message: string, action: string) => {
      checks.push({ code, level, message, action });
    };

    let dbAvailable = true;
    let dbWritable = true;
    try {
      if (this.engine.store instanceof SqliteStore) {
        this.engine.store.database.prepare('SELECT 1').get();
        this.engine.store.database.prepare(`SELECT count(*) as c FROM schema_migrations`).get();
      }
      this.engine.store.getActiveSession();
    } catch (error) {
      dbAvailable = false;
      dbWritable = false;
      push('database', 'fail', 'Database is not available.', error instanceof Error ? error.message : 'Repair the SQLite file.');
    }
    if (dbAvailable) push('database', 'ok', 'Database is reachable and readable.', 'None.');

    let migrationsOk = true;
    let applied: string[] = [];
    if (this.engine.store instanceof SqliteStore) {
      applied = migrationStatus(this.engine.store.database).map((row) => row.id);
      const missing = MIGRATIONS.filter((migration) => !applied.includes(migration.id)).map((migration) => migration.id);
      if (missing.length) {
        migrationsOk = false;
        push('migrations', 'fail', `Missing migrations: ${missing.join(', ')}.`, 'Restart the engine so pending migrations apply.');
      } else {
        push('migrations', 'ok', `All ${applied.length} migrations applied.`, 'None.');
      }
    } else {
      push('migrations', 'ok', 'Memory store does not require SQL migrations.', 'None.');
    }

    const status = this.engine.health();
    if (this.engine.qlab.kind === 'dry-run') {
      push('qlab', 'ok', 'QLab dry-run is active (acknowledgements are simulated).', 'Connect a live workspace for dress rehearsal.');
    } else if (!status.qlab.connected) {
      push('qlab', 'warn', `QLab is disconnected (${status.qlab.lastError ?? 'no error'}).`, 'Open QLab, enable OSC, or switch to dry-run.');
    } else if (!status.qlab.authenticated && status.qlab.lastError) {
      push('qlab-auth', 'warn', 'QLab is reachable but not authenticated.', 'Set the workspace passcode on the engine config.');
    } else {
      push('qlab', 'ok', `QLab linked ${status.qlab.host}:${status.qlab.port}.`, 'None.');
    }

    const cueList = this.engine.cues.list();
    const cueCount = Object.keys(cueList).length;
    if (cueCount === 0) push('cues', 'warn', 'Show cue map is empty.', 'Load numbered cues on the show map.');
    else push('cues', 'ok', `${cueCount} show cues mapped.`, 'None.');

    const midi = this.engine.store.getConfig();
    if (!midi.bridgeTokenHash) {
      push('midi', 'warn', 'MIDI bridge token is not configured.', 'Rotate a bridge token for the MIDI host.');
    } else {
      push('midi', 'ok', 'MIDI bridge token is present.', 'None.');
    }

    const live = this.tables.liveInstance(sessionId);
    const staged = this.tables.listInstances(sessionId).find((row) => row.status === 'staged');
    for (const [label, instance] of [
      ['live', live],
      ['staged', staged],
    ] as const) {
      if (!instance) {
        if (label === 'live') push('live-scene', 'warn', 'No live scene is active.', 'Stage and activate a published scene.');
        continue;
      }
      if (instance.state.mapAssetId) {
        const asset = this.tables.getAsset(instance.state.mapAssetId);
        if (!asset) push(`${label}-asset`, 'fail', `${label} map asset is missing.`, 'Re-upload the map and update the scene draft.');
        else if (asset.variants.length < 3) push(`${label}-variants`, 'warn', `${label} map is missing display/thumb variants.`, 'Re-upload the map so variants are generated.');
        else push(`${label}-asset`, 'ok', `${label} map asset ${asset.hash.slice(0, 8)} is present.`, 'None.');
      } else {
        push(`${label}-asset`, 'warn', `${label} scene has no map asset.`, 'Attach a PNG/WebP/WebM map in preparation.');
      }
      const missingArt = instance.state.tokens.filter((token) => token.assetId && !this.tables.getAsset(token.assetId));
      if (missingArt.length) {
        push(`${label}-token-art`, 'warn', `${missingArt.length} tokens on the ${label} scene are missing art.`, 'Re-assign token artwork.');
      }
    }

    const drafts = this.tables.listScenes('default').filter((scene) => scene.status === 'draft');
    if (drafts.length) push('drafts', 'warn', `${drafts.length} unpublished draft(s).`, 'Publish or archive leftover drafts.');
    else push('drafts', 'ok', 'No unsaved published-scene drafts.', 'None.');

    const expired = this.tables.listClients(sessionId).length;
    push('clients', 'ok', `${expired} remembered client(s); ${this.engine.store.listPlayers(sessionId).length} players in session.`, 'None.');

    const failedHooks = this.tables.listDeliveries().filter((row) => row.status === 'failed');
    if (failedHooks.length) push('webhooks', 'warn', `${failedHooks.length} webhook delivery failure(s).`, 'Inspect webhook secrets and retry.');
    else push('webhooks', 'ok', 'No failed webhook deliveries.', 'None.');

    const unconfirmed = this.engine.store.listFireLog(50).filter((entry) => entry.status === 'unconfirmed' || !entry.confirmed);
    if (unconfirmed.length) {
      push('unconfirmed', 'warn', `${unconfirmed.length} recent unconfirmed QLab/fire actions.`, 'Re-fire or confirm the QLab workspace is accepting OSC.');
    } else {
      push('unconfirmed', 'ok', 'No recent unconfirmed fire-log entries.', 'None.');
    }

    push(
      'protocol',
      'ok',
      `Protocol version ${PROTOCOL_VERSION}.`,
      'Keep clients on the same protocol version.'
    );
    push(
      'rehearsal',
      this.engine.qlab.kind === 'dry-run' ? 'ok' : 'ok',
      this.engine.qlab.kind === 'dry-run' ? 'Rehearsal/dry-run mode is on.' : 'Live QLab driver is selected.',
      this.engine.qlab.kind === 'dry-run' ? 'Switch to TCP QLab for the house.' : 'None.'
    );

    const hasFail = checks.some((check) => check.level === 'fail');
    const hasWarn = checks.some((check) => check.level === 'warn');
    const ready = !dbAvailable || !dbWritable || !migrationsOk || hasFail ? 'not_ready' : hasWarn ? 'ready_with_warnings' : 'ready';
    return {
      ready,
      checks,
      warnings: checks.filter((check) => check.level !== 'ok').map((check) => ({
        code: check.code,
        message: check.message,
        action: check.action,
      })),
      qlab: status.qlab,
      migrations: applied,
      rehearsal: this.engine.qlab.kind === 'dry-run',
      protocolVersion: PROTOCOL_VERSION,
    };
  }

  replayFrames(sessionId: string) {
    return this.tables.listEvents(sessionId, 0).map((event) => ({
      sequence: event.sequence,
      at: event.timestamp,
      type: event.type,
      summary: event.type,
      category: categorizeReplay(event.type),
      commandId: event.commandId,
      unconfirmed: event.type === 'vtt.qlab.result' && event.payload.status === 'unconfirmed',
      error: typeof event.payload.error === 'string' ? event.payload.error : null,
    }));
  }

  replay(sessionId: string) {
    return this.replayFrames(sessionId);
  }

  replayAt(sessionId: string, at: number, actor: ActorContext) {
    const instance = this.tables.liveInstance(sessionId) ?? this.tables.listInstances(sessionId)[0] ?? null;
    const liveVersion = instance?.version ?? 0;
    const frames = this.replayFrames(sessionId);
    if (!instance) {
      return { frames, live: null, at, liveMutated: false, liveVersion };
    }
    const revision = this.tables.getRevision(instance.revision_id);
    let state = revision ? liveFromDocument(revision.document) : structuredClone(instance.state);
    for (const event of this.tables.listEvents(sessionId, 0)) {
      if (event.sequence > at) break;
      state = applyReplayEvent(state, event);
    }
    const game = this.engine.store.getGameState(sessionId);
    const projected = projectInstance(
      { ...instance, state, last_event_sequence: at },
      actor,
      {
        players: this.engine.store.listPlayers(sessionId),
        combat: { mode: game.combat_mode, round: game.round_number, currentTurn: game.current_turn },
        initiative: this.engine.store.listInitiative(sessionId),
        lastEventSequence: at,
        assets: this.tables.listAssets(),
      }
    );
    projected.sessionId = sessionId;
    const after = this.tables.getInstance(instance.id);
    if (after && after.version !== liveVersion) {
      throw new ProtocolError('invalid_request', 'Replay reconstruction mutated live state.');
    }
    return {
      frames,
      live: projected.live,
      at,
      liveMutated: false,
      liveVersion: after?.version ?? liveVersion,
    };
  }

  exportReplayJson(sessionId: string) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      sessionId,
      liveMutated: false,
      frames: this.replayFrames(sessionId),
      markers: this.tables.listMarkers(sessionId),
    };
  }

  exportReplayCsv(sessionId: string): string {
    const header = 'sequence,at,category,type,commandId,unconfirmed,error';
    const rows = this.replayFrames(sessionId).map((frame) =>
      [frame.sequence, frame.at, frame.category, frame.type, frame.commandId, frame.unconfirmed ? '1' : '0', frame.error ?? ''].join(',')
    );
    return [header, ...rows].join('\n');
  }

  exportChapterMarkers(sessionId: string) {
    return this.tables.listMarkers(sessionId);
  }

  pushEphemeral(event: Record<string, unknown>): void {
    const at = Date.now();
    this.ephemeral.push({ at, event });
    this.ephemeral = this.ephemeral.filter((item) => at - item.at < 4000);
  }

  listEphemeral(): Record<string, unknown>[] {
    const now = Date.now();
    return this.ephemeral.filter((item) => now - item.at < 4000).map((item) => item.event);
  }

  signWebhook(body: string, secret: string): string {
    return createHmac('sha256', secret).update(body).digest('hex');
  }

  private async fanoutWebhooks(type: string, payload: Record<string, unknown>): Promise<void> {
    const body = JSON.stringify({ type, payload, at: nowIso() });
    for (const hook of this.tables.listWebhooks()) {
      if (hook.events.length && !hook.events.includes(type) && !hook.events.includes('*')) continue;
      const secret = hook.secret ?? '';
      const signature = this.signWebhook(body, secret);
      let status = 'queued';
      let attempts = 0;
      let lastError: string | null = null;
      while (attempts < 3 && status !== 'ok') {
        attempts += 1;
        try {
          const response = await fetch(hook.url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-actualplay-signature': signature,
            },
            body,
          });
          if (response.ok) status = 'ok';
          else {
            status = 'failed';
            lastError = `HTTP ${response.status}`;
          }
        } catch (error) {
          status = 'failed';
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
      this.tables.recordDelivery(createId(), hook.id, type, status, attempts, lastError);
    }
  }

  private mutateLive(
    envelope: CommandEnvelope,
    actor: ActorContext,
    cap: Parameters<typeof assertCapability>[1],
    mutate: (state: LiveState) => Record<string, unknown>,
    eventType: DurableEvent['type'] = 'vtt.token.changed'
  ): CommandOutcome {
    assertCapability(actor.capabilities, cap);
    const instance = this.requireInstance(envelope);
    if (envelope.expectedVersion !== undefined && envelope.expectedVersion !== instance.version) {
      throw new ProtocolError('version_conflict', 'Scene instance version conflict.');
    }
    const state = structuredClone(instance.state);
    const extra = mutate(state);
    const updated = this.tables.putInstance({
      ...instance,
      state,
      version: instance.version + 1,
      updated_at: stamp(),
    });
    const event = this.append(envelope, actor, updated.id, updated.version, eventType, extra);
    updated.last_event_sequence = event.sequence;
    this.tables.putInstance(updated);
    return { ok: true, version: updated.version, sequence: event.sequence, result: { instanceId: updated.id, version: updated.version, ...extra } };
  }

  private append(
    envelope: CommandEnvelope,
    actor: ActorContext,
    aggregateId: string,
    aggregateVersion: number,
    type: DurableEvent['type'],
    payload: Record<string, unknown>
  ): DurableEvent {
    const event = this.tables.appendEvent({
      protocolVersion: PROTOCOL_VERSION,
      sessionId: envelope.sessionId,
      aggregateType: 'vtt',
      aggregateId,
      aggregateVersion,
      type,
      actorId: actor.userId,
      source: actor.role,
      payload,
      timestamp: stamp(),
      commandId: envelope.id,
    });
    this.engine.events.emit('session.updated', { sequence: event.sequence, type: event.type });
    return event;
  }

  private requireInstance(envelope: CommandEnvelope): InstanceRow {
    const fromPayload = typeof envelope.payload.instanceId === 'string' ? envelope.payload.instanceId : undefined;
    const id = envelope.sceneInstanceId ?? fromPayload ?? this.tables.liveInstance(envelope.sessionId)?.id;
    const instance = id ? this.tables.getInstance(id) : null;
    if (!instance) throw new ProtocolError('scene_not_active', 'No live or targeted scene instance.');
    return instance;
  }

  private requireToken(state: LiveState, id: string): TokenRecord {
    const token = state.tokens.find((item) => item.id === id);
    if (!token) throw new ProtocolError('not_found', 'Token not found.');
    return token;
  }

  private assertTokenControl(actor: ActorContext, token: TokenRecord): void {
    if (actor.capabilities.includes('manageTokens') || actor.capabilities.includes('assignTokenOwner')) return;
    if (actor.viewer === 'player' && (token.ownerUserId === actor.userId || token.playerId === actor.playerId)) return;
    throw new ProtocolError('forbidden', 'Not allowed to control this token.');
  }
}

export function tablesFor(engine: ActualPlayEngine): VttTables {
  if (engine.store instanceof SqliteStore) {
    return new SqliteVttTables(engine.store.database);
  }
  return new MemoryVttTables();
}


