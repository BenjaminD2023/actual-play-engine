import { PackError } from './errors.js';
import { PACK_FORMAT_ID, isSupportedPackVersion } from './version.js';
import {
  CUE_CATEGORIES,
  FAILURE_POLICIES,
  GRID_MODES,
  STEP_KINDS,
  TRIGGER_SOURCES,
  VISIBILITY_SCOPES,
  CONTROL_KINDS,
  VARIABLE_KINDS,
  type ActionStep,
  type CueSlot,
  type DmPage,
  type PackManifest,
  type ProductionAction,
  type ProductionProject,
  type ProductionTrigger,
  type ProductionVariable,
  type SceneRecord,
  type ValidationIssue,
  type ValidationReport,
} from './types.js';
import { parseCondition, assertNoJs } from './conditions.js';
import { assertNoCircularActions, assertTriggerTargets, reachableActionIds } from './graph.js';
import {
  optionalString,
  requireArray,
  requireBoolean,
  requireEnum,
  requireNumber,
  requireRecord,
  requireString,
  requireStringArray,
  shaLike,
} from './validate-helpers.js';

const SECRET_KEYS = /passcode|password|qlabHost|qlabPasscode|bridgeToken|apiToken|authCookie|secret/i;

export function parseManifest(raw: unknown): PackManifest {
  const rec = requireRecord(raw, 'manifest');
  const format = requireString(rec.format, 'manifest.format');
  if (format !== PACK_FORMAT_ID) throw new PackError('invalid_protocol', `Unknown pack format ${format}`);
  if (!isSupportedPackVersion(rec.formatVersion)) {
    throw new PackError('invalid_protocol', `Unsupported pack version ${String(rec.formatVersion)}`);
  }
  return {
    format,
    formatVersion: rec.formatVersion as number,
    projectId: requireString(rec.projectId, 'manifest.projectId'),
    revisionId: requireString(rec.revisionId, 'manifest.revisionId'),
    title: requireString(rec.title, 'manifest.title'),
    author: requireString(rec.author, 'manifest.author'),
    description: String(rec.description ?? ''),
    createdAt: requireString(rec.createdAt, 'manifest.createdAt'),
    publishedAt: requireString(rec.publishedAt, 'manifest.publishedAt'),
    minEngine: requireString(rec.minEngine, 'manifest.minEngine'),
    maxTestedEngine: String(rec.maxTestedEngine ?? rec.minEngine),
    capabilities: requireStringArray(rec.capabilities ?? [], 'manifest.capabilities') as PackManifest['capabilities'],
    assets: requireArray(rec.assets ?? [], 'manifest.assets').map((item, i) => {
      const asset = requireRecord(item, `asset[${i}]`);
      return {
        id: requireString(asset.id, 'asset.id'),
        hash: requireString(asset.hash, 'asset.hash'),
        mime: requireString(asset.mime, 'asset.mime'),
        originalName: requireString(asset.originalName, 'asset.originalName'),
        byteSize: requireNumber(asset.byteSize, 'asset.byteSize'),
        role: requireEnum(asset.role ?? 'other', ['map', 'token', 'handout', 'preview', 'other'] as const, 'asset.role'),
      };
    }),
    sceneIds: requireStringArray(rec.sceneIds ?? [], 'manifest.sceneIds'),
    cueSlotIds: requireStringArray(rec.cueSlotIds ?? [], 'manifest.cueSlotIds'),
    actionIds: requireStringArray(rec.actionIds ?? [], 'manifest.actionIds'),
    sourceRevisionId: optionalString(rec.sourceRevisionId, 'manifest.sourceRevisionId'),
    signature: optionalString(rec.signature, 'manifest.signature'),
    checksum: optionalString(rec.checksum, 'manifest.checksum'),
  };
}

