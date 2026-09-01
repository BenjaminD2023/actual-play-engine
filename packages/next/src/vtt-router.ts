import { ProtocolError, type ViewerKind } from '@actualplay/protocol';
import type { ActualPlayEngine } from '@actualplay/engine';
import type { PublicUser } from './auth.js';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function normalizeHost(host: string): string {
  return host.replace(/^localhost\b/i, '127.0.0.1');
}

function assertSameOrigin(request: Request): void {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('host') ?? new URL(request.url).host;
  const expected = normalizeHost(host);
  if (origin) {
    if (normalizeHost(new URL(origin).host) !== expected) {
      throw new ProtocolError('forbidden', 'Cross-origin request blocked.');
    }
    return;
  }
  if (referer && normalizeHost(new URL(referer).host) !== expected) {
    throw new ProtocolError('forbidden', 'Cross-origin request blocked.');
  }
}

function viewerFor(user: PublicUser | null, fallback: ViewerKind): ViewerKind {
  if (!user) return fallback;
  if (user.role === 'admin' || user.role === 'dm' || user.role === 'player' || user.role === 'audience') return user.role;
  return fallback;
}

export async function handleVttRequest(
  engine: ActualPlayEngine,
  request: Request,
  rest: string[],
  user: PublicUser | null
): Promise<Response | null> {
  const vtt = engine.vtt;
  const method = request.method.toUpperCase();
  const [head, ...tail] = rest;
  const session = engine.store.getActiveSession();
  const sessionId = session?.id ?? engine.ensureSession().id;
  const actor = vtt.actorFrom({
    userId: user?.id ?? null,
    role: user?.role ?? 'system',
    viewer: viewerFor(user, 'api'),
    playerId: user ? engine.store.getPlayerByAuthUserId(user.id, sessionId)?.id ?? null : null,
  });

  try {
    assertSameOrigin(request);
    if (head === 'snapshot' && method === 'GET') {
      if (!user) return json({ error: 'unauthenticated', message: 'Authentication required' }, 401);
      const instanceId = new URL(request.url).searchParams.get('instanceId') ?? undefined;
      return json(vtt.snapshot(sessionId, actor, instanceId ?? undefined));
    }

    if (head === 'events' && method === 'GET') {
      if (!user) return json({ error: 'unauthenticated', message: 'Authentication required' }, 401);
      const after = Number(new URL(request.url).searchParams.get('after') ?? '0');
      return json({ events: vtt.eventsSince(sessionId, after) });
    }

    if (head === 'commands' && method === 'POST') {
      if (!user) return json({ error: 'unauthenticated', message: 'Authentication required' }, 401);
      const body = await request.json();
      const outcome = await vtt.execute(body, actor);
      return json(outcome, outcome.ok ? 200 : 400);
    }

    if (head === 'assets' && method === 'POST') {
      if (!user) return json({ error: 'unauthenticated', message: 'Authentication required' }, 401);
      const body = (await request.json()) as { name?: string; mime?: string; data?: string };
      const buffer = Buffer.from(body.data ?? '', 'base64');
      const asset = vtt.uploadAsset(buffer, body.name ?? 'upload.bin', actor, body.mime);
      return json({ asset });
    }

    if (head === 'preflight' && method === 'GET') {
      if (!user) return json({ error: 'unauthenticated', message: 'Authentication required' }, 401);
      return json(vtt.preflight(sessionId));
    }

    if (head === 'replay' && method === 'GET') {
      if (!user) return json({ error: 'unauthenticated', message: 'Authentication required' }, 401);
      return json({ frames: vtt.replay(sessionId) });
    }

    if (head === 'ephemeral' && method === 'POST') {
      if (!user) return json({ error: 'unauthenticated', message: 'Authentication required' }, 401);
      const body = (await request.json()) as Record<string, unknown>;
      vtt.pushEphemeral({ ...body, actorId: user.id });
      return json({ ok: true });
    }

    if (head === 'ephemeral' && method === 'GET') {
      return json({ events: vtt.listEphemeral() });
    }

    if (head === 'scoped-token' && method === 'POST') {
      if (!user || (user.role !== 'admin' && user.role !== 'dm')) {
        return json({ error: 'forbidden', message: 'Forbidden' }, 403);
      }
      const body = (await request.json()) as { kind?: string; label?: string };
      const issued = vtt.issueScopedToken(
        (body.kind as 'broadcast') ?? 'broadcast',
        body.label ?? 'scoped',
        sessionId,
        user.id
      );
      return json({ token: issued.token, id: issued.record.id, kind: issued.record.kind });
    }

    void tail;
    return null;
  } catch (error) {
    if (error instanceof ProtocolError) {
      return json(error.toJSON(), error.httpStatus);
    }
    throw error;
  }
}
