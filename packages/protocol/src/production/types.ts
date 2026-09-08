export const CUE_CATEGORIES = ['sound', 'music', 'light', 'video', 'effect', 'transition', 'generic'] as const;
export type CueCategory = (typeof CUE_CATEGORIES)[number];

export const VARIABLE_KINDS = ['boolean', 'number', 'string', 'enum'] as const;
export type VariableKind = (typeof VARIABLE_KINDS)[number];

export const COMPARE_OPS = ['eq', 'neq', 'gt', 'lt', 'contains', 'is_true', 'is_false'] as const;
export type CompareOp = (typeof COMPARE_OPS)[number];

export const STEP_KINDS = [
  'activate_scene',
  'stage_scene',
  'open_door',
  'close_door',
  'lock_door',
  'unlock_door',
  'reveal_fog',
  'hide_fog',
  'toggle_vtt_light',
  'activate_vtt_light_state',
  'reveal_token',
  'hide_token',
  'spawn_encounter',
  'remove_encounter',
  'move_token',
  'set_token_condition',
  'show_annotation',
  'hide_annotation',
  'camera_preset',
  'focus_region',
  'focus_token',
  'fire_sound_slot',
  'stop_sound_slot',
  'activate_sound_state',
  'fire_stage_light_slot',
  'activate_stage_light_state',
  'fire_video_slot',
  'fire_generic_slot',
  'show_handout',
  'hide_handout',
  'show_announcement',
  'clear_announcement',
  'open_poll',
  'close_poll',
  'recording_marker',
  'notify_operator',
  'start_combat',
  'advance_initiative',
  'set_variable',
  'increment_variable',
  'toggle_variable',
  'emit_event',
  'delay',
  'sequential',
  'parallel',
  'condition',
  'branch',
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const FAILURE_POLICIES = ['continue', 'halt_external', 'halt_all', 'warn', 'confirm'] as const;
export type FailurePolicy = (typeof FAILURE_POLICIES)[number];

export const STEP_STATUSES = ['pending', 'ok', 'skipped', 'unconfirmed', 'failed', 'compensated', 'blocked'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const TRIGGER_SOURCES = [
  'dm_button',
  'operator_button',
  'scene_staged',
  'scene_activated',
  'scene_ended',
  'door_opened',
  'door_closed',
  'fog_revealed',
  'fog_hidden',
  'token_enters_region',
  'token_leaves_region',
  'initiative_starts',
  'initiative_actor',
  'round_starts',
  'round_number',
  'variable_changed',
  'poll_result',
  'timer_after_scene',
  'midi',
  'virtual_button',
  'named_event',
] as const;
export type TriggerSource = (typeof TRIGGER_SOURCES)[number];

export const VISIBILITY_SCOPES = [
  'dm',
  'player',
  'player_specific',
  'audience',
  'broadcast',
  'projector',
  'operator',
] as const;
export type VisibilityScope = (typeof VISIBILITY_SCOPES)[number];

export const CONTROL_KINDS = [
  'button',
  'momentary',
  'toggle',
  'radio',
  'select',
  'status',
  'heading',
  'variable',
] as const;
export type ControlKind = (typeof CONTROL_KINDS)[number];

export const GRID_MODES = ['gridless', 'square', 'hex-flat', 'hex-pointy'] as const;
export type GridMode = (typeof GRID_MODES)[number];

export const ISSUE_LEVELS = ['error', 'warning', 'suggestion'] as const;
export type IssueLevel = (typeof ISSUE_LEVELS)[number];

export const REQUIRED_CAPABILITIES = [
  'vtt',
  'qlab',
  'midi',
  'polls',
  'combat',
  'handouts',
  'broadcast',
] as const;
export type RuntimeCapability = (typeof REQUIRED_CAPABILITIES)[number];

export interface Point {
  x: number;
  y: number;
}

export interface AssetRef {
  id: string;
  hash: string;
  mime: string;
  originalName: string;
  byteSize: number;
  role: 'map' | 'token' | 'handout' | 'preview' | 'other';
}

export interface GridConfig {
  mode: GridMode;
  size: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
  unitsPerCell: number;
  unitName: string;
}

export interface FogRegion {
  id: string;
  name: string;
  kind: 'reveal' | 'hide';
  shape: 'rect' | 'polygon' | 'brush';
  points: Point[];
  sceneId: string;
}

export interface DoorObject {
  id: string;
  name: string;
  sceneId: string;
  wall: { a: Point; b: Point };
  secret: boolean;
  initialState: 'open' | 'closed' | 'locked';
  soundSlotId: string | null;
  lightSlotId: string | null;
  revealRegionId: string | null;
}

export interface VttLight {
  id: string;
  name: string;
  sceneId: string;
  x: number;
  y: number;
  bright: number;
  dim: number;
  color: string;
  group: string | null;
}

export interface CameraPreset {
  id: string;
  name: string;
  sceneId: string;
  audience: 'dm' | 'player' | 'broadcast' | 'projector';
  x: number;
  y: number;
  zoom: number;
}

export interface TokenPlacement {
  id: string;
  actorId: string;
  sceneId: string;
  x: number;
  y: number;
  hidden: boolean;
  locked: boolean;
}

export interface SceneRecord {
  id: string;
  title: string;
  notes: string;
  tags: string[];
  order: number;
  archived: boolean;
  mapAssetId: string | null;
  animated: boolean;
  grid: GridConfig;
  background: string;
  defaultCameraId: string | null;
  defaultControlPageId: string | null;
  encounterId: string | null;
  startActionId: string | null;
  endActionId: string | null;
  fogRegions: FogRegion[];
  doors: DoorObject[];
  windows: DoorObject[];
  lights: VttLight[];
  cameras: CameraPreset[];
  tokens: TokenPlacement[];
  annotations: Array<{ id: string; kind: 'text' | 'arrow' | 'shape' | 'wall'; text: string; dmOnly: boolean; points: Point[] }>;
}

export interface ActorRecord {
  id: string;
  name: string;
  kind: 'player' | 'npc' | 'enemy' | 'prop';
  tokenAssetId: string | null;
  size: number;
  disposition: 'ally' | 'enemy' | 'neutral';
  hiddenByDefault: boolean;
  dmLabel: string | null;
  bindingSlot: string | null;
  visionDistance: number;
  emitsLight: boolean;
}

export interface EncounterRecord {
  id: string;
  name: string;
  sceneId: string;
  memberActorIds: string[];
}

export interface CueSlot {
  id: string;
  key: string;
  name: string;
  category: CueCategory;
  description: string;
  expectedEffect: string;
  suggestedCueName: string;
  required: boolean;
  rehearsalNotes: string;
  expectedDurationMs: number | null;
  startStop: 'start' | 'stop' | 'replace';
  failurePolicy: FailurePolicy;
  dmVisible: boolean;
}

export interface SoundState {
  id: string;
  name: string;
  slotId: string;
  group: string | null;
  exclusiveGroup: string | null;
  loop: boolean;
  sceneDefaultFor: string | null;
}

export interface StageLightState {
  id: string;
  name: string;
  slotId: string;
  intendedColor: string;
  intendedIntensity: string;
  intendedMood: string;
  fadeMs: number;
  exclusiveGroup: string | null;
  sceneDefaultFor: string | null;
}

export interface VideoState {
  id: string;
  name: string;
  slotId: string;
  kind: 'background' | 'portrait' | 'title' | 'sting' | 'lower_third' | 'fullscreen' | 'hide';
  assetId: string | null;
}

export interface HandoutRecord {
  id: string;
  title: string;
  kind: 'markdown' | 'image' | 'pdf';
  assetId: string | null;
  body: string;
  visibility: VisibilityScope;
}

export interface ProductionVariable {
  id: string;
  key: string;
  kind: VariableKind;
  defaultValue: boolean | number | string;
  enumValues?: string[];
}

export interface ConditionAtom {
  kind: 'atom';
  variableId: string;
  op: CompareOp;
  value?: boolean | number | string;
}

export interface ConditionGroup {
  kind: 'group';
  mode: 'all' | 'any';
  clauses: Condition[];
}

export type Condition = ConditionAtom | ConditionGroup;

export interface ActionStep {
  id: string;
  kind: StepKind;
  label: string;
  params: Record<string, unknown>;
  onFailure: FailurePolicy;
  children?: ActionStep[];
  then?: ActionStep[];
  else?: ActionStep[];
}

export interface ProductionAction {
  id: string;
  name: string;
  description: string;
  sceneId: string | null;
  visibleTo: VisibilityScope[];
  availableWhen: Condition | null;
  confirmation: 'none' | 'confirm';
  cooldownMs: number;
  steps: ActionStep[];
  failurePolicy: FailurePolicy;
}

export interface ProductionTrigger {
  id: string;
  name: string;
  source: TriggerSource;
  sourceRef: string | null;
  actionId: string;
  enabled: boolean;
  armed: boolean;
  runOnce: boolean;
  debounceMs: number;
  condition: Condition | null;
  disruptive: boolean;
}

export interface DmControl {
  id: string;
  pageId: string;
  kind: ControlKind;
  label: string;
  description: string;
  color: string;
  size: 's' | 'm' | 'l';
  actionId: string | null;
  sceneId: string | null;
  condition: Condition | null;
  confirmation: 'none' | 'confirm';
  order: number;
  group: string;
}

export interface DmPage {
  id: string;
  title: string;
  sceneId: string | null;
  order: number;
  controls: DmControl[];
}

export interface PackManifest {
  format: typeof import('./version.js').PACK_FORMAT_ID | string;
  formatVersion: number;
  projectId: string;
  revisionId: string;
  title: string;
  author: string;
  description: string;
  createdAt: string;
  publishedAt: string;
  minEngine: string;
  maxTestedEngine: string;
  capabilities: RuntimeCapability[];
  assets: AssetRef[];
  sceneIds: string[];
  cueSlotIds: string[];
  actionIds: string[];
  sourceRevisionId: string | null;
  signature: string | null;
  checksum?: string | null;
}

export interface ProductionProject {
  id: string;
  title: string;
  author: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  publishedRevisionId: string | null;
  draft: boolean;
  scenes: SceneRecord[];
  actors: ActorRecord[];
  encounters: EncounterRecord[];
  assets: AssetRef[];
  cueSlots: CueSlot[];
  soundStates: SoundState[];
  stageLightStates: StageLightState[];
  videoStates: VideoState[];
  handouts: HandoutRecord[];
  variables: ProductionVariable[];
  actions: ProductionAction[];
  triggers: ProductionTrigger[];
  pages: DmPage[];
}

export interface ValidationIssue {
  level: IssueLevel;
  code: string;
  message: string;
  path: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface ImportReport {
  revisionId: string;
  manifest: PackManifest;
  compatible: boolean;
  security: ValidationIssue[];
  validation: ValidationReport;
  requiredBindings: string[];
  actorSlots: string[];
  warnings: ValidationIssue[];
  errors: ValidationIssue[];
}

export interface CueBinding {
  slotId: string;
  kind: 'show_cue' | 'cue_number' | 'approved_osc' | 'noop' | 'dry_run';
  cueName: string | null;
  cueNumber: string | null;
  oscTemplateId: string | null;
  tested: boolean;
  lastResult: StepStatus | null;
  acceptedWarning: string | null;
}

export interface ActorBinding {
  actorId: string;
  playerId: string | null;
  userId: string | null;
}

export interface DeploymentRecord {
  id: string;
  packageRevisionId: string;
  sessionId: string;
  status: 'draft' | 'ready' | 'live' | 'archived';
  cueBindings: CueBinding[];
  actorBindings: ActorBinding[];
  dmUserIds: string[];
  published: boolean;
}

export interface ActionRunStep {
  stepId: string;
  kind: StepKind;
  status: StepStatus;
  detail: string;
  qlab?: { confirmed: boolean; status: string; error?: string | null };
}

export interface ActionRun {
  id: string;
  deploymentId: string;
  actionId: string;
  actorId: string | null;
  startedAt: string;
  endedAt: string | null;
  steps: ActionRunStep[];
}
