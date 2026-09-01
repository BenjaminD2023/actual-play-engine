import {
  AuthPolicyError,
  LivePlayError,
  ShowCueError,
  type ActualPlayEngine,
  type CommandSource,
  type CommandType,
  type UserRole,
} from '@actualplay/engine';
import { getRequestUser, login, requireUser, serializeSessionCookie, SESSION_COOKIE, type PublicUser } from './auth.js';

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof Error && error.message === 'UNAUTHENTICATED') {
    return json({ error: 'Authentication required' }, 401);
  }
  if (error instanceof Error && error.message === 'FORBIDDEN') {
    return json({ error: 'Forbidden' }, 403);
  }
  if (error instanceof AuthPolicyError) return json({ error: error.message }, 403);
  if (error instanceof ShowCueError || error instanceof LivePlayError) {
    return json({ error: error.message }, 400);
  }
  return json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function handleActualPlayRequest(
  engine: ActualPlayEngine,
  request: Request,
  path: string[]
): Promise<Response> {
  try {
    const user = getRequestUser(engine, request.headers.get('cookie'));
    const bridgeOk = Boolean(bearerToken(request) && engine.verifyBridgeToken(bearerToken(request)!));
    const method = request.method.toUpperCase();
    const [head, ...rest] = path;

    if (head === 'auth' && rest[0] === 'login' && method === 'POST') {
      const body = (await request.json()) as { username?: string; password?: string };
      const result = await login(engine, body.username ?? '', body.password ?? '');
      const cookie = `${SESSION_COOKIE}=${encodeURIComponent(serializeSessionCookie(result.session))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
      return json({ user: result.user }, 200, { 'set-cookie': cookie });
    }

    if (head === 'auth' && rest[0] === 'logout' && method === 'POST') {
      return json({ ok: true }, 200, {
        'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`,
      });
    }

    if (head === 'auth' && rest[0] === 'session' && method === 'GET') {
      return json({ user });
    }

    if (head === 'qlab' && rest[0] === 'health' && method === 'GET') {
      requireUser(user, ['admin', 'dm']);
      return json(engine.health());
    }

    if (head === 'qlab' && method === 'POST') {
      requireUser(user, ['admin', 'dm']);
      const action = rest[0];
      const body = await safeJson(request);
      const map: Record<string, CommandType> = {
        go: 'qlab.go',
        stop: 'qlab.stop',
        panic: 'qlab.panic',
        reset: 'qlab.reset',
      };
      const type = map[action ?? ''];
      if (!type) return json({ error: 'Unknown QLab command' }, 404);
      const result = await engine.dispatch({
        id: crypto.randomUUID(),
        type,
        source: user!.role,
        actorId: user!.id,
        payload: body,
      });
      return json(result, result.ok ? 200 : result.status === 'unconfirmed' ? 202 : 502);
    }

    if (head === 'show' && rest[0] === 'cues' && method === 'GET') {
      requireUser(user, ['admin', 'dm']);
      return json({ cues: engine.cues.list() });
    }

    if (head === 'show' && rest[0] === 'cues' && method === 'PUT') {
      requireUser(user, ['admin']);
      const body = (await request.json()) as { cues?: Record<string, string> };
      engine.cues.replace(body.cues ?? {});
      engine.store.setShowCues(engine.cues.list());
      return json({ cues: engine.cues.list() });
    }

    if (head === 'show' && rest[0] === 'cues' && rest[2] === 'trigger' && method === 'POST') {
      requireUser(user, ['admin', 'dm']);
      const result = await engine.fireShowCue(decodeURIComponent(rest[1] ?? ''), {
        source: user!.role,
        actorId: user!.id,
      });
      return json(result, result.ok ? 200 : result.status === 'unconfirmed' ? 202 : 502);
    }

    if (head === 'log' && method === 'GET') {
      requireUser(user, ['admin', 'dm']);
      return json({ entries: engine.store.listFireLog(200) });
    }

    if (head === 'midi' && rest[0] === 'relay' && method === 'POST') {
      if (!bridgeOk) requireUser(user, ['admin', 'dm']);
      const body = await request.json();
      const result = await engine.ingestMidi(body, bridgeOk ? 'bridge' : (user!.role as CommandSource));
      return json({ ok: true, result });
    }

    if (head === 'midi' && rest[0] === 'bridge-token' && method === 'GET') {
      requireUser(user, ['admin']);
      const config = engine.store.getConfig();
      return json({
        configured: Boolean(config.bridgeTokenHash),
        createdAt: config.bridgeTokenCreatedAt,
      });
    }

    if (head === 'midi' && rest[0] === 'bridge-token' && method === 'POST') {
      requireUser(user, ['admin']);
      const rotated = engine.rotateBridgeToken();
      return json({ token: rotated.token, createdAt: rotated.createdAt });
    }

    if (head === 'session' && method === 'GET') {
      requireUser(user, ['admin', 'dm']);
      return json({
        session: engine.store.getActiveSession(),
        state: engine.store.getActiveSession()
          ? engine.store.getGameState(engine.store.getActiveSession()!.id)
          : null,
      });
    }

    if (head === 'session' && method === 'POST') {
      requireUser(user, ['admin', 'dm']);
      const body = await safeJson(request);
      const session = engine.store.createSession({ name: String(body.name ?? 'Session') });
      return json({ session });
    }

    if (head === 'combat' && method === 'POST') {
      requireUser(user, ['admin', 'dm']);
      const command = rest[0] ?? '';
      const type = (`combat.${command}` ) as CommandType;
      const body = await safeJson(request);
      const result = await engine.dispatch({
        id: crypto.randomUUID(),
        type,
        source: user!.role,
        actorId: user!.id,
        payload: body,
      });
      return json(result, result.ok || result.skipped ? 200 : 502);
    }

    if (head === 'players' && method === 'GET') {
      requireUser(user, ['admin', 'dm', 'player', 'audience']);
      const session = engine.store.getActiveSession();
      return json({ players: session ? engine.store.listPlayers(session.id) : [] });
    }

    if (head === 'players' && rest[1] === 'hp' && method === 'POST') {
      const actor = requireUser(user, ['admin', 'dm', 'player']);
      const body = (await request.json()) as { delta?: number; version?: number };
      const updated = engine.updatePlayerHp(rest[0]!, Number(body.delta ?? 0), body.version);
      return json({ player: updated });
    }

    if (head === 'players' && method === 'PATCH') {
      requireUser(user, ['admin', 'dm', 'player', 'audience']);
      const body = (await request.json()) as Record<string, unknown>;
      const updated = engine.patchPlayer(rest[0]!, body);
      return json({ player: updated });
    }

    if (head === 'polls' && method === 'POST' && rest.length === 0) {
      requireUser(user, ['admin', 'dm', 'audience']);
      const body = (await request.json()) as Record<string, unknown>;
      const poll = engine.openPoll({
        question: body.question,
        options: body.options,
        countdownEnabled: body.countdown_enabled,
        betray: Boolean(body.betray),
      });
      return json({ poll, options: engine.store.listPollOptions(poll.id) });
    }

    if (head === 'polls' && rest[1] === 'vote' && method === 'POST') {
      const body = (await request.json()) as { optionId?: string; fingerprint?: string };
      const option = engine.vote(rest[0]!, String(body.optionId), String(body.fingerprint ?? user?.id ?? 'anon'));
      return json({ option });
    }

    if (head === 'polls' && method === 'POST') {
      requireUser(user, ['admin', 'dm', 'audience']);
      const poll = engine.managePoll(rest[0]!, rest[1] ?? (await request.json() as { action?: string }).action);
      return json({ poll });
    }

    if (head === 'actions' && rest[1] === 'trigger' && method === 'POST') {
      const actor = requireUser(user, ['admin', 'dm', 'player', 'audience']);
      const result = await engine.dispatch({
        id: crypto.randomUUID(),
        type: 'player.action',
        source: actor.role,
        actorId: actor.id,
        payload: { actionId: rest[0] },
      });
      return json(result, result.ok ? 200 : 502);
    }

    if (head === 'events' && method === 'GET') {
      requireUser(user);
      return sse(engine, user);
    }

    if (head === 'midi' && rest[0] === 'stream' && method === 'GET') {
      if (!bridgeOk) requireUser(user, ['admin', 'dm']);
      return sse(engine, user);
    }

    return json({ error: 'Not found' }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}

function sse(engine: ActualPlayEngine, _user: PublicUser | null): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      send({ type: 'hello', health: engine.health() });
      const unsubscribe = engine.events.subscribe((event) => send(event));
      const heartbeat = setInterval(() => send({ type: 'ping' }), 15000);
      return () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
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

async function safeJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export type { UserRole };
