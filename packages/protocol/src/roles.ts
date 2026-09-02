export const USER_ROLES = ['admin', 'dm', 'player', 'audience'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const VIEWER_KINDS = [
  'admin',
  'dm',
  'player',
  'audience',
  'broadcast',
  'projector',
  'operator',
  'overlay',
  'api',
] as const;
export type ViewerKind = (typeof VIEWER_KINDS)[number];

export const SCOPED_TOKEN_KINDS = ['broadcast', 'projector', 'operator', 'overlay', 'bridge', 'api'] as const;
export type ScopedTokenKind = (typeof SCOPED_TOKEN_KINDS)[number];

export const CAPABILITIES = [
  'viewScene',
  'prepareScene',
  'publishScene',
  'instantiateScene',
  'stageScene',
  'activateScene',
  'controlToken',
  'assignTokenOwner',
  'viewHiddenToken',
  'editFog',
  'editWalls',
  'editLights',
  'controlCamera',
  'viewPrivateInitiative',
  'runShowPreset',
  'advanceRundown',
  'controlQLab',
  'manageAssets',
  'manageUsers',
  'manageTokens',
  'manageWebhooks',
  'viewRecording',
  'restoreCheckpoint',
  'viewHandout',
  'editSharedNotes',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const READ_ONLY_VIEWERS: readonly ViewerKind[] = ['broadcast', 'projector', 'overlay', 'audience'];
