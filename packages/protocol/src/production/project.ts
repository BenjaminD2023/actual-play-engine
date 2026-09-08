import { PACK_FORMAT_ID, PACK_FORMAT_VERSION, MIN_COMPATIBLE_ENGINE, MAX_TESTED_ENGINE } from './version.js';
import type { PackManifest, ProductionProject } from './types.js';

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix = 'id'): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

export function emptyProject(input?: { title?: string; author?: string }): ProductionProject {
  const createdAt = nowIso();
  return {
    id: createId('proj'),
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

export function manifestFromProject(project: ProductionProject, revisionId: string): PackManifest {
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
    minEngine: MIN_COMPATIBLE_ENGINE,
    maxTestedEngine: MAX_TESTED_ENGINE,
    capabilities: ['vtt', 'qlab', 'midi', 'polls', 'combat', 'handouts', 'broadcast'],
    assets: project.assets,
    sceneIds: project.scenes.map((scene) => scene.id),
    cueSlotIds: project.cueSlots.map((slot) => slot.id),
    actionIds: project.actions.map((action) => action.id),
    sourceRevisionId: project.publishedRevisionId,
    signature: null,
  };
}

export function cloneAsDraft(project: ProductionProject): ProductionProject {
  return {
    ...structuredClone(project),
    id: createId('proj'),
    draft: true,
    publishedRevisionId: null,
    updatedAt: nowIso(),
    title: `${project.title} copy`,
  };
}