function parseGrid(raw: unknown): SceneRecord['grid'] {
  const rec = requireRecord(raw ?? { mode: 'square', size: 70 }, 'grid');
  return {
    mode: requireEnum(rec.mode ?? 'square', GRID_MODES, 'grid.mode'),
    size: requireNumber(rec.size ?? 70, 'grid.size'),
    offsetX: requireNumber(rec.offsetX ?? 0, 'grid.offsetX'),
    offsetY: requireNumber(rec.offsetY ?? 0, 'grid.offsetY'),
    opacity: requireNumber(rec.opacity ?? 0.35, 'grid.opacity'),
    unitsPerCell: requireNumber(rec.unitsPerCell ?? 5, 'grid.unitsPerCell'),
    unitName: String(rec.unitName ?? 'ft'),
  };
}

function parseScene(raw: unknown): SceneRecord {
  const rec = requireRecord(raw, 'scene');
  const id = requireString(rec.id, 'scene.id');
  return {
    id,
    title: requireString(rec.title, 'scene.title'),
    notes: String(rec.notes ?? ''),
    tags: requireStringArray(rec.tags ?? [], 'scene.tags'),
    order: requireNumber(rec.order ?? 0, 'scene.order'),
    archived: Boolean(rec.archived),
    mapAssetId: optionalString(rec.mapAssetId, 'scene.mapAssetId'),
    animated: Boolean(rec.animated),
    grid: parseGrid(rec.grid),
    background: String(rec.background ?? '#101214'),
    defaultCameraId: optionalString(rec.defaultCameraId, 'scene.defaultCameraId'),
    defaultControlPageId: optionalString(rec.defaultControlPageId, 'scene.defaultControlPageId'),
    encounterId: optionalString(rec.encounterId, 'scene.encounterId'),
    startActionId: optionalString(rec.startActionId, 'scene.startActionId'),
    endActionId: optionalString(rec.endActionId, 'scene.endActionId'),
    fogRegions: requireArray(rec.fogRegions ?? [], 'fogRegions').map((item, i) => {
      const fog = requireRecord(item, `fog[${i}]`);
      return {
        id: requireString(fog.id, 'fog.id'),
        name: requireString(fog.name, 'fog.name'),
        kind: requireEnum(fog.kind, ['reveal', 'hide'] as const, 'fog.kind'),
        shape: requireEnum(fog.shape ?? 'rect', ['rect', 'polygon', 'brush'] as const, 'fog.shape'),
        points: requireArray(fog.points ?? [], 'fog.points').map((pt) => {
          const p = requireRecord(pt, 'point');
          return { x: requireNumber(p.x, 'x'), y: requireNumber(p.y, 'y') };
        }),
        sceneId: String(fog.sceneId ?? id),
      };
    }),
    doors: requireArray(rec.doors ?? [], 'doors').map((item) => parseDoor(item, id)),
    windows: requireArray(rec.windows ?? [], 'windows').map((item) => parseDoor(item, id)),
    lights: requireArray(rec.lights ?? [], 'lights').map((item, i) => {
      const light = requireRecord(item, `light[${i}]`);
      return {
        id: requireString(light.id, 'light.id'),
        name: requireString(light.name, 'light.name'),
        sceneId: String(light.sceneId ?? id),
        x: requireNumber(light.x ?? 0, 'light.x'),
        y: requireNumber(light.y ?? 0, 'light.y'),
        bright: requireNumber(light.bright ?? 40, 'light.bright'),
        dim: requireNumber(light.dim ?? 80, 'light.dim'),
        color: String(light.color ?? '#ffe9a8'),
        group: optionalString(light.group, 'light.group'),
      };
    }),
    cameras: requireArray(rec.cameras ?? [], 'cameras').map((item, i) => {
      const cam = requireRecord(item, `camera[${i}]`);
      return {
        id: requireString(cam.id, 'camera.id'),
        name: requireString(cam.name, 'camera.name'),
        sceneId: String(cam.sceneId ?? id),
        audience: requireEnum(cam.audience ?? 'dm', ['dm', 'player', 'broadcast', 'projector'] as const, 'camera.audience'),
        x: requireNumber(cam.x ?? 0, 'camera.x'),
        y: requireNumber(cam.y ?? 0, 'camera.y'),
        zoom: requireNumber(cam.zoom ?? 1, 'camera.zoom'),
      };
    }),
    tokens: requireArray(rec.tokens ?? [], 'tokens').map((item, i) => {
      const tok = requireRecord(item, `token[${i}]`);
      return {
        id: requireString(tok.id, 'token.id'),
        actorId: requireString(tok.actorId, 'token.actorId'),
        sceneId: String(tok.sceneId ?? id),
        x: requireNumber(tok.x ?? 0, 'token.x'),
        y: requireNumber(tok.y ?? 0, 'token.y'),
        hidden: Boolean(tok.hidden),
        locked: Boolean(tok.locked),
      };
    }),
    annotations: requireArray(rec.annotations ?? [], 'annotations').map((item, i) => {
      const ann = requireRecord(item, `ann[${i}]`);
      return {
        id: requireString(ann.id, 'ann.id'),
        kind: requireEnum(ann.kind ?? 'text', ['text', 'arrow', 'shape', 'wall'] as const, 'ann.kind'),
        text: String(ann.text ?? ''),
        dmOnly: Boolean(ann.dmOnly),
        points: requireArray(ann.points ?? [], 'ann.points').map((pt) => {
          const p = requireRecord(pt, 'point');
          return { x: requireNumber(p.x, 'x'), y: requireNumber(p.y, 'y') };
        }),
      };
    }),
  };
}

