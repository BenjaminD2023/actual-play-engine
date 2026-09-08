// The authoring tool and runtime share the same parser and validation policy.
export * from '@actualplay/protocol/production';
export { createId as createSpecId } from '@actualplay/protocol/production';
import { createHash } from 'node:crypto';
import { canonicalJson, manifestFromProject as manifest } from '@actualplay/protocol/production';
import type { ProductionProject, PackManifest } from './types.js';
export function manifestFromProject(project: ProductionProject, revisionId: string, checksum?: string | null): PackManifest {
  return { ...manifest(project, revisionId), checksum: checksum ?? null };
}
export function packChecksum(project: ProductionProject, hashes: string[]): string {
  return createHash('sha256').update(canonicalJson({ project, hashes: [...hashes].sort() })).digest('hex');
}
