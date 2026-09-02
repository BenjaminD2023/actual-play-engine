import { createHash, randomUUID } from 'node:crypto';
import { ProductionError } from './errors.js';
import {
  COMPARE_OPS,
  CONTROL_KINDS,
  CUE_CATEGORIES,
  FAILURE_POLICIES,
  GRID_MODES,
  PACK_FORMAT_ID,
  PACK_FORMAT_VERSION,
  STEP_KINDS,
  TRIGGER_SOURCES,
  VARIABLE_KINDS,
  VISIBILITY_SCOPES,
  isSupportedPackVersion,
  type ActionStep,
  type AssetRef,
  type Condition,
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key]);
    return out;
  }
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ProductionError('invalid_request', `${label} must be an object.`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProductionError('invalid_request', `${label} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  return requireString(value, label);
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProductionError('invalid_request', `${label} must be a finite number.`);
  }
  return value;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ProductionError('invalid_request', `${label} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new ProductionError('invalid_request', `${label} must be an array.`);
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((item, index) => requireString(item, `${label}[${index}]`));
}

function shaLike(value: string): boolean {
  return /^[a-f0-9]{32,128}$/i.test(value);
}

const SECRET_KEYS = /passcode|password|qlabHost|bridgeToken|cookie|apiToken|secret/i;

export function parseCondition(value: unknown): Condition | null {
  if (value === undefined || value === null) return null;
  const rec = requireRecord(value, 'condition');
  if (rec.kind === 'group' || rec.mode === 'all' || rec.mode === 'any' || rec.clauses) {
    const mode = requireEnum(rec.mode ?? 'all', ['all', 'any'] as const, 'condition.mode');
    const clauses = Array.isArray(rec.clauses) ? rec.clauses.map(parseCondition).filter((c): c is Condition => Boolean(c)) : [];
    return { kind: 'group', mode, clauses };
  }
  return {
    kind: 'atom',
    variableId: requireString(rec.variableId, 'condition.variableId'),
    op: requireEnum(rec.op, COMPARE_OPS, 'condition.op'),
    value: rec.value as boolean | number | string | undefined,
  };
}

export function evaluateCondition(
  condition: Condition | null,
  variables: Record<string, boolean | number | string>
): boolean {
  if (!condition) return true;
  if (condition.kind === 'group') {
    if (condition.clauses.length === 0) return true;
    return condition.mode === 'all'
      ? condition.clauses.every((clause) => evaluateCondition(clause, variables))
      : condition.clauses.some((clause) => evaluateCondition(clause, variables));
  }
  const current = variables[condition.variableId];
  switch (condition.op) {
    case 'eq':
      return current === condition.value;
    case 'neq':
      return current !== condition.value;
    case 'gt':
      return typeof current === 'number' && typeof condition.value === 'number' && current > condition.value;
    case 'lt':
      return typeof current === 'number' && typeof condition.value === 'number' && current < condition.value;
    case 'contains':
      return typeof current === 'string' && typeof condition.value === 'string' && current.includes(condition.value);
    case 'is_true':
      return current === true;
    case 'is_false':
      return current === false;
    default:
      throw new ProductionError('invalid_request', 'Unsupported condition op.');
  }
}

export function defaultVariableMap(vars: ProductionVariable[]): Record<string, boolean | number | string> {
  const out: Record<string, boolean | number | string> = {};
  for (const variable of vars) out[variable.id] = variable.defaultValue;
  return out;
}

export function assertNoJs(value: unknown): void {
  const text = JSON.stringify(value);
  if (/\b(eval|Function|constructor)\b/.test(text)) {
    throw new ProductionError('invalid_pack', 'Arbitrary script expressions are not allowed in conditions.');
  }
  if (isRecord(value) && typeof value.expr === 'string') {
    throw new ProductionError('invalid_pack', 'Arbitrary expressions are not allowed.');
  }
}

function walkSteps(steps: ActionStep[] | undefined, visit: (step: ActionStep) => void): void {
  for (const step of steps ?? []) {
    visit(step);
    walkSteps(step.children, visit);
    walkSteps(step.then, visit);
    walkSteps(step.else, visit);
  }
}

function collectActionCalls(action: ProductionAction): string[] {
  const ids: string[] = [];
  walkSteps(action.steps, (step) => {
    if (typeof step.params.actionId === 'string') ids.push(step.params.actionId);
  });
  return ids;
}

export function assertNoCircularActions(actions: ProductionAction[]): void {
  const byId = new Map(actions.map((action) => [action.id, action]));
  const visiting = new Set<string>();
  const seen = new Set<string>();
  const visit = (id: string, stack: string[]) => {
    if (seen.has(id)) return;
    if (visiting.has(id)) {
      throw new ProductionError('circular_reference', `Circular action reference: ${[...stack, id].join(' -> ')}`);
    }
    visiting.add(id);
    const action = byId.get(id);
    if (action) for (const next of collectActionCalls(action)) visit(next, [...stack, id]);
    visiting.delete(id);
    seen.add(id);
  };
  for (const action of actions) visit(action.id, []);
}

function assertTriggerTargets(triggers: ProductionTrigger[], actions: ProductionAction[]): void {
  const ids = new Set(actions.map((action) => action.id));
  for (const trigger of triggers) {
    if (!ids.has(trigger.actionId)) {
      throw new ProductionError('invalid_pack', `Trigger ${trigger.id} points at missing action ${trigger.actionId}.`);
    }
  }
}

function reachableActionIds(actions: ProductionAction[], triggers: ProductionTrigger[], controlActionIds: string[]): Set<string> {
  const byId = new Map(actions.map((action) => [action.id, action]));
  const queue = [...controlActionIds, ...triggers.map((trigger) => trigger.actionId)];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const action = byId.get(id);
    if (action) queue.push(...collectActionCalls(action));
  }
  return seen;
}

