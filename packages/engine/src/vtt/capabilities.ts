import { ProtocolError, type Capability, type ViewerKind } from '@actualplay/protocol';
import type { UserRole, CommandSource } from '../auth/roles.js';

const ROLE_CAPS: Record<UserRole, Capability[]> = {
  admin: [
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
  ],
  dm: [
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
    'manageTokens',
    'viewRecording',
    'restoreCheckpoint',
    'viewHandout',
    'editSharedNotes',
  ],
  player: ['viewScene', 'controlToken', 'viewHandout'],
  audience: ['viewScene', 'viewHandout'],
};

const VIEWER_CAPS: Record<ViewerKind, Capability[]> = {
  admin: ROLE_CAPS.admin,
  dm: ROLE_CAPS.dm,
  player: ROLE_CAPS.player,
  audience: ROLE_CAPS.audience,
  broadcast: ['viewScene', 'viewHandout'],
  projector: ['viewScene', 'viewHandout'],
  overlay: ['viewScene'],
  operator: [
    'viewScene',
    'stageScene',
    'activateScene',
    'runShowPreset',
    'advanceRundown',
    'controlCamera',
    'controlQLab',
    'viewHandout',
  ],
  api: ['viewScene'],
};

export function capabilitiesFor(viewer: ViewerKind): Capability[] {
  return [...VIEWER_CAPS[viewer]];
}

export function viewerFromRole(role: UserRole | CommandSource): ViewerKind {
  if (role === 'admin' || role === 'dm' || role === 'player' || role === 'audience') return role;
  if (role === 'bridge' || role === 'midi') return 'operator';
  return 'api';
}

export function assertCapability(have: Capability[], need: Capability): void {
  if (!have.includes(need)) {
    throw new ProtocolError('forbidden', `Missing capability: ${need}`);
  }
}

export function isReadOnlyViewer(viewer: ViewerKind): boolean {
  return viewer === 'broadcast' || viewer === 'projector' || viewer === 'overlay' || viewer === 'audience';
}
