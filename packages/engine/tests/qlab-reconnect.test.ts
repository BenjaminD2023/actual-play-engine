import { afterEach, describe, expect, it } from 'vitest';
import { createEngine } from '../src/engine.js';
import { MockQLabServer } from '../src/mock-qlab/server.js';
import { memoryStore } from '../src/store/memory.js';

const servers: MockQLabServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.stop();
  }
});

describe('applyQLabConfig', () => {
  it('switches from dry-run to a live QLab session and fires a numbered cue', async () => {
    const mock = new MockQLabServer();
    servers.push(mock);
    const { host, port } = await mock.start();

    const engine = createEngine({
      store: memoryStore(),
      qlab: { dryRun: true },
      cues: { 'show.welcome': '1' },
    });
    await engine.start();
    expect(engine.qlab.kind).toBe('dry-run');

    await engine.applyQLabConfig({ host, port, heartbeatIntervalMs: 60_000 });
    expect(engine.qlab.kind).toBe('tcp');
    expect(engine.health().qlab.kind).toBe('tcp');

    const result = await engine.dispatch({
      id: 'reconnect-fire',
      type: 'qlab.start',
      source: 'admin',
      payload: { cueNumber: '1' },
    });
    expect(result.ok).toBe(true);
    expect(result.qlab?.confirmed).toBe(true);
    expect(mock.received.some((message) => message.address.endsWith('/cue/1/start'))).toBe(true);

    await engine.stop();
  });
});
