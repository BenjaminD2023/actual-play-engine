import { createHash } from 'node:crypto';
import {
  ProtocolError,
  PROTOCOL_VERSION,
  type ActorContext,
  type SceneDocument,
  type TokenRecord,
  type VttCommandType,
} from '@actualplay/protocol';
import type { ActualPlayEngine } from '../engine.js';
import { createId, nowIso } from '../ids.js';
import { SqliteStore } from '../store/sqlite.js';
import { defaultGrid } from '../vtt/geometry.js';
import { defaultLayers, defaultVision, emptyDocument, makeToken } from '../vtt/model.js';
import { ProductionError } from './errors.js';
import { emptyProject, manifestFromProject, packChecksum, parseManifest, parseProject, validateProject } from './spec.js';
import { MemoryProductionTables, SqliteProductionTables, type ProductionTables } from './tables.js';
import {
  EXTERNAL_STEP_KINDS,
  type ActionRun,
  type ActionRunStep,
  type ActionStep,
  type ActorBinding,
  type CueBinding,
  type DeploymentRecord,
  type ImportReport,
  type PackedAsset,
  type PreflightReport,
  type ProductionAction,
  type ProductionProject,
  type RevisionDiff,
  type RevisionRow,
  type SceneRecord,
  type StepStatus,
} from './types.js';
import { createZip, extractZipEntries } from './zip.js';

export interface ProductionRuntimeOptions {
  enabled?: boolean;
  tables?: ProductionTables;
}

export class ProductionRuntime {
  readonly enabled: boolean;
  readonly tables: ProductionTables;

  constructor(
    private readonly engine: ActualPlayEngine,
    options: ProductionRuntimeOptions = {}
  ) {
    this.enabled = options.enabled === true;
    this.tables = options.tables ?? tablesFor(engine);
  }

  static exportPack(project: ProductionProject, assets: PackedAsset[] = []): Buffer {
    return exportProductionPack(project, assets);
  }

  exportPack(project: ProductionProject, assets: PackedAsset[] = []): Buffer {
    return exportProductionPack(project, assets);
  }

  importPack(buffer: Buffer, actor: ActorContext): ImportReport {
    this.assertEnabled();
    this.assertOperator(actor, 'import');
    const entries = extractZipEntries(buffer);
    const manifestEntry = entries.find((entry) => entry.name === 'manifest.json' || entry.name.endsWith('/manifest.json'));
    const projectEntry = entries.find((entry) => entry.name === 'project.json' || entry.name.endsWith('/project.json'));
    if (!manifestEntry || !projectEntry) {
      throw new ProductionError('invalid_pack', 'Archive must contain manifest.json and project.json.');
    }
    const manifest = parseManifest(JSON.parse(manifestEntry.data.toString('utf8')));
    const checksumsEntry = entries.find(entry => entry.name === 'checksums.json');
    if (checksumsEntry) {
      let checksums: Record<string, unknown>;
      try { checksums = JSON.parse(checksumsEntry.data.toString('utf8')) as Record<string, unknown>; }
      catch { throw new ProductionError('checksum_mismatch', 'Invalid checksums.json.'); }
      if (!checksums || typeof checksums !== 'object' || Array.isArray(checksums)) throw new ProductionError('checksum_mismatch', 'Invalid checksums.json.');
      for (const entry of entries) {
        if (entry.name === 'checksums.json') continue;
        if (checksums[entry.name] !== createHash('sha256').update(entry.data).digest('hex')) throw new ProductionError('checksum_mismatch', `Checksum mismatch for ${entry.name}.`);
      }
      for (const name of Object.keys(checksums)) if (!entries.some(entry => entry.name === name)) throw new ProductionError('checksum_mismatch', `Missing archive entry ${name}.`);
    } else if (!manifest.checksum) {
      throw new ProductionError('checksum_mismatch', 'Pack is missing checksums.json.');
    }
    const project = parseProject(JSON.parse(projectEntry.data.toString('utf8')));
    const packedAssets: PackedAsset[] = [];
    for (const asset of [...manifest.assets, ...project.assets]) {
      if (packedAssets.some((item) => item.id === asset.id)) continue;
      const file =
        entries.find((entry) => entry.name === `assets/${asset.hash}`) ??
        entries.find((entry) => entry.name === `assets/${asset.id}`) ??
        entries.find((entry) => entry.name.endsWith(`/${asset.hash}`)) ??
        entries.find((entry) => entry.name.endsWith(`/${asset.originalName}`));
      if (!file) throw new ProductionError('invalid_pack', `Missing asset bytes for ${asset.id}.`);
      const hash = createHash('sha256').update(file.data).digest('hex');
      if (hash !== asset.hash) throw new ProductionError('checksum_mismatch', `Asset hash mismatch for ${asset.id}.`);
      if (file.data.byteLength !== asset.byteSize) {
        throw new ProductionError('invalid_pack', `Asset size mismatch for ${asset.id}.`);
      }
      packedAssets.push({ ...asset, data: file.data });
    }
    const checksum = packChecksum(project, packedAssets.map((asset) => asset.hash));
    if (manifest.checksum && manifest.checksum !== checksum) {
      throw new ProductionError('checksum_mismatch', 'Pack checksum mismatch.');
    }
    const validation = validateProject(project);
    const errors = validation.issues.filter((issue) => issue.level === 'error');
    const warnings = validation.issues.filter((issue) => issue.level !== 'error');
    if (!validation.ok) {
      throw new ProductionError('publication_blocked', 'Pack failed validation.', { issues: errors });
    }
    const existing = this.tables.getRevisionByChecksum(checksum);
    const revision: RevisionRow = existing ??
      this.tables.putRevision({
        id: createId(),
        projectId: project.id,
        title: project.title,
        author: project.author,
        checksum,
        manifest: { ...manifest, checksum, revisionId: manifest.revisionId || createId() },
        project,
        assets: packedAssets,
        createdAt: nowIso(),
        createdBy: actor.userId,
      });
    return {
      revisionId: revision.id,
      checksum: revision.checksum,
      manifest: revision.manifest,
      compatible: true,
      security: [],
      validation,
      requiredBindings: project.cueSlots.filter((slot) => slot.required).map((slot) => slot.id),
      actorSlots: project.actors.filter((item) => item.bindingSlot).map((item) => item.id),
      warnings,
      errors,
    };
  }

