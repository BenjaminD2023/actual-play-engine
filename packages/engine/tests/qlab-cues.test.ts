import { describe, expect, it } from 'vitest';
import { flattenQLabCues } from '../src/qlab/cues.js';
import { createEngine } from '../src/engine.js';
import { memoryStore } from '../src/store/memory.js';
import net from 'node:net';

describe('flattenQLabCues', () => {
  it('flattens nested QLab cue list JSON', () => {
    const cues = flattenQLabCues([
      {
        uniqueID: 'list-1',
        name: 'Main Cue List',
        type: 'Cue List',
        cues: [
          { uniqueID: 'c1', number: '1', name: 'Welcome', type: 'Audio' },
          { uniqueID: 'c10', number: '10', name: 'Battle', type: 'Group', cues: [
            { uniqueID: 'c11', number: '10.1', name: 'Sting', type: 'Audio' },
          ] },
        ],
      },
    ]);
    expect(cues.map((cue) => cue.number).filter(Boolean)).toEqual(['1', '10', '10.1']);
    expect(cues.find((cue) => cue.number === '1')?.name).toBe('Welcome');
  });
});

describe('engine start with real QLab config', () => {
  it('does not crash the product if QLab is not listening', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    const port = address.port;
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const engine = createEngine({
      store: memoryStore(),
      qlab: { host: '127.0.0.1', port, connectTimeoutMs: 200, replyTimeoutMs: 200, reconnectMinMs: 10_000 },
    });
    await engine.start();
    expect(engine.qlab.kind).toBe('tcp');
    expect(engine.health().qlab.connected).toBe(false);
    await engine.stop();
  });
});