function parseDoor(raw: unknown, sceneId: string): SceneRecord['doors'][number] {
  const door = requireRecord(raw, 'door');
  const wall = requireRecord(door.wall ?? {}, 'door.wall');
  const a = requireRecord(wall.a ?? { x: 0, y: 0 }, 'wall.a');
  const b = requireRecord(wall.b ?? { x: 70, y: 0 }, 'wall.b');
  return {
    id: requireString(door.id, 'door.id'),
    name: requireString(door.name, 'door.name'),
    sceneId: String(door.sceneId ?? sceneId),
    wall: {
      a: { x: requireNumber(a.x, 'a.x'), y: requireNumber(a.y, 'a.y') },
      b: { x: requireNumber(b.x, 'b.x'), y: requireNumber(b.y, 'b.y') },
    },
    secret: Boolean(door.secret),
    initialState: requireEnum(door.initialState ?? 'closed', ['open', 'closed', 'locked'] as const, 'door.state'),
    soundSlotId: optionalString(door.soundSlotId, 'door.soundSlotId'),
    lightSlotId: optionalString(door.lightSlotId, 'door.lightSlotId'),
    revealRegionId: optionalString(door.revealRegionId, 'door.revealRegionId'),
  };
}

function parseStep(raw: unknown, label: string): ActionStep {
  const rec = requireRecord(raw, label);
  const kind = requireEnum(rec.kind, STEP_KINDS, `${label}.kind`);
  return {
    id: requireString(rec.id, `${label}.id`),
    kind,
    label: String(rec.label ?? kind),
    params: requireRecord(rec.params ?? {}, `${label}.params`),
    onFailure: requireEnum(rec.onFailure ?? 'warn', FAILURE_POLICIES, `${label}.onFailure`),
    children: rec.children ? requireArray(rec.children, 'children').map((item, i) => parseStep(item, `${label}.children[${i}]`)) : undefined,
    then: rec.then ? requireArray(rec.then, 'then').map((item, i) => parseStep(item, `${label}.then[${i}]`)) : undefined,
    else: rec.else ? requireArray(rec.else, 'else').map((item, i) => parseStep(item, `${label}.else[${i}]`)) : undefined,
  };
}