  createDeployment(
    input: { revisionId: string; sessionId?: string; dmUserIds?: string[] },
    actor: ActorContext
  ): DeploymentRecord {
    this.assertEnabled();
    this.assertOperator(actor, 'deploy');
    const revision = this.requireRevision(input.revisionId);
    const sessionId = input.sessionId ?? this.engine.store.getActiveSession()?.id ?? this.engine.ensureSession().id;
    const deployment: DeploymentRecord = {
      id: createId(),
      packageRevisionId: revision.id,
      sessionId,
      status: 'draft',
      cueBindings: [],
      actorBindings: [],
      dmUserIds: input.dmUserIds ?? (actor.userId ? [actor.userId] : []),
      published: false,
      previousDeploymentId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      publishedAt: null,
    };
    this.tables.putDeployment(deployment);
    this.tables.setVariables(
      deployment.id,
      Object.fromEntries(revision.project.variables.map((variable) => [variable.id, variable.defaultValue]))
    );
    return this.tables.getDeployment(deployment.id)!;
  }

  bindCue(deploymentId: string, binding: CueBinding, actor: ActorContext): DeploymentRecord {
    this.assertEnabled();
    this.assertOperator(actor, 'bind');
    const deployment = this.requireDeployment(deploymentId);
    const revision = this.requireRevision(deployment.packageRevisionId);
    if (!revision.project.cueSlots.some((slot) => slot.id === binding.slotId)) {
      throw new ProductionError('not_found', `Cue slot ${binding.slotId} is not in this pack.`);
    }
    this.tables.putCueBinding(deploymentId, {
      slotId: binding.slotId,
      kind: binding.kind,
      cueName: binding.cueName ?? null,
      cueNumber: binding.cueNumber ?? null,
      oscTemplateId: binding.oscTemplateId ?? null,
      tested: Boolean(binding.tested),
      lastResult: binding.lastResult ?? null,
      acceptedWarning: binding.acceptedWarning ?? null,
    });
    return this.tables.getDeployment(deploymentId)!;
  }

  bindActor(deploymentId: string, binding: ActorBinding, actor: ActorContext): DeploymentRecord {
    this.assertEnabled();
    this.assertOperator(actor, 'bind');
    const deployment = this.requireDeployment(deploymentId);
    const revision = this.requireRevision(deployment.packageRevisionId);
    if (!revision.project.actors.some((item) => item.id === binding.actorId)) {
      throw new ProductionError('not_found', `Actor ${binding.actorId} is not in this pack.`);
    }
    this.tables.putActorBinding(deploymentId, {
      actorId: binding.actorId,
      playerId: binding.playerId ?? null,
      userId: binding.userId ?? null,
    });
    return this.tables.getDeployment(deploymentId)!;
  }

  preflight(deploymentId: string, _actor?: ActorContext): PreflightReport {
    this.assertEnabled();
    const deployment = this.requireDeployment(deploymentId);
    const revision = this.requireRevision(deployment.packageRevisionId);
    const checks: PreflightReport['checks'] = [];
    const push = (code: string, level: PreflightReport['checks'][number]['level'], message: string, action: string) => {
      checks.push({ code, level, message, action });
    };
    const bindings = new Map(deployment.cueBindings.map((binding) => [binding.slotId, binding]));
    for (const slot of revision.project.cueSlots) {
      const binding = bindings.get(slot.id);
      if (!binding) {
        if (slot.required) {
          push(
            `slot-${slot.id}`,
            'fail',
            `Required cue slot "${slot.name}" is unbound.`,
            `Bind slot ${slot.key} to a show cue or QLab number.`
          );
        }
        continue;
      }
      if (binding.kind === 'show_cue') {
        const name = binding.cueName ?? slot.suggestedCueName;
        if (!name || !this.engine.cues.has(name)) {
          push(
            `slot-${slot.id}`,
            slot.required ? 'fail' : 'warn',
            `Show cue "${name ?? slot.key}" is not on the cue map.`,
            'Map the semantic slot to a numbered QLab cue.'
          );
        } else {
          push(`slot-${slot.id}`, 'ok', `Cue slot "${slot.name}" is bound.`, 'None.');
        }
      } else if (binding.kind === 'cue_number' && !binding.cueNumber) {
        push(`slot-${slot.id}`, slot.required ? 'fail' : 'warn', `Slot "${slot.name}" has no cue number.`, 'Set a cue number.');
      } else {
        push(`slot-${slot.id}`, 'ok', `Cue slot "${slot.name}" is bound (${binding.kind}).`, 'None.');
      }
    }
    const health = this.engine.health();
    if (this.engine.qlab.kind === 'dry-run') {
      push('qlab', 'ok', 'QLab dry-run is active.', 'Connect a live workspace for dress rehearsal.');
    } else if (!health.qlab.connected) {
      push('qlab', 'warn', 'QLab is disconnected.', 'Open QLab and enable OSC.');
    } else {
      push('qlab', 'ok', `QLab linked ${health.qlab.host}:${health.qlab.port}.`, 'None.');
    }
    const hasFail = checks.some((check) => check.level === 'fail');
    const hasWarn = checks.some((check) => check.level === 'warn');
    const ready = hasFail ? 'not_ready' : hasWarn ? 'ready_with_warnings' : 'ready';
    return {
      ready,
      checks,
      warnings: checks.filter((check) => check.level !== 'ok').map((check) => ({
        code: check.code,
        message: check.message,
        action: check.action,
      })),
    };
  }

  async rehearse(deploymentId: string, actor: ActorContext): Promise<DeploymentRecord> {
    this.assertEnabled();
    this.assertOperator(actor, 'rehearse');
    const report = this.preflight(deploymentId, actor);
    if (report.ready === 'not_ready') {
      throw new ProductionError('not_ready', 'Deployment is not ready for rehearsal.', { checks: report.checks });
    }
    await this.materialize(deploymentId, actor, false);
    const deployment = this.requireDeployment(deploymentId);
    return this.tables.putDeployment({
      ...deployment,
      status: 'ready',
      updatedAt: nowIso(),
    });
  }

