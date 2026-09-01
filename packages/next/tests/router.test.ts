import { describe, expect, it } from 'vitest';
import { createEngine, createId, nowIso } from '@actualplay/engine';
import { bootstrapAdmin } from '../src/auth.js';
import { handleActualPlayRequest } from '../src/router.js';

describe('Next adapter router', () => {
  it('rejects unauthenticated cue fires and accepts an admin session', async () => {
    const engine = createEngine({
      qlab: { dryRun: true },
      cues: { 'show.welcome': '1' },
    });
    await engine.start();
    await bootstrapAdmin(engine, { username: 'admin', password: 'secret' });

    const denied = await handleActualPlayRequest(
      engine,
      new Request('http://localhost/api/actualplay/show/cues/show.welcome/trigger', { method: 'POST' }),
      ['show', 'cues', 'show.welcome', 'trigger']
    );
    expect(denied.status).toBe(401);

    const login = await handleActualPlayRequest(
      engine,
      new Request('http://localhost/api/actualplay/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'admin', password: 'secret' }),
      }),
      ['auth', 'login']
    );
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie') ?? '';

    const fired = await handleActualPlayRequest(
      engine,
      new Request('http://localhost/api/actualplay/show/cues/show.welcome/trigger', {
        method: 'POST',
        headers: { cookie },
      }),
      ['show', 'cues', 'show.welcome', 'trigger']
    );
    expect(fired.status).toBe(200);
    const body = (await fired.json()) as { ok: boolean; cueNumber: string };
    expect(body.ok).toBe(true);
    expect(body.cueNumber).toBe('1');

    await engine.stop();
  });

  it('returns 502 when a mapped cue is missing', async () => {
    const engine = createEngine({ qlab: { dryRun: true }, cues: {} });
    await engine.start();
    await bootstrapAdmin(engine, { username: 'admin', password: 'secret' });
    const login = await handleActualPlayRequest(
      engine,
      new Request('http://localhost/api/actualplay/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'admin', password: 'secret' }),
      }),
      ['auth', 'login']
    );
    const cookie = login.headers.get('set-cookie') ?? '';
    const fired = await handleActualPlayRequest(
      engine,
      new Request('http://localhost/api/actualplay/show/cues/show.end/trigger', {
        method: 'POST',
        headers: { cookie },
      }),
      ['show', 'cues', 'show.end', 'trigger']
    );
    expect(fired.status).toBe(502);
    await engine.stop();
  });

  it('ignores unused helper imports for typecheck', () => {
    expect(createId().length).toBeGreaterThan(0);
    expect(nowIso()).toContain('T');
  });

  it('blocks a cross-origin VTT command', async () => {
    const engine = createEngine({ qlab: { dryRun: true }, cues: { 'show.welcome': '1' }, vtt: { enabled: true } });
    await engine.start();
    await bootstrapAdmin(engine, { username: 'admin', password: 'secret' });
    const login = await handleActualPlayRequest(
      engine,
      new Request('http://127.0.0.1/api/actualplay/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'admin', password: 'secret' }),
      }),
      ['auth', 'login']
    );
    const cookie = login.headers.get('set-cookie') ?? '';
    const blocked = await handleActualPlayRequest(
      engine,
      new Request('http://127.0.0.1/api/actualplay/vtt/commands', {
        method: 'POST',
        headers: { cookie, origin: 'http://evil.example', 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'cmd-x',
          protocolVersion: 1,
          type: 'ping.create',
          sessionId: 's',
          payload: { x: 1, y: 1 },
        }),
      }),
      ['vtt', 'commands']
    );
    expect(blocked.status).toBe(403);
    await engine.stop();
  });

  it('rejects a forged JSON session cookie', async () => {
    const engine = createEngine({ qlab: { dryRun: true }, cues: { 'show.welcome': '1' } });
    await engine.start();
    await bootstrapAdmin(engine, { username: 'admin', password: 'secret' });
    const forged = await handleActualPlayRequest(
      engine,
      new Request('http://localhost/api/actualplay/qlab/health', {
        headers: {
          cookie: `actualplay_session=${encodeURIComponent(JSON.stringify({ userId: 'nope', role: 'admin', expires: Date.now() + 99999 }))}`,
        },
      }),
      ['qlab', 'health']
    );
    expect(forged.status).toBe(401);
    await engine.stop();
  });

  it('presses a virtual button through the VTT action catalog', async () => {
    const engine = createEngine({
      qlab: { dryRun: true },
      cues: { 'show.welcome': '1' },
      vtt: { enabled: true },
    });
    await engine.start();
    await bootstrapAdmin(engine, { username: 'admin', password: 'secret' });
    const login = await handleActualPlayRequest(
      engine,
      new Request('http://localhost/api/actualplay/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'admin', password: 'secret' }),
      }),
      ['auth', 'login']
    );
    const cookie = login.headers.get('set-cookie') ?? '';
    const created = await handleActualPlayRequest(
      engine,
      new Request('http://localhost/api/actualplay/buttons', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Mark', action_type: 'recording_marker', action_data: { label: 'http-btn' } }),
      }),
      ['buttons']
    );
    expect(created.status).toBe(200);
    const { button } = (await created.json()) as { button: { id: string } };
    const pressed = await handleActualPlayRequest(
      engine,
      new Request(`http://localhost/api/actualplay/buttons/${button.id}/press`, {
        method: 'POST',
        headers: { cookie },
      }),
      ['buttons', button.id, 'press']
    );
    expect(pressed.status).toBe(200);
    const session = engine.store.getActiveSession()!;
    expect(engine.vtt.tables.listMarkers(session.id).some((row) => row.label === 'http-btn')).toBe(true);
    await engine.stop();
  });
});