function parseAction(raw: unknown): ProductionAction {
  const rec = requireRecord(raw, 'action');
  return {
    id: requireString(rec.id, 'action.id'),
    name: requireString(rec.name, 'action.name'),
    description: String(rec.description ?? ''),
    sceneId: optionalString(rec.sceneId, 'action.sceneId'),
    visibleTo: requireArray(rec.visibleTo ?? ['dm'], 'visibleTo').map((item) =>
      requireEnum(item, VISIBILITY_SCOPES, 'visibleTo')
    ),
    availableWhen: parseCondition(rec.availableWhen),
    confirmation: requireEnum(rec.confirmation ?? 'none', ['none', 'confirm'] as const, 'confirmation'),
    cooldownMs: requireNumber(rec.cooldownMs ?? 0, 'cooldownMs'),
    steps: requireArray(rec.steps, 'steps').map((item, i) => parseStep(item, `step[${i}]`)),
    failurePolicy: requireEnum(rec.failurePolicy ?? 'warn', FAILURE_POLICIES, 'failurePolicy'),
  };
}

function parseTrigger(raw: unknown): ProductionTrigger {
  const rec = requireRecord(raw, 'trigger');
  return {
    id: requireString(rec.id, 'trigger.id'),
    name: requireString(rec.name, 'trigger.name'),
    source: requireEnum(rec.source, TRIGGER_SOURCES, 'trigger.source'),
    sourceRef: optionalString(rec.sourceRef, 'trigger.sourceRef'),
    actionId: requireString(rec.actionId, 'trigger.actionId'),
    enabled: rec.enabled !== false,
    armed: rec.armed !== false,
    runOnce: Boolean(rec.runOnce),
    debounceMs: requireNumber(rec.debounceMs ?? 0, 'debounceMs'),
    condition: parseCondition(rec.condition),
    disruptive: Boolean(rec.disruptive),
  };
}

function parseCueSlot(raw: unknown): CueSlot {
  const rec = requireRecord(raw, 'cueSlot');
  return {
    id: requireString(rec.id, 'slot.id'),
    key: requireString(rec.key, 'slot.key'),
    name: requireString(rec.name, 'slot.name'),
    category: requireEnum(rec.category, CUE_CATEGORIES, 'slot.category'),
    description: String(rec.description ?? ''),
    expectedEffect: String(rec.expectedEffect ?? ''),
    suggestedCueName: String(rec.suggestedCueName ?? rec.key),
    required: Boolean(rec.required),
    rehearsalNotes: String(rec.rehearsalNotes ?? ''),
    expectedDurationMs: rec.expectedDurationMs == null ? null : requireNumber(rec.expectedDurationMs, 'duration'),
    startStop: requireEnum(rec.startStop ?? 'start', ['start', 'stop', 'replace'] as const, 'startStop'),
    failurePolicy: requireEnum(rec.failurePolicy ?? 'warn', FAILURE_POLICIES, 'failurePolicy'),
    dmVisible: rec.dmVisible !== false,
  };
}

function parseVariable(raw: unknown): ProductionVariable {
  const rec = requireRecord(raw, 'variable');
  return {
    id: requireString(rec.id, 'variable.id'),
    key: requireString(rec.key, 'variable.key'),
    kind: requireEnum(rec.kind, VARIABLE_KINDS, 'variable.kind'),
    defaultValue: rec.defaultValue as boolean | number | string,
    enumValues: rec.enumValues ? requireStringArray(rec.enumValues, 'enumValues') : undefined,
  };
}