export function parseManifest(raw: unknown): PackManifest {
  const rec = requireRecord(raw, 'manifest');
  const format = requireString(rec.format, 'manifest.format');
  if (format !== PACK_FORMAT_ID) throw new ProductionError('invalid_protocol', `Unknown pack format ${format}`);
  if (!isSupportedPackVersion(rec.formatVersion)) {
    throw new ProductionError('invalid_protocol', `Unsupported pack version ${String(rec.formatVersion)}`);
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
    assets: requireArray(rec.assets ?? [], 'manifest.assets').map((item, i) => parseAsset(item, i)),
    sceneIds: requireStringArray(rec.sceneIds ?? [], 'manifest.sceneIds'),
    cueSlotIds: requireStringArray(rec.cueSlotIds ?? [], 'manifest.cueSlotIds'),
    actionIds: requireStringArray(rec.actionIds ?? [], 'manifest.actionIds'),
    sourceRevisionId: optionalString(rec.sourceRevisionId, 'manifest.sourceRevisionId'),
    signature: optionalString(rec.signature, 'manifest.signature'),
    checksum: rec.checksum == null ? null : requireString(rec.checksum, 'manifest.checksum'),
  };
}

function parseAsset(raw: unknown, i: number): AssetRef {
  const asset = requireRecord(raw, `asset[${i}]`);
  return {
    id: requireString(asset.id, 'asset.id'),
    hash: requireString(asset.hash, 'asset.hash'),
    mime: requireString(asset.mime, 'asset.mime'),
    originalName: requireString(asset.originalName, 'asset.originalName'),
    byteSize: requireNumber(asset.byteSize, 'asset.byteSize'),
    role: requireEnum(asset.role ?? 'other', ['map', 'token', 'handout', 'preview', 'other'] as const, 'asset.role'),
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
        kind: requireEnum(ann.kind ?? 'text', ['text', 'arrow', 'shape'] as const, 'ann.kind'),
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
    visibleTo: requireArray(rec.visibleTo ?? ['dm'], 'visibleTo').map((item) => requireEnum(item, VISIBILITY_SCOPES, 'visibleTo')),
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

function forbidSecrets(value: unknown, path = 'project'): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => forbidSecrets(item, `${path}[${i}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.test(key) && child) {
      throw new ProductionError('invalid_pack', `Secret field ${path}.${key} is not allowed in a Production Pack.`);
    }
    forbidSecrets(child, `${path}.${key}`);
  }
}

export function parseProject(raw: unknown): ProductionProject {
  const rec = requireRecord(raw, 'project');
  forbidSecrets(rec);
  return {
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
    assets: requireArray(rec.assets ?? [], 'assets').map((item, i) => parseAsset(item, i)),
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
    walkSteps(item.steps, (step) => push(step.id));
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
    throw new ProductionError('publication_blocked', 'Project has validation errors.', {
      issues: report.issues.filter((issue) => issue.level === 'error'),
    });
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createSpecId(prefix = 'id'): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export function emptyProject(input?: { title?: string; author?: string }): ProductionProject {
  const createdAt = nowIso();
  return {
    id: createSpecId('proj'),
    title: input?.title ?? 'Untitled production',
    author: input?.author ?? 'anonymous',
    description: '',
    createdAt,
    updatedAt: createdAt,
    publishedRevisionId: null,
    draft: true,
    scenes: [],
    actors: [],
    encounters: [],
    assets: [],
    cueSlots: [],
    soundStates: [],
    stageLightStates: [],
    videoStates: [],
    handouts: [],
    variables: [],
    actions: [],
    triggers: [],
    pages: [],
  };
}

export function manifestFromProject(project: ProductionProject, revisionId: string, checksum?: string | null): PackManifest {
  return {
    format: PACK_FORMAT_ID,
    formatVersion: PACK_FORMAT_VERSION,
    projectId: project.id,
    revisionId,
    title: project.title,
    author: project.author,
    description: project.description,
    createdAt: project.createdAt,
    publishedAt: nowIso(),
    minEngine: '0.1.0',
    maxTestedEngine: '0.1.0',
    capabilities: ['vtt', 'qlab', 'midi', 'polls', 'combat', 'handouts', 'broadcast'],
    assets: project.assets,
    sceneIds: project.scenes.map((scene) => scene.id),
    cueSlotIds: project.cueSlots.map((slot) => slot.id),
    actionIds: project.actions.map((action) => action.id),
    sourceRevisionId: project.publishedRevisionId,
    signature: null,
    checksum: checksum ?? null,
  };
}

export function packChecksum(project: ProductionProject, hashes: string[]): string {
  return createHash('sha256')
    .update(canonicalJson({ project, hashes: [...hashes].sort() }))
    .digest('hex');
}
