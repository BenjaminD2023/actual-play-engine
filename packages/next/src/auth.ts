import bcrypt from 'bcrypt';
import {
  assertRole,
  createId,
  nowIso,
  type ActualPlayEngine,
  type UserRole,
} from '@actualplay/engine';

export interface PublicUser {
  id: string;
  username: string;
  role: UserRole;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

export interface SessionPayload {
  userId: string;
  username: string;
  role: UserRole;
  expires: number;
}

export const SESSION_COOKIE = 'actualplay_session';
const SESSION_MS = 24 * 60 * 60 * 1000;

export function parseSessionCookie(value: string | undefined | null): SessionPayload | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as SessionPayload;
    if (!parsed.userId || !parsed.role || !parsed.expires) return null;
    if (Date.now() > parsed.expires) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function serializeSessionCookie(session: SessionPayload): string {
  return JSON.stringify(session);
}

export async function login(
  engine: ActualPlayEngine,
  username: string,
  password: string
): Promise<{ user: PublicUser; session: SessionPayload }> {
  const user = engine.store.getUserByUsername(username.trim());
  if (!user) {
    throw new Error('UNAUTHENTICATED');
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    throw new Error('UNAUTHENTICATED');
  }
  const publicUser: PublicUser = {
    id: user.id,
    username: user.username,
    role: user.role,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
  };
  return {
    user: publicUser,
    session: {
      userId: user.id,
      username: user.username,
      role: user.role,
      expires: Date.now() + SESSION_MS,
    },
  };
}

export async function bootstrapAdmin(
  engine: ActualPlayEngine,
  input: { username: string; password: string; email?: string | null }
): Promise<void> {
  if (engine.store.getUserByUsername(input.username)) return;
  const password_hash = await bcrypt.hash(input.password, 12);
  const now = nowIso();
  engine.store.createUser({
    id: createId(),
    first_name: null,
    last_name: null,
    username: input.username,
    email: input.email ?? null,
    role: 'admin',
    password_hash,
    created_at: now,
    updated_at: now,
  });
}

export function getRequestUser(engine: ActualPlayEngine, cookieHeader: string | null): PublicUser | null {
  const cookie = readCookie(cookieHeader, SESSION_COOKIE);
  const session = parseSessionCookie(cookie);
  if (!session) return null;
  const user = engine.store.getUserById(session.userId);
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
  };
}

export function requireUser(
  user: PublicUser | null,
  roles?: UserRole[]
): PublicUser {
  if (!user) throw new Error('UNAUTHENTICATED');
  if (roles && !roles.includes(user.role)) throw new Error('FORBIDDEN');
  return user;
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const parts = header.split(';');
  for (const part of parts) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function roleHome(role: UserRole): string {
  assertRole(role);
  if (role === 'admin') return '/admin';
  if (role === 'dm') return '/dm';
  if (role === 'player') return '/player';
  return '/audience';
}
