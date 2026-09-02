import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { MockQLabServer } from '../src/mock-qlab/server.js';
import { cryptProject, pngAsset, productionHarness } from './production-helpers.js';

const dirs: string[] = [];
const engines: Array<{ stop: () => Promise<void> }> = [];
const servers: MockQLabServer[] = [];

afterEach(async () => {
  while (engines.length) await engines.pop()?.stop();
  while (servers.length) await servers.pop()?.stop();
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('production QLab unconfirmed', () => {
  it('keeps VTT mutations when the cue ack drops and retryExternal does not repeat internal steps', async () => {
    const server = new MockQLabServer();
    servers.push(server);
    const { host, port } = await server.start();
    const h = await productionHarness({
      host,
      port,
      replyTimeoutMs: 200,
      heartbeatIntervalMs: 60_000,
      reconnectMinMs: 10_000,
    });
    engines.push(h.engine);
    dirs.push(h.dir);

    const asset = pngAsset();
    const zip = h.engine.production.exportPack(cryptProject(asset), [asset]);
    const report = h.engine.production.importPack(zip, h.dm);
    const deployment = h.engine.production.createDeployment({ revisionId: report.revisionId }, h.dm);
    h.engine.production.bindCue(
      deployment.id,
      {
        slotId: 'slot_door_sound',
        kind: 'show_cue',
        cueName: 'crypt-door',
        cueNumber: null,
        oscTemplateId: null,
        tested: false,
        lastResult: null,
        acceptedWarning: null,
      },
      h.dm
    );
    await h.engine.production.publishDeployment(deployment.id, h.dm);

    server.dropNext(1);
    const run = await h.engine.production.executeAction(deployment.id, 'act_open_west', h.dm);
    expect(run.steps[0]?.status).toBe('ok');
    expect(run.steps[1]?.status).toBe('ok');
    expect(run.steps[2]?.status).toBe('ok');
    expect(run.steps[3]?.status).toBe('ok');
    expect(run.steps[4]?.status).toBe('unconfirmed');
    expect(run.steps[4]?.qlab?.confirmed).toBe(false);

    const instanceId = h.engine.production.tables.listSceneMaps(deployment.id)[0]?.vttInstanceId;
    const live = h.engine.vtt.tables.getInstance(instanceId!)!;
    expect(live.state.doors.find((door) => door.id === 'door_west')?.state).toBe('open');
    const fogCount = live.state.fog.length;
    expect(fogCount).toBeGreaterThan(0);

    const retried = await h.engine.production.retryExternal(run.id, h.dm);
    expect(retried.steps[0]?.status).toBe('ok');
    expect(retried.steps[4]?.status).toBe('ok');
    expect(retried.steps[4]?.qlab?.confirmed).toBe(true);
    const after = h.engine.vtt.tables.getInstance(instanceId!)!;
    expect(after.state.fog.length).toBe(fogCount);
    expect(after.state.doors.find((door) => door.id === 'door_west')?.state).toBe('open');
  });
});
