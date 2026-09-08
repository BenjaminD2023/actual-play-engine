import type { UserRole } from '../auth/roles.js';
export interface HttpUser { id: string; username: string; role: UserRole; }
export function requireUser(user: HttpUser | null, roles?: UserRole[]): HttpUser {
  if (!user) throw new Error('UNAUTHENTICATED');
  if (roles && !roles.includes(user.role)) throw new Error('FORBIDDEN');
  return user;
}
