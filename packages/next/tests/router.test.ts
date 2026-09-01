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
});