function parsePage(raw: unknown): DmPage {
  const rec = requireRecord(raw, 'page');
  const id = requireString(rec.id, 'page.id');
  return {
    id,
    title: requireString(rec.title, 'page.title'),
    sceneId: optionalString(rec.sceneId, 'page.sceneId'),
    order: requireNumber(rec.order ?? 0, 'page.order'),
    controls: requireArray(rec.controls ?? [], 'controls').map((item, i) => {
      const ctl = requireRecord(item, `control[${i}]`);
      return {
        id: requireString(ctl.id, 'control.id'),
        pageId: String(ctl.pageId ?? id),
        kind: requireEnum(ctl.kind, CONTROL_KINDS, 'control.kind'),
        label: requireString(ctl.label, 'control.label'),
        description: String(ctl.description ?? ''),
        color: String(ctl.color ?? '#e2b14a'),
        size: requireEnum(ctl.size ?? 'm', ['s', 'm', 'l'] as const, 'control.size'),
        actionId: optionalString(ctl.actionId, 'control.actionId'),
        sceneId: optionalString(ctl.sceneId, 'control.sceneId'),
        condition: parseCondition(ctl.condition),
        confirmation: requireEnum(ctl.confirmation ?? 'none', ['none', 'confirm'] as const, 'control.confirmation'),
        order: requireNumber(ctl.order ?? i, 'control.order'),
        group: String(ctl.group ?? 'main'),
      };
    }),
  };
}

