import { afterEach, describe, expect, it } from 'vitest';
import { MockQLabServer } from '../src/mock-qlab/server.js';
import { QLabSession } from '../src/qlab/session.js';
import { DryRunQLab } from '../src/qlab/dry-run.js';

const servers: MockQLabServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server?.stop();
  }
});

async function startMock(options?: ConstructorParameters<typeof MockQLabServer>[0]) {
  const server = new MockQLabServer(options);
  servers.push(server);
  const listen = await server.start();
  return { server, ...listen };
}

describe('QLabSession', () => {
  it('connects, authenticates, and starts a numbered cue with an ack', async () => {
    const { host, port, server } = await startMock({ passcode: 'secret' });
    const session = new QLabSession({ host, port, passcode: 'secret', heartbeatIntervalMs: 60_000 });
    await session.start();

    const result = await session.startCue('1.1');
    expect(result.status).toBe('ok');
    expect(result.confirmed).toBe(true);
    expect(result.address).toBe('/workspace/mock-workspace/cue/1.1/start');
    expect(server.received.some((message) => message.address.endsWith('/cue/1.1/start'))).toBe(true);

    const health = session.health();
    expect(health.connected).toBe(true);
    expect(health.authenticated).toBe(true);
    expect(health.version).toBe('5.4.8');

    await session.stop();
  });

  it('panic jumps ahead of a normal cue still in the queue', async () => {
    const { host, port, server } = await startMock({ delayMs: 40 });
    const session = new QLabSession({
      host,
      port,
      heartbeatIntervalMs: 60_000,
      replyTimeoutMs: 2000,
    });
    await session.start();

    const first = session.startCue('1');
    const panic = session.panic();
    const second = session.startCue('2');

    await Promise.all([first, panic, second]);
    const addresses = server.received.map((message) => message.address);
    const startIndex = addresses.findIndex((address) => address.endsWith('/cue/1/start'));
    const panicIndex = addresses.findIndex((address) => address.endsWith('/panic'));
    const secondIndex = addresses.findIndex((address) => address.endsWith('/cue/2/start'));
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(panicIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThan(panicIndex);

    await session.stop();
  });

  it('returns unconfirmed instead of ok when QLab drops the reply', async () => {
    const { host, port, server } = await startMock();
    const session = new QLabSession({
      host,
      port,
      heartbeatIntervalMs: 60_000,
      replyTimeoutMs: 200,
      reconnectMinMs: 10_000,
    });
    await session.start();
    server.dropNext(1);

    const result = await session.startCue('9');
    expect(result.status).toBe('unconfirmed');
    expect(result.confirmed).toBe(false);

    await session.stop();
  });

  it('rejects a bad passcode', async () => {
    const { host, port } = await startMock({ passcode: 'right' });
    const session = new QLabSession({ host, port, passcode: 'wrong', heartbeatIntervalMs: 60_000 });
    await expect(session.start()).rejects.toThrow(/passcode|badpass/i);
    await session.stop();
  });

  it('reconnects after the mock drops and still fires the next cue', async () => {
    const { host, port, server } = await startMock();
    const session = new QLabSession({
      host,
      port,
      heartbeatIntervalMs: 60_000,
      replyTimeoutMs: 300,
      reconnectMinMs: 50,
      reconnectMaxMs: 100,
    });
    await session.start();
    server.dropNext(1);
    await session.startCue('1');

    const recovered = await session.startCue('2');
    expect(recovered.status).toBe('ok');
    await session.stop();
  });
});

describe('DryRunQLab', () => {
  it('records fires without opening a socket', async () => {
    const qlab = new DryRunQLab();
    await qlab.start();
    const result = await qlab.startCue('42');
    expect(result.confirmed).toBe(true);
    expect(qlab.fires[0]?.address).toBe('/workspace/dry-run/cue/42/start');
    await qlab.stop();
  });
});
