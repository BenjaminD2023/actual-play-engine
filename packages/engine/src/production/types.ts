export * from '@actualplay/protocol/production';
import type { AssetRef, PackManifest, ProductionProject, StepKind, ImportReport as PackImportReport, ActionRunStep as PackRunStep, ActionRun as PackRun } from '@actualplay/protocol/production';
export type ImportReport = PackImportReport & { checksum: string };
export type ActionRunStep = PackRunStep & { external: boolean };
export type ActionRun = Omit<PackRun, 'steps'> & { steps: ActionRunStep[] };
import type { DeploymentRecord as PackDeployment } from '@actualplay/protocol/production';
export interface DeploymentRecord extends PackDeployment {
  previousDeploymentId?: string | null; createdAt?: string; updatedAt?: string; publishedAt?: string | null;
}
export const EXTERNAL_STEP_KINDS = new Set<StepKind>([
  'fire_sound_slot', 'stop_sound_slot', 'activate_sound_state', 'fire_stage_light_slot',
  'activate_stage_light_state', 'fire_video_slot', 'fire_generic_slot',
]);
export interface PreflightCheck {
  code: string;
  level: 'ok' | 'warn' | 'fail';
  message: string;
  action: string;
}

export interface PreflightReport {
  ready: 'ready' | 'ready_with_warnings' | 'not_ready';
  checks: PreflightCheck[];
  warnings: Array<{ code: string; message: string; action: string }>;
}

export interface RevisionDiff {
  from: string;
  to: string;
  added: string[];
  removed: string[];
  changed: string[];
}

export interface PackedAsset extends AssetRef {
  data: Buffer;
}

export interface RevisionRow {
  id: string;
  projectId: string;
  title: string;
  author: string;
  checksum: string;
  manifest: PackManifest;
  project: ProductionProject;
  assets: PackedAsset[];
  createdAt: string;
  createdBy: string | null;
}