export function parseProject(raw: unknown): ProductionProject {
  const rec = requireRecord(raw, 'project');
  forbidSecrets(rec);
  const project: ProductionProject = {
    id: requireString(rec.id, 'project.id'),
    title: requireString(rec.title, 'project.title'),
    author: requireString(rec.author, 'project.author'),
    description: String(rec.description ?? ''),
    createdAt: requireString(rec.createdAt, 'project.createdAt'),
    updatedAt: requireString(rec.updatedAt, 'project.updatedAt'),
    publishedRevisionId: optionalString(rec.publishedRevisionId, 'publishedRevisionId'),
    draft: rec.draft !== false,
    scenes: requireArray(rec.scenes ?? [], 'scenes').map(parseScene),
    actors: requireArray(rec.actors ?? [], 'actors').map((item, i) => {
      const actor = requireRecord(item, `actor[${i}]`);
      return {
        id: requireString(actor.id, 'actor.id'),
        name: requireString(actor.name, 'actor.name'),
        kind: requireEnum(actor.kind, ['player', 'npc', 'enemy', 'prop'] as const, 'actor.kind'),
        tokenAssetId: optionalString(actor.tokenAssetId, 'tokenAssetId'),
        size: requireNumber(actor.size ?? 70, 'actor.size'),
        disposition: requireEnum(actor.disposition ?? 'neutral', ['ally', 'enemy', 'neutral'] as const, 'disposition'),
        hiddenByDefault: Boolean(actor.hiddenByDefault),
        dmLabel: optionalString(actor.dmLabel, 'dmLabel'),
        bindingSlot: optionalString(actor.bindingSlot, 'bindingSlot'),
        visionDistance: requireNumber(actor.visionDistance ?? 420, 'visionDistance'),
        emitsLight: Boolean(actor.emitsLight),
      };
    }),
    encounters: requireArray(rec.encounters ?? [], 'encounters').map((item, i) => {
      const enc = requireRecord(item, `encounter[${i}]`);
      return {
        id: requireString(enc.id, 'encounter.id'),
        name: requireString(enc.name, 'encounter.name'),
        sceneId: requireString(enc.sceneId, 'encounter.sceneId'),
        memberActorIds: requireStringArray(enc.memberActorIds ?? [], 'members'),
      };
    }),
    assets: parseManifest({
      format: PACK_FORMAT_ID,
      formatVersion: 1,
      projectId: 'x',
      revisionId: 'x',
      title: 'x',
      author: 'x',
      description: '',
      createdAt: 'x',
      publishedAt: 'x',
      minEngine: '0.1.0',
      capabilities: [],
      assets: rec.assets ?? [],
      sceneIds: [],
      cueSlotIds: [],
      actionIds: [],
    }).assets,
    cueSlots: requireArray(rec.cueSlots ?? [], 'cueSlots').map(parseCueSlot),
    soundStates: requireArray(rec.soundStates ?? [], 'soundStates').map((item, i) => {
      const st = requireRecord(item, `sound[${i}]`);
      return {
        id: requireString(st.id, 'sound.id'),
        name: requireString(st.name, 'sound.name'),
        slotId: requireString(st.slotId, 'sound.slotId'),
        group: optionalString(st.group, 'group'),
        exclusiveGroup: optionalString(st.exclusiveGroup, 'exclusiveGroup'),
        loop: Boolean(st.loop),
        sceneDefaultFor: optionalString(st.sceneDefaultFor, 'sceneDefaultFor'),
      };
    }),
    stageLightStates: requireArray(rec.stageLightStates ?? [], 'stageLightStates').map((item, i) => {
      const st = requireRecord(item, `lightState[${i}]`);
      return {
        id: requireString(st.id, 'id'),
        name: requireString(st.name, 'name'),
        slotId: requireString(st.slotId, 'slotId'),
        intendedColor: String(st.intendedColor ?? ''),
        intendedIntensity: String(st.intendedIntensity ?? ''),
        intendedMood: String(st.intendedMood ?? ''),
        fadeMs: requireNumber(st.fadeMs ?? 0, 'fadeMs'),
        exclusiveGroup: optionalString(st.exclusiveGroup, 'exclusiveGroup'),
        sceneDefaultFor: optionalString(st.sceneDefaultFor, 'sceneDefaultFor'),
      };
    }),
    videoStates: requireArray(rec.videoStates ?? [], 'videoStates').map((item, i) => {
      const st = requireRecord(item, `video[${i}]`);
      return {
        id: requireString(st.id, 'id'),
        name: requireString(st.name, 'name'),
        slotId: requireString(st.slotId, 'slotId'),
        kind: requireEnum(
          st.kind ?? 'hide',
          ['background', 'portrait', 'title', 'sting', 'lower_third', 'fullscreen', 'hide'] as const,
          'kind'
        ),
        assetId: optionalString(st.assetId, 'assetId'),
      };
    }),
    handouts: requireArray(rec.handouts ?? [], 'handouts').map((item, i) => {
      const h = requireRecord(item, `handout[${i}]`);
      return {
        id: requireString(h.id, 'id'),
        title: requireString(h.title, 'title'),
        kind: requireEnum(h.kind ?? 'markdown', ['markdown', 'image', 'pdf'] as const, 'kind'),
        assetId: optionalString(h.assetId, 'assetId'),
        body: String(h.body ?? ''),
        visibility: requireEnum(h.visibility ?? 'dm', VISIBILITY_SCOPES, 'visibility'),
      };
    }),
    variables: requireArray(rec.variables ?? [], 'variables').map(parseVariable),
    actions: requireArray(rec.actions ?? [], 'actions').map(parseAction),
    triggers: requireArray(rec.triggers ?? [], 'triggers').map(parseTrigger),
    pages: requireArray(rec.pages ?? [], 'pages').map(parsePage),
  };
  return project;
}

