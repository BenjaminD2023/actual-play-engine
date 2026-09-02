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

    if (head === 'stream' && method === 'GET') {
      if (!user) return json({ error: 'unauthenticated', message: 'Authentication required' }, 401);
      const last = Number(request.headers.get('last-event-id') ?? '0');
      const encoder = new TextEncoder();
      let lastSent = last;
      const stream = new ReadableStream({
        start(controller) {
          const send = (event: unknown, id: number) => {
            controller.enqueue(encoder.encode(`id: ${id}\ndata: ${JSON.stringify(event)}\n\n`));
          };
          const replay = vtt.eventsSince(sessionId, last);
          send({ type: 'hello', lastEventSequence: vtt.tables.lastSequence(sessionId), replay }, last);
          const unsubscribe = engine.events.subscribe(() => {
            const events = vtt.eventsSince(sessionId, lastSent);
            for (const event of events) {
              lastSent = event.sequence;
              send({ type: 'vtt.event', event }, event.sequence);
            }
          });
          const heartbeat = setInterval(() => send({ type: 'ping' }, lastSent), 15000);
          const close = () => {
            clearInterval(heartbeat);
            unsubscribe();
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          };
          request.signal.addEventListener('abort', close);
        },
      });
      return new Response(stream, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        },
      });
    }

    if (head === 'library' && method === 'GET') {
      if (!user) return json({ error: 'unauthenticated', message: 'Authentication required' }, 401);
      return json(vtt.library(sessionId));
    }

    if (head === 'assets' && method === 'GET') {
      if (!user) return json({ error: 'unauthenticated', message: 'Authentication required' }, 401);
      const id = tail[0];
      if (!id) return json({ error: 'not_found', message: 'Asset id required' }, 404);
      const variant = (new URL(request.url).searchParams.get('variant') as 'original' | 'display' | 'thumb') || 'display';
      const file = vtt.assets.readById(id, variant);
      const bytes = Uint8Array.from(file.buffer);
      return new Response(bytes, {
        headers: {
          'content-type': file.mime,
          'content-length': String(bytes.byteLength),
        },
      });
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

    if (head === 'replay' && tail[0] === 'export' && method === 'GET') {
      if (!user) return json({ error: 'unauthenticated', message: 'Authentication required' }, 401);
      const format = new URL(request.url).searchParams.get('format') ?? 'json';
      if (format === 'csv') {
        return new Response(vtt.exportReplayCsv(sessionId), {
          headers: { 'content-type': 'text/csv; charset=utf-8' },
        });
      }
      if (format === 'markers') {
        return json({ markers: vtt.exportChapterMarkers(sessionId), liveMutated: false });
      }
      return json(vtt.exportReplayJson(sessionId));
    }

    if (head === 'replay' && method === 'GET') {
      if (!user) return json({ error: 'unauthenticated', message: 'Authentication required' }, 401);
      const atRaw = new URL(request.url).searchParams.get('at');
      if (atRaw === null || atRaw === '') {
        return json({ frames: vtt.replay(sessionId), liveMutated: false });
      }
      const reconstructed = vtt.replayAt(sessionId, Number(atRaw), actor);
      return json(reconstructed);
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