  async publishDeployment(deploymentId: string, actor: ActorContext): Promise<DeploymentRecord> {
    this.assertEnabled();
    this.assertOperator(actor, 'publish');
    const report = this.preflight(deploymentId, actor);
    if (report.ready === 'not_ready') {
      throw new ProductionError('not_ready', 'Deployment is not ready to publish.', { checks: report.checks });
    }
    await this.materialize(deploymentId, actor, true);
    const deployment = this.requireDeployment(deploymentId);
    const live = this.tables.listDeployments(deployment.sessionId).find((row) => row.id !== deployment.id && row.status === 'live');
    if (live) {
      this.tables.putDeployment({ ...live, status: 'archived', published: false, updatedAt: nowIso() });
    }
    return this.tables.putDeployment({
      ...deployment,
      status: 'live',
      published: true,
      previousDeploymentId: live?.id ?? deployment.previousDeploymentId ?? null,
      publishedAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  async rollbackDeployment(deploymentId: string, actor: ActorContext): Promise<DeploymentRecord> {
    this.assertEnabled();
    this.assertOperator(actor, 'rollback');
    const deployment = this.requireDeployment(deploymentId);
    const previousId = deployment.previousDeploymentId;
    if (!previousId) throw new ProductionError('not_found', 'No previous deployment to restore.');
    const previous = this.requireDeployment(previousId);
    this.tables.putDeployment({ ...deployment, status: 'archived', published: false, updatedAt: nowIso() });
    await this.materialize(previous.id, actor, true);
    return this.tables.putDeployment({
      ...previous,
      status: 'live',
      published: true,
      updatedAt: nowIso(),
      publishedAt: nowIso(),
    });
  }

  private pendingRuns = new Map<string, { key: string; promise: Promise<ActionRun> }>();

  async executeAction(deploymentId: string, actionId: string, actor: ActorContext | { userId?: string | null; role: string }, runId = createId()): Promise<ActionRun> {
    const key = JSON.stringify([deploymentId, actionId, actor.userId, actor.role]);
    const pending = this.pendingRuns.get(runId);
    if (pending) {
      if (pending.key !== key) throw new ProductionError('invalid_request', 'Action run id reused with different input.');
      return pending.promise;
    }
    const promise = Promise.resolve().then(() => this.executeActionNow(deploymentId, actionId, actor, runId));
    this.pendingRuns.set(runId, { key, promise });
    try { return await promise; } finally { this.pendingRuns.delete(runId); }
  }

  private async executeActionNow(
    deploymentId: string,
    actionId: string,
    actor: ActorContext | { userId?: string | null; role: string },
    runId?: string
  ): Promise<ActionRun> {
    this.assertEnabled();
    const resolved = this.resolveActor(actor);
    this.assertCanExecute(deploymentId, resolved);
    if (runId) {
      const existing = this.tables.getRun(runId);
      if (existing) {
        if (existing.deploymentId !== deploymentId || existing.actionId !== actionId || existing.actorId !== resolved.userId) throw new ProductionError('invalid_request', 'Action run id belongs to another input or actor.');
        return existing;
      }
    }
    const deployment = this.requireDeployment(deploymentId);
    const revision = this.requireRevision(deployment.packageRevisionId);
    const action = revision.project.actions.find((item) => item.id === actionId);
    if (!action) throw new ProductionError('not_found', `Action ${actionId} was not found.`);
    const variables = this.tables.getVariables(deploymentId);
    if (!evaluate(action.availableWhen, variables)) {
      throw new ProductionError('not_ready', `Action ${action.name} is not available.`);
    }
    if (this.tables.listSceneMaps(deploymentId).length === 0) {
      await this.materialize(deploymentId, resolved, deployment.status === 'live');
    }
    const run: ActionRun = {
      id: runId ?? createId(),
      deploymentId,
      actionId,
      actorId: resolved.userId,
      startedAt: nowIso(),
      endedAt: null,
      steps: [],
    };
    const ctx: StepContext = {
      actor: resolved,
      deployment: this.requireDeployment(deploymentId),
      project: revision.project,
      variables,
      haltExternal: false,
      haltAll: false,
      runId: run.id,
    };
    await this.runSteps(action.steps, ctx, run);
    run.endedAt = nowIso();
    this.tables.setVariables(deploymentId, ctx.variables);
    return this.tables.putRun(run);
  }

  async retryExternal(runId: string, actor: ActorContext | { userId?: string | null; role: string }): Promise<ActionRun> {
    this.assertEnabled();
    const resolved = this.resolveActor(actor);
    const run = this.tables.getRun(runId);
    if (!run) throw new ProductionError('not_found', 'Action run was not found.');
    this.assertCanExecute(run.deploymentId, resolved);
    const deployment = this.requireDeployment(run.deploymentId);
    const revision = this.requireRevision(deployment.packageRevisionId);
    const action = revision.project.actions.find((item) => item.id === run.actionId);
    if (!action) throw new ProductionError('not_found', 'Action was not found.');
    const ctx: StepContext = {
      actor: resolved,
      deployment,
      project: revision.project,
      variables: this.tables.getVariables(run.deploymentId),
      haltExternal: false,
      haltAll: false,
      runId: run.id,
      retryNonce: createId(),
    };
    const stepsById = new Map<string, ActionStep>();
    walk(action.steps, (step) => stepsById.set(step.id, step));
    for (const recorded of run.steps) {
      if (!recorded.external) continue;
      if (recorded.status !== 'unconfirmed' && recorded.status !== 'failed') continue;
      const step = stepsById.get(recorded.stepId);
      if (!step) continue;
      const next = await this.executeStep(step, ctx);
      recorded.status = next.status;
      recorded.detail = next.detail;
      recorded.qlab = next.qlab;
    }
    run.endedAt = nowIso();
    this.tables.setVariables(run.deploymentId, ctx.variables);
    return this.tables.putRun(run);
  }

  diffRevisions(fromId: string, toId: string): RevisionDiff {
    this.assertEnabled();
    const from = this.requireRevision(fromId);
    const to = this.requireRevision(toId);
    const a = flatten(from.project);
    const b = flatten(to.project);
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(key in a)) added.push(key);
      else if (!(key in b)) removed.push(key);
      else if (a[key] !== b[key]) changed.push(key);
    }
    return { from: fromId, to: toId, added, removed, changed };
  }

  getDeployment(deploymentId: string, actor: ActorContext): DeploymentRecord {
    this.assertEnabled();
    const deployment = this.requireDeployment(deploymentId);
    if (this.isPrivilegedViewer(actor)) return deployment;
    return {
      ...deployment,
      cueBindings: [],
    };
  }

  listControls(deploymentId: string, actor: ActorContext) {
    this.assertEnabled();
    const deployment = this.requireDeployment(deploymentId);
    const revision = this.requireRevision(deployment.packageRevisionId);
    const variables = this.tables.getVariables(deploymentId);
    const privileged = this.isPrivilegedViewer(actor);
    return revision.project.pages
      .map((page) => ({
        ...page,
        controls: page.controls.filter((control) => {
          if (isCueBindingControl(control) && actor.role !== 'admin') return false;
          if (!evaluate(control.condition, variables)) return false;
          if (!control.actionId) return control.kind === 'heading' || control.kind === 'status';
          const action = revision.project.actions.find((item) => item.id === control.actionId);
          if (!action) return false;
          if (privileged) return true;
          return action.visibleTo.includes('player') || action.visibleTo.includes('audience');
        }),
      }))
      .filter((page) => page.controls.length > 0)
      .sort((a, b) => a.order - b.order);
  }

  currentDeployment(sessionId?: string): DeploymentRecord | null {
    const sid = sessionId ?? this.engine.store.getActiveSession()?.id;
    const list = this.tables.listDeployments(sid);
    return list.find((row) => row.status === 'live') ?? list.at(-1) ?? null;
  }

  async testBinding(deploymentId: string, slotId: string, actor: ActorContext): Promise<CueBinding> {
    this.assertEnabled();
    this.assertOperator(actor, 'test');
    const deployment = this.requireDeployment(deploymentId);
    const revision = this.requireRevision(deployment.packageRevisionId);
    const slot = revision.project.cueSlots.find((item) => item.id === slotId);
    if (!slot) throw new ProductionError('not_found', `Cue slot ${slotId} was not found.`);
    let binding = deployment.cueBindings.find((item) => item.slotId === slotId);
    if (!binding) throw new ProductionError('not_found', `Cue slot ${slotId} is unbound.`);
    const meta = { source: this.showSource(actor), actorId: actor.userId };
    let status: StepStatus = 'failed';
    let detail = 'untested';
    try {
      if (binding.kind === 'noop') {
        status = 'skipped';
        detail = 'noop';
      } else if (binding.kind === 'dry_run') {
        status = 'ok';
        detail = 'dry-run';
      } else if (binding.kind === 'show_cue' && (binding.cueName || slot.suggestedCueName)) {
        const result = await this.engine.fireShowCue(binding.cueName || slot.suggestedCueName, meta);
        status = result.status === 'unconfirmed' ? 'unconfirmed' : result.ok ? 'ok' : 'failed';
        detail = result.error ?? result.status;
      } else if (binding.cueNumber) {
        const result = await this.engine.dispatch({
          id: createId(),
          type: 'qlab.start',
          source: meta.source,
          actorId: meta.actorId ?? null,
          payload: { cueNumber: binding.cueNumber },
        });
        status = result.status === 'unconfirmed' ? 'unconfirmed' : result.ok ? 'ok' : 'failed';
        detail = result.error ?? result.status;
      } else {
        detail = 'No cue mapped';
      }
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
      status = 'failed';
    }
    binding = {
      ...binding,
      tested: status === 'ok',
      lastResult: status,
      acceptedWarning: status === 'ok' ? null : detail,
    };
    this.tables.putCueBinding(deploymentId, binding);
    return binding;
  }

  emptyProject(input?: { title?: string; author?: string }): ProductionProject {
    return emptyProject(input);
  }

  private async materialize(deploymentId: string, actor: ActorContext, activate: boolean): Promise<void> {
    const deployment = this.requireDeployment(deploymentId);
    const revision = this.requireRevision(deployment.packageRevisionId);
    const vttActor = this.vttActor(actor);
    const sessionId = deployment.sessionId;
    const assetMap = new Map<string, string>();
    for (const asset of revision.assets) {
      const stored = this.engine.vtt.uploadAsset(asset.data, asset.originalName, vttActor, asset.mime);
      assetMap.set(asset.id, stored.id);
      this.tables.putIdMap(deploymentId, 'asset', asset.id, stored.id);
    }
    const existing = this.tables.listSceneMaps(deploymentId);
    for (const scene of revision.project.scenes) {
      let map = existing.find((row) => row.packSceneId === scene.id);
      if (!map) {
        const document = this.toSceneDocument(scene, revision.project, assetMap, deployment);
        const created = await this.engine.vtt.execute(
          {
            id: createId(),
            protocolVersion: PROTOCOL_VERSION,
            type: 'scene.create',
            sessionId,
            payload: {
              title: scene.title,
              campaignId: 'default',
              mapAssetId: scene.mapAssetId ? assetMap.get(scene.mapAssetId) ?? null : null,
              document,
            },
          },
          vttActor
        );
        const vttSceneId = (created.result.scene as { id: string }).id;
        await this.engine.vtt.execute(
          { id: createId(), protocolVersion: PROTOCOL_VERSION, type: 'scene.publish', sessionId, payload: { sceneId: vttSceneId } },
          vttActor
        );
        const inst = await this.engine.vtt.execute(
          {
            id: createId(),
            protocolVersion: PROTOCOL_VERSION,
            type: 'scene.instantiate',
            sessionId,
            payload: { sceneId: vttSceneId },
          },
          vttActor
        );
        const instanceId = (inst.result.instance as { id: string }).id;
        await this.engine.vtt.execute(
          {
            id: createId(),
            protocolVersion: PROTOCOL_VERSION,
            type: 'scene.stage',
            sessionId,
            sceneInstanceId: instanceId,
            payload: { instanceId },
          },
          vttActor
        );
        map = { packSceneId: scene.id, vttSceneId, vttInstanceId: instanceId };
        this.tables.putSceneMap(deploymentId, map);
      }
      if (activate && scene.id === revision.project.scenes[0]?.id && map.vttInstanceId) {
        await this.engine.vtt.execute(
          {
            id: createId(),
            protocolVersion: PROTOCOL_VERSION,
            type: 'scene.activate',
            sessionId,
            sceneInstanceId: map.vttInstanceId,
            payload: { instanceId: map.vttInstanceId },
          },
          vttActor
        );
      }
    }
    for (const encounter of revision.project.encounters) {
      if (this.tables.getIdMap(deploymentId, 'encounter', encounter.id)) continue;
      const members = encounter.memberActorIds
        .map((id) => revision.project.actors.find((item) => item.id === id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .map((item) => ({
          name: item.name,
          disposition: item.disposition,
          visibility: item.hiddenByDefault ? ('hidden' as const) : ('visible' as const),
        }));
      const created = this.engine.vtt.createEncounter(encounter.name, members);
      this.tables.putIdMap(deploymentId, 'encounter', encounter.id, created.id);
    }
    for (const handout of revision.project.handouts) {
      if (this.tables.getIdMap(deploymentId, 'handout', handout.id)) continue;
      const created = this.engine.vtt.createHandout(handout.title, handout.body, handout.visibility === 'dm' ? 'dm' : 'public');
      this.tables.putIdMap(deploymentId, 'handout', handout.id, created.id);
    }
  }

  private toSceneDocument(
    scene: SceneRecord,
    project: ProductionProject,
    assetMap: Map<string, string>,
    deployment: DeploymentRecord
  ): SceneDocument {
    const grid = {
      ...defaultGrid(scene.grid.mode),
      size: scene.grid.size,
      offsetX: scene.grid.offsetX,
      offsetY: scene.grid.offsetY,
      opacity: scene.grid.opacity,
      unitsPerCell: scene.grid.unitsPerCell,
      unitName: scene.grid.unitName,
    };
    const walls: SceneDocument['walls'] = scene.annotations.filter(isWallAnnotation).flatMap((annotation) =>
      annotation.points.slice(1).map((point, i) => ({
        id: `wall:${annotation.id}:${i}`, a: annotation.points[i]!, b: point,
        blockingVision: true, blockingMovement: true, dmOnly: annotation.dmOnly, kind: 'wall' as const,
      }))
    );
    const doors = [];
    for (const door of scene.doors) {
      const wallId = `wall:${door.id}`;
      walls.push({
        id: wallId,
        a: door.wall.a,
        b: door.wall.b,
        blockingVision: true,
        blockingMovement: true,
        dmOnly: door.secret,
        kind: 'wall' as const,
      });
      doors.push({
        id: door.id,
        wallId,
        state: door.initialState,
        secret: door.secret,
        dmOnly: door.secret,
      });
    }
    for (const door of scene.windows) {
      const wallId = `wall:${door.id}`;
      walls.push({
        id: wallId,
        a: door.wall.a,
        b: door.wall.b,
        blockingVision: false,
        blockingMovement: false,
        dmOnly: door.secret,
        kind: 'window' as const,
      });
    }
    const tokens: TokenRecord[] = scene.tokens.map((placement) => {
      const packActor = project.actors.find((item) => item.id === placement.actorId);
      const binding = deployment.actorBindings.find((item) => item.actorId === placement.actorId);
      return makeToken({
        id: placement.id,
        name: packActor?.name ?? 'Token',
        x: placement.x,
        y: placement.y,
        width: packActor?.size ?? 70,
        height: packActor?.size ?? 70,
        assetId: packActor?.tokenAssetId ? assetMap.get(packActor.tokenAssetId) ?? null : null,
        visibility: placement.hidden || packActor?.hiddenByDefault ? 'hidden' : 'visible',
        locked: placement.locked,
        disposition: packActor?.disposition ?? 'neutral',
        ownerUserId: binding?.userId ?? null,
        playerId: binding?.playerId ?? null,
        dmLabel: packActor?.dmLabel ?? null,
        vision: { ...defaultVision(), distance: packActor?.visionDistance ?? 420 },
      });
    });
    const draft = emptyDocument(scene.title, scene.grid.mode);
    return {
      ...draft,
      title: scene.title,
      notes: scene.notes,
      mapAssetId: scene.mapAssetId ? assetMap.get(scene.mapAssetId) ?? null : null,
      animated: scene.animated,
      grid,
      layers: defaultLayers(),
      tokens,
      walls,
      doors,
      lights: scene.lights.map((light) => ({
        id: light.id,
        x: light.x,
        y: light.y,
        bright: light.bright,
        dim: light.dim,
        color: light.color,
        enabled: true,
        darkness: false,
      })),
      cameras: scene.cameras.map((camera) => ({
        id: camera.id,
        name: camera.name,
        camera: { x: camera.x, y: camera.y, zoom: camera.zoom, rotation: 0 },
        audience: camera.audience,
      })),
      fog: scene.fogRegions.map(region => ({ id: region.id, kind: region.kind, shape: region.shape, points: region.points, createdAt: nowIso(), actorId: null })),
      annotations: scene.annotations.filter((ann) => !isWallAnnotation(ann)).map((ann) => ({
        id: ann.id,
        kind: ann.kind === 'arrow' ? 'arrow' : 'text',
        points: ann.points,
        text: ann.text,
        color: '#ffffff',
        dmOnly: ann.dmOnly,
        strokeWidth: 2,
      })),
    };
  }

  private async runSteps(steps: ActionStep[], ctx: StepContext, run: ActionRun): Promise<void> {
    for (const step of steps) {
      if (ctx.haltAll) {
        run.steps.push({
          stepId: step.id,
          kind: step.kind,
          status: 'skipped',
          detail: 'Halted',
          external: EXTERNAL_STEP_KINDS.has(step.kind),
        });
        continue;
      }
      if (ctx.haltExternal && EXTERNAL_STEP_KINDS.has(step.kind)) {
        run.steps.push({
          stepId: step.id,
          kind: step.kind,
          status: 'skipped',
          detail: 'External steps halted',
          external: true,
        });
        continue;
      }
      const recorded = await this.executeStep(step, ctx);
      run.steps.push(recorded);
      if (recorded.status === 'failed' || recorded.status === 'unconfirmed') {
        if (step.onFailure === 'halt_all') ctx.haltAll = true;
        if (step.onFailure === 'halt_external') ctx.haltExternal = true;
      }
      if (step.kind === 'sequential' && step.children) await this.runSteps(step.children, ctx, run);
      if (step.kind === 'parallel' && step.children) {
        for (const child of step.children) await this.runSteps([child], ctx, run);
      }
      if ((step.kind === 'condition' || step.kind === 'branch') && recorded.status === 'ok') {
        const passed = recorded.detail === 'then';
        await this.runSteps(passed ? step.then ?? [] : step.else ?? [], ctx, run);
      }
    }
  }

  private async executeStep(step: ActionStep, ctx: StepContext): Promise<ActionRunStep> {
    const external = EXTERNAL_STEP_KINDS.has(step.kind);
    const fail = (detail: string, status: StepStatus = 'failed'): ActionRunStep => ({
      stepId: step.id,
      kind: step.kind,
      status,
      detail,
      external,
    });
    try {
      switch (step.kind) {
        case 'open_door':
        case 'close_door':
        case 'lock_door':
        case 'unlock_door': {
          const doorId = String(step.params.doorId ?? '');
          const state = step.kind === 'open_door' ? 'open' : step.kind === 'lock_door' ? 'locked' : 'closed';
          await this.vttCommand(ctx, 'door.setState', { doorId, state }, this.instanceFor(ctx, step));
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: state, external };
        }
        case 'reveal_fog':
        case 'hide_fog': {
          const regionId = String(step.params.regionId ?? '');
          const region = ctx.project.scenes.flatMap((scene) => scene.fogRegions).find((item) => item.id === regionId);
          if (!region) return fail('Fog region not found');
          await this.vttCommand(
            ctx,
            step.kind === 'reveal_fog' ? 'fog.reveal' : 'fog.hide',
            { shape: region.shape, points: region.points },
            this.instanceFor(ctx, step, region.sceneId)
          );
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: regionId, external };
        }
        case 'toggle_vtt_light':
        case 'activate_vtt_light_state': {
          const lightId = String(step.params.lightId ?? '');
          await this.vttCommand(
            ctx,
            'light.update',
            { lightId, enabled: step.params.enabled !== false },
            this.instanceFor(ctx, step)
          );
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: lightId, external };
        }
        case 'reveal_token':
        case 'hide_token': {
          const tokenId = String(step.params.tokenId ?? '');
          await this.vttCommand(
            ctx,
            'token.setVisibility',
            { tokenId, visibility: step.kind === 'reveal_token' ? 'visible' : 'hidden' },
            this.instanceFor(ctx, step)
          );
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: tokenId, external };
        }
        case 'move_token': {
          await this.vttCommand(
            ctx,
            'token.move',
            { tokenId: String(step.params.tokenId ?? ''), x: Number(step.params.x ?? 0), y: Number(step.params.y ?? 0) },
            this.instanceFor(ctx, step)
          );
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: 'moved', external };
        }
        case 'set_token_condition': {
          await this.vttCommand(
            ctx,
            'token.setCondition',
            {
              tokenId: String(step.params.tokenId ?? ''),
              condition: String(step.params.condition ?? ''),
              remove: Boolean(step.params.remove),
            },
            this.instanceFor(ctx, step)
          );
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: 'condition', external };
        }
        case 'spawn_encounter':
        case 'remove_encounter': {
          const packId = String(step.params.encounterId ?? '');
          const encounterId = this.tables.getIdMap(ctx.deployment.id, 'encounter', packId) ?? packId;
          await this.vttCommand(
            ctx,
            step.kind === 'spawn_encounter' ? 'encounter.spawn' : 'encounter.remove',
            { encounterId, spawnId: encounterId, x: Number(step.params.x ?? 0), y: Number(step.params.y ?? 0) },
            this.instanceFor(ctx, step)
          );
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: packId, external };
        }
        case 'show_annotation':
        case 'hide_annotation': {
          const annotationId = String(step.params.annotationId ?? '');
          if (step.kind === 'hide_annotation') {
            await this.vttCommand(ctx, 'annotation.delete', { annotationId }, this.instanceFor(ctx, step));
          } else {
            await this.vttCommand(
              ctx,
              'annotation.upsert',
              { annotationId, text: String(step.params.text ?? ''), kind: 'text', points: step.params.points ?? [{ x: 0, y: 0 }] },
              this.instanceFor(ctx, step)
            );
          }
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: annotationId, external };
        }
        case 'camera_preset': {
          await this.vttCommand(
            ctx,
            'camera.activatePreset',
            { presetId: String(step.params.presetId ?? step.params.cameraId ?? '') },
            this.instanceFor(ctx, step)
          );
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: 'camera', external };
        }
        case 'focus_token': {
          await this.vttCommand(
            ctx,
            'camera.focusToken',
            { tokenId: String(step.params.tokenId ?? '') },
            this.instanceFor(ctx, step)
          );
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: 'focus', external };
        }
        case 'focus_region': {
          const x = Number(step.params.x ?? 0);
          const y = Number(step.params.y ?? 0);
          await this.vttCommand(ctx, 'camera.set', { x, y }, this.instanceFor(ctx, step));
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: 'region', external };
        }
        case 'activate_scene':
        case 'stage_scene': {
          const instanceId = this.instanceFor(ctx, step);
          await this.vttCommand(
            ctx,
            step.kind === 'activate_scene' ? 'scene.activate' : 'scene.stage',
            { instanceId },
            instanceId
          );
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: instanceId, external };
        }
        case 'show_announcement':
        case 'clear_announcement': {
          await this.vttCommand(
            ctx,
            step.kind === 'show_announcement' ? 'announcement.show' : 'announcement.clear',
            { text: String(step.params.text ?? '') },
            this.instanceFor(ctx, step)
          );
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: 'announcement', external };
        }
        case 'show_handout':
        case 'hide_handout': {
          const packId = String(step.params.handoutId ?? '');
          const handoutId = this.tables.getIdMap(ctx.deployment.id, 'handout', packId) ?? packId;
          await this.vttCommand(ctx, step.kind === 'show_handout' ? 'handout.show' : 'handout.hide', { handoutId }, this.instanceFor(ctx, step));
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: packId, external };
        }
        case 'open_poll': {
          const poll = this.engine.openPoll({
            question: String(step.params.question ?? 'Vote'),
            options: Array.isArray(step.params.options) ? step.params.options : ['Yes', 'No'],
          });
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: poll.id, external };
        }
        case 'close_poll': {
          this.engine.managePoll(String(step.params.pollId ?? ''), 'close');
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: 'closed', external };
        }
        case 'recording_marker': {
          await this.vttCommand(
            ctx,
            'recording.marker',
            { label: String(step.params.label ?? step.label) },
            this.instanceFor(ctx, step)
          );
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: 'marker', external };
        }
        case 'notify_operator':
        case 'emit_event': {
          this.engine.events.emit('session.updated', { production: step.kind, message: String(step.params.message ?? step.label) });
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: 'emitted', external };
        }
        case 'start_combat': {
          const cueName = String(step.params.cueName ?? 'combat.battle-1');
          await this.engine.startCombat(cueName, { source: this.showSource(ctx.actor), actorId: ctx.actor.userId });
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: cueName, external };
        }
        case 'advance_initiative': {
          await this.engine.dispatch({
            id: createId(),
            type: 'combat.next_turn',
            source: this.showSource(ctx.actor),
            actorId: ctx.actor.userId,
            payload: {},
          });
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: 'turn', external };
        }
        case 'set_variable':
        case 'increment_variable':
        case 'toggle_variable': {
          const variableId = String(step.params.variableId ?? '');
          const current = ctx.variables[variableId];
          if (step.kind === 'toggle_variable') ctx.variables[variableId] = !current;
          else if (step.kind === 'increment_variable') {
            ctx.variables[variableId] = (typeof current === 'number' ? current : 0) + Number(step.params.amount ?? 1);
          } else {
            ctx.variables[variableId] = step.params.value as boolean | number | string;
          }
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: String(ctx.variables[variableId]), external };
        }
        case 'delay': {
          const ms = Math.max(0, Math.min(Number(step.params.ms ?? 0), 5000));
          if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: String(ms), external };
        }
        case 'fire_sound_slot':
        case 'stop_sound_slot':
        case 'activate_sound_state':
        case 'fire_stage_light_slot':
        case 'activate_stage_light_state':
        case 'fire_video_slot':
        case 'fire_generic_slot': {
          const slotId = String(
            step.params.slotId ??
              ctx.project.soundStates.find((item) => item.id === step.params.stateId)?.slotId ??
              ctx.project.stageLightStates.find((item) => item.id === step.params.stateId)?.slotId ??
              ctx.project.videoStates.find((item) => item.id === step.params.stateId)?.slotId ??
              ''
          );
          return this.fireSlot(step, ctx, slotId, step.kind === 'stop_sound_slot' ? 'stop' : 'start');
        }
        case 'sequential':
        case 'parallel':
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: 'group', external };
        case 'condition':
        case 'branch': {
          const passed = evaluate(
            step.params.condition
              ? (step.params.condition as ProductionAction['availableWhen'])
              : parseMaybeCondition(step.params),
            ctx.variables
          );
          return { stepId: step.id, kind: step.kind, status: 'ok', detail: passed ? 'then' : 'else', external };
        }
        default:
          throw new ProductionError('unknown_step', `Unknown step kind ${step.kind}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail(message);
    }
  }

  private async fireSlot(step: ActionStep, ctx: StepContext, slotId: string, mode: 'start' | 'stop'): Promise<ActionRunStep> {
    const binding = ctx.deployment.cueBindings.find((item) => item.slotId === slotId);
    const slot = ctx.project.cueSlots.find((item) => item.id === slotId);
    if (!binding) {
      return {
        stepId: step.id,
        kind: step.kind,
        status: slot?.required ? 'blocked' : 'skipped',
        detail: 'Unbound cue slot',
        external: true,
      };
    }
    if (binding.kind === 'noop' || binding.kind === 'dry_run') {
      this.tables.putCueBinding(ctx.deployment.id, { ...binding, lastResult: 'ok', tested: true });
      return { stepId: step.id, kind: step.kind, status: 'ok', detail: binding.kind, external: true };
    }
    const showSource = this.showSource(ctx.actor);
    const commandId = ctx.retryNonce ? `${ctx.runId}:${step.id}:${ctx.retryNonce}` : `${ctx.runId}:${step.id}`;
    let result: { ok: boolean; status: string; qlab?: { confirmed: boolean; status: string; error?: string | null }; error?: string };
    if (binding.kind === 'show_cue') {
      const name = binding.cueName ?? slot?.suggestedCueName ?? '';
      result = await this.engine.fireShowCue(name, { source: showSource, actorId: ctx.actor.userId, id: commandId });
    } else if (binding.kind === 'cue_number') {
      const cueNumber = String(binding.cueNumber ?? '');
      result = await this.engine.dispatch({
        id: commandId,
        type: mode === 'stop' ? 'qlab.stopCue' : 'qlab.start',
        source: showSource,
        actorId: ctx.actor.userId,
        payload: { cueNumber },
      });
    } else if (binding.kind === 'approved_osc' && binding.oscTemplateId) {
      const address = binding.oscTemplateId.startsWith('/') ? binding.oscTemplateId : `/cue/${binding.oscTemplateId}/${mode === 'stop' ? 'stop' : 'start'}`;
      result = await this.engine.dispatch({
        id: createId(),
        type: 'qlab.custom',
        source: showSource,
        actorId: ctx.actor.userId,
        payload: { address },
      });
    } else {
      return { stepId: step.id, kind: step.kind, status: 'failed', detail: 'Unsupported cue binding', external: true };
    }
    const qlab = result.qlab ?? { confirmed: Boolean(result.ok), status: result.status, error: result.error };
    const status: StepStatus = qlab.confirmed && qlab.status === 'ok' ? 'ok' : qlab.status === 'unconfirmed' ? 'unconfirmed' : 'failed';
    this.tables.putCueBinding(ctx.deployment.id, { ...binding, lastResult: status, tested: true });
    ctx.deployment.cueBindings = this.tables.listCueBindings(ctx.deployment.id);
    return {
      stepId: step.id,
      kind: step.kind,
      status,
      detail: qlab.error ?? qlab.status,
      qlab: { confirmed: Boolean(qlab.confirmed), status: qlab.status, error: qlab.error ?? null },
      external: true,
    };
  }

  private async vttCommand(ctx: StepContext, type: VttCommandType, payload: Record<string, unknown>, instanceId: string) {
    return this.engine.vtt.execute(
      {
        id: createId(),
        protocolVersion: PROTOCOL_VERSION,
        type,
        sessionId: ctx.deployment.sessionId,
        sceneInstanceId: instanceId || undefined,
        payload: { ...payload, instanceId },
      },
      this.vttActor(ctx.actor)
    );
  }

  private instanceFor(ctx: StepContext, step: ActionStep, sceneId?: string): string {
    const packSceneId = sceneId ?? (typeof step.params.sceneId === 'string' ? step.params.sceneId : null);
    const maps = this.tables.listSceneMaps(ctx.deployment.id);
    const mapped = packSceneId ? maps.find((row) => row.packSceneId === packSceneId) : maps[0];
    const fromAction = ctx.project.actions.find((item) => item.steps.some((child) => child.id === step.id));
    const viaAction = fromAction?.sceneId ? maps.find((row) => row.packSceneId === fromAction.sceneId) : undefined;
    const instanceId = mapped?.vttInstanceId ?? viaAction?.vttInstanceId ?? maps[0]?.vttInstanceId;
    if (!instanceId) throw new ProductionError('not_ready', 'No scene instance is bound for this deployment.');
    return instanceId;
  }

  private resolveActor(actor: ActorContext | { userId?: string | null; role: string }): ActorContext {
    if ('capabilities' in actor && Array.isArray((actor as ActorContext).capabilities)) {
      return actor as ActorContext;
    }
    const role =
      actor.role === 'admin' ||
      actor.role === 'dm' ||
      actor.role === 'player' ||
      actor.role === 'audience' ||
      actor.role === 'midi' ||
      actor.role === 'bridge' ||
      actor.role === 'system'
        ? actor.role
        : 'dm';
    return this.engine.vtt.actorFrom({ userId: actor.userId ?? null, role });
  }

  private vttActor(actor: ActorContext): ActorContext {
    return this.engine.vtt.actorFrom({
      userId: actor.userId,
      role: actor.role === 'admin' ? 'admin' : 'dm',
      viewer: 'dm',
    });
  }

  private showSource(actor: ActorContext): 'admin' | 'dm' | 'system' | 'midi' | 'bridge' {
    if (actor.role === 'admin' || actor.role === 'dm' || actor.role === 'system' || actor.role === 'midi' || actor.role === 'bridge') {
      return actor.role;
    }
    return 'dm';
  }

  private assertEnabled(): void {
    if (!this.enabled) throw new ProtocolError('unavailable', 'Production is disabled on this engine.');
  }

  private assertOperator(actor: ActorContext, _op: string): void {
    if (actor.role === 'player' || actor.role === 'audience' || actor.viewer === 'player' || actor.viewer === 'audience') {
      throw new ProtocolError('forbidden', 'This role cannot manage production deployments.');
    }
  }

  private assertCanExecute(deploymentId: string, actor: ActorContext): void {
    if (actor.role === 'player' || actor.role === 'audience' || actor.viewer === 'player' || actor.viewer === 'audience') {
      throw new ProtocolError('forbidden', 'Players cannot execute production actions.');
    }
    if (actor.role === 'admin' || actor.role === 'dm' || actor.role === 'system' || actor.role === 'midi' || actor.role === 'bridge') {
      return;
    }
    const deployment = this.requireDeployment(deploymentId);
    if (actor.userId && deployment.dmUserIds.includes(actor.userId)) return;
    throw new ProtocolError('forbidden', 'Not allowed to execute this deployment.');
  }

  private isPrivilegedViewer(actor: ActorContext): boolean {
    return actor.role === 'admin' || actor.role === 'dm' || actor.viewer === 'admin' || actor.viewer === 'dm' || actor.viewer === 'operator';
  }

  private requireRevision(id: string): RevisionRow {
    const row = this.tables.getRevision(id);
    if (!row) throw new ProductionError('not_found', 'Pack revision was not found.');
    return row;
  }

  private requireDeployment(id: string): DeploymentRecord {
    const row = this.tables.getDeployment(id);
    if (!row) throw new ProductionError('not_found', 'Deployment was not found.');
    return row;
  }
}

interface StepContext {
  actor: ActorContext;
  deployment: DeploymentRecord;
  project: ProductionProject;
  variables: Record<string, boolean | number | string>;
  haltExternal: boolean;
  haltAll: boolean;
  runId: string;
  retryNonce?: string;
}

function evaluate(
  condition: ProductionAction['availableWhen'] | unknown,
  variables: Record<string, boolean | number | string>
): boolean {
  if (!condition || typeof condition !== 'object') return true;
  const rec = condition as { kind?: string; variableId?: string; op?: string; value?: unknown; mode?: string; clauses?: unknown[] };
  if (rec.kind === 'group' || rec.clauses) {
    const clauses = (rec.clauses ?? []) as ProductionAction['availableWhen'][];
    if (clauses.length === 0) return true;
    return rec.mode === 'any'
      ? clauses.some((clause) => evaluate(clause, variables))
      : clauses.every((clause) => evaluate(clause, variables));
  }
  if (!rec.variableId || !rec.op) return true;
  const current = variables[rec.variableId];
  if (rec.op === 'is_false') return current === false;
  if (rec.op === 'is_true') return current === true;
  if (rec.op === 'eq') return current === rec.value;
  if (rec.op === 'neq') return current !== rec.value;
  if (rec.op === 'gt') return typeof current === 'number' && typeof rec.value === 'number' && current > rec.value;
  if (rec.op === 'lt') return typeof current === 'number' && typeof rec.value === 'number' && current < rec.value;
  if (rec.op === 'contains') return typeof current === 'string' && typeof rec.value === 'string' && current.includes(rec.value);
  return true;
}

function parseMaybeCondition(params: Record<string, unknown>): ProductionAction['availableWhen'] {
  if (params.variableId && params.op) {
    return {
      kind: 'atom',
      variableId: String(params.variableId),
      op: params.op as 'is_true',
      value: params.value as boolean | number | string | undefined,
    };
  }
  return null;
}

function walk(steps: ActionStep[], visit: (step: ActionStep) => void): void {
  for (const step of steps) {
    visit(step);
    if (step.children) walk(step.children, visit);
    if (step.then) walk(step.then, visit);
    if (step.else) walk(step.else, visit);
  }
}

export function isCueBindingControl(control: { group: string; label: string; description: string; id: string }): boolean {
  const group = control.group.toLowerCase();
  if (group === 'bindings' || group === 'cue-binding' || group === 'cue-bindings' || group === 'admin') return true;
  const blob = `${control.label} ${control.description} ${control.id}`.toLowerCase();
  return /\bcue number\b|\bpasscode\b|\bcue-binding\b|\bbinding editor\b/.test(blob);
}

function flatten(value: unknown, path = '$'): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(value)) {
    value.forEach((item, i) => Object.assign(out, flatten(item, `${path}[${i}]`)));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      Object.assign(out, flatten(child, `${path}.${key}`));
    }
    return out;
  }
  out[path] = JSON.stringify(value);
  return out;
}

export function exportProductionPack(project: ProductionProject, assets: PackedAsset[] = []): Buffer {
  const parsed = parseProject(JSON.parse(JSON.stringify(project)));
  const report = validateProject(parsed);
  if (!report.ok) {
    throw new ProductionError('publication_blocked', 'Cannot export a pack with validation errors.', {
      issues: report.issues.filter((issue) => issue.level === 'error'),
    });
  }
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const packed: PackedAsset[] = parsed.assets.map((asset) => {
    const data = byId.get(asset.id)?.data;
    if (!data) throw new ProductionError('invalid_pack', `Missing asset bytes for ${asset.id}.`);
    const hash = createHash('sha256').update(data).digest('hex');
    if (hash !== asset.hash) throw new ProductionError('checksum_mismatch', `Asset hash mismatch for ${asset.id}.`);
    return { ...asset, data };
  });
  const checksum = packChecksum(parsed, packed.map((asset) => asset.hash));
  const revisionId = parsed.publishedRevisionId ?? createId();
  const manifest = manifestFromProject({ ...parsed, publishedRevisionId: revisionId }, revisionId, checksum);
  const entries = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    { name: 'project.json', data: Buffer.from(JSON.stringify(parsed), 'utf8') },
    ...packed.map((asset) => ({ name: `assets/${asset.id}`, data: asset.data })),
  ];
  const checksums = Object.fromEntries(entries.map((entry) => [entry.name, createHash('sha256').update(entry.data).digest('hex')]));
  entries.push({ name: 'checksums.json', data: Buffer.from(JSON.stringify(checksums)) });
  return createZip(entries);
}

function tablesFor(engine: ActualPlayEngine): ProductionTables {
  if (engine.store instanceof SqliteStore) return new SqliteProductionTables(engine.store.database);
  return new MemoryProductionTables();
}

function isWallAnnotation(annotation: SceneRecord['annotations'][number]): boolean {
  return annotation.kind === 'wall' || (annotation.kind === 'shape' && annotation.text === 'wall');
}