function forbidSecrets(value: unknown, path = 'project'): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => forbidSecrets(item, `${path}[${i}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const gameSecret = key === 'secret' && typeof child === 'boolean' && /\.scenes\[\d+\]\.(doors|windows)\[\d+\]$/.test(path);
    if (SECRET_KEYS.test(key) && child && !gameSecret) {
      throw new PackError('invalid_pack', `Secret field ${path}.${key} is not allowed in a Production Pack.`);
    }
    forbidSecrets(child, `${path}.${key}`);
  }
}

function collectIds(project: ProductionProject): string[] {
  const ids: string[] = [project.id];
  const push = (id: string) => ids.push(id);
  for (const scene of project.scenes) {
    push(scene.id);
    scene.fogRegions.forEach((item) => push(item.id));
    scene.doors.forEach((item) => push(item.id));
    scene.windows.forEach((item) => push(item.id));
    scene.lights.forEach((item) => push(item.id));
    scene.cameras.forEach((item) => push(item.id));
    scene.tokens.forEach((item) => push(item.id));
    scene.annotations.forEach((item) => push(item.id));
  }
  project.actors.forEach((item) => push(item.id));
  project.encounters.forEach((item) => push(item.id));
  project.assets.forEach((item) => push(item.id));
  project.cueSlots.forEach((item) => push(item.id));
  project.soundStates.forEach((item) => push(item.id));
  project.stageLightStates.forEach((item) => push(item.id));
  project.videoStates.forEach((item) => push(item.id));
  project.handouts.forEach((item) => push(item.id));
  project.variables.forEach((item) => push(item.id));
  project.actions.forEach((item) => {
    push(item.id);
    const walk = (steps: ActionStep[]) => {
      for (const step of steps) {
        push(step.id);
        if (step.children) walk(step.children);
        if (step.then) walk(step.then);
        if (step.else) walk(step.else);
      }
    };
    walk(item.steps);
  });
  project.triggers.forEach((item) => push(item.id));
  project.pages.forEach((item) => {
    push(item.id);
    item.controls.forEach((ctl) => push(ctl.id));
  });
  return ids;
}

export function validateProject(project: ProductionProject): ValidationReport {
  const issues: ValidationIssue[] = [];
  const add = (level: ValidationIssue['level'], code: string, message: string, path: string) => {
    issues.push({ level, code, message, path });
  };
  const ids = collectIds(project);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) add('error', 'duplicate_id', `Duplicate stable id ${id}`, id);
    seen.add(id);
  }
  try {
    assertNoCircularActions(project.actions);
  } catch (error) {
    add('error', 'circular_reference', error instanceof Error ? error.message : 'Circular actions', 'actions');
  }
  try {
    assertTriggerTargets(project.triggers, project.actions);
  } catch (error) {
    add('error', 'invalid_trigger', error instanceof Error ? error.message : 'Invalid trigger', 'triggers');
  }
  assertNoJs(project);
  for (const slot of project.cueSlots) {
    if (slot.required && !slot.key) add('error', 'cue_slot', 'Required cue slot missing key', slot.id);
  }
  for (const page of project.pages) {
    for (const control of page.controls) {
      if (['button', 'momentary', 'toggle'].includes(control.kind) && !control.actionId) {
        add('error', 'control_without_action', `Control ${control.label} has no action`, control.id);
      }
    }
  }
  for (const trigger of project.triggers) {
    if (!trigger.actionId) add('error', 'trigger_without_action', `Trigger ${trigger.name} has no action`, trigger.id);
  }
  const controlActionIds = project.pages.flatMap((page) => page.controls.map((ctl) => ctl.actionId).filter((id): id is string => Boolean(id)));
  const reachable = reachableActionIds(project.actions, project.triggers, controlActionIds);
  for (const action of project.actions) {
    if (!reachable.has(action.id)) add('warning', 'unreachable_action', `Action ${action.name} is not reachable`, action.id);
  }
  for (const scene of project.scenes) {
    if (!scene.mapAssetId) add('warning', 'missing_map', `Scene ${scene.title} has no map asset`, scene.id);
  }
  for (const asset of project.assets) {
    if (!shaLike(asset.hash)) add('error', 'asset_hash', `Asset ${asset.id} hash is invalid`, asset.id);
    if (asset.mime === 'image/svg+xml') add('error', 'asset_mime', 'SVG assets are rejected', asset.id);
  }
  const ok = !issues.some((issue) => issue.level === 'error');
  return { ok, issues };
}

export function assertPublishable(project: ProductionProject): void {
  const report = validateProject(project);
  if (!report.ok) {
    throw new PackError('publication_blocked', 'Project has validation errors.', {
      issues: report.issues.filter((issue) => issue.level === 'error'),
    });
  }
}
