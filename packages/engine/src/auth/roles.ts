export const USER_ROLES = ['admin', 'dm', 'player', 'audience'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export type CommandSource = UserRole | 'midi' | 'system' | 'bridge';

export function canControlShow(role: UserRole | CommandSource): boolean {
  return role === 'admin' || role === 'dm' || role === 'system' || role === 'midi' || role === 'bridge';
}

export function canTriggerPlayerAction(role: UserRole | CommandSource): boolean {
  return role === 'player' || role === 'audience' || canControlShow(role);
}

export function isCharacterLinkableRole(role: string): boolean {
  return role === 'player' || role === 'audience';
}

export function assertRole(role: string): UserRole {
  if ((USER_ROLES as readonly string[]).includes(role)) {
    return role as UserRole;
  }
  throw new Error(`Unknown role: ${role}`);
}
