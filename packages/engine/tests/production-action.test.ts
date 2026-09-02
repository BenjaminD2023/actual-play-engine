import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { ACTION_CATALOG } from '../src/vtt/actions.js';
import { ProtocolError } from '@actualplay/protocol';
import { cryptProject, pngAsset, productionHarness } from './production-helpers.js';

const dirs: string[] = [];
const engines: Array<{ stop: () => Promise<void> }> = [];

afterEach(async () => {
  while (engines.length) await engines.pop()?.stop();
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function liveDeployment() {
  const h = await productionHarness();
  engines.push(h.engine);
  dirs.push(h.dir);
  const asset = pngAsset();
  const zip = h.engine.production.exportPack(cryptProject(asset), [asset]);
  const report = h.engine.production.importPack(zip, h.dm);
  const deployment = h.engine.production.createDeployment({ revisionId: report.revisionId, dmUserIds: ['user-dm'] }, h.dm);
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
  h.engine.production.bindActor(deployment.id, { actorId: 'actor_ranger', playerId: 'player-1', userId: 'user-p1' }, h.dm);
  await h.engine.production.publishDeployment(deployment.id, h.dm);
  return { ...h, deploymentId: deployment.id };
}

describe('production Open West Door', () => {
  it('mutates VTT and fires the bound QLab cue', async () => {
    const h = await liveDeployment();
    expect(ACTION_CATALOG).toContain('production_action');
    const run = await h.engine.production.executeAction(h.deploymentId, 'act_open_west', h.dm);
    expect(run.steps.map((step) => step.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(run.steps[4]?.qlab?.confirmed).toBe(true);

    const maps = h.engine.production.tables.listSceneMaps(h.deploymentId);
    const instanceId = maps[0]?.vttInstanceId;
    expect(instanceId).toBeTruthy();
    const live = h.engine.vtt.tables.getInstance(instanceId!)!;
    expect(live.state.doors.find((door) => door.id === 'door_west')?.state).toBe('open');
    expect(live.state.fog.some((op) => op.kind === 'reveal')).toBe(true);
    expect(live.state.lights.find((light) => light.id === 'light_torch')?.enabled).toBe(true);
    expect(h.engine.production.tables.getVariables(h.deploymentId).var_door).toBe(true);

    const dmSnap = h.engine.vtt.snapshot(h.session.id, h.dm, instanceId);
    expect(dmSnap.live?.tokens.some((token) => token.id === 'tok_lurker')).toBe(true);
    const playerSnap = h.engine.vtt.snapshot(h.session.id, h.player, instanceId);
    expect(playerSnap.live?.tokens.some((token) => token.id === 'tok_lurker')).toBe(false);
    expect(JSON.stringify(playerSnap)).not.toMatch(/cueBindings|qlabPasscode|passcode/i);

    const pages = h.engine.production.listControls(h.deploymentId, h.dm);
    expect(pages[0]?.controls.some((control) => control.label === 'Open West Door')).toBe(true);
  });

  it('rejects player execution and routes production_action through the catalog', async () => {
    const h = await liveDeployment();
    await expect(h.engine.production.executeAction(h.deploymentId, 'act_open_west', h.player)).rejects.toBeInstanceOf(
      ProtocolError
    );
    await expect(h.engine.production.executeAction(h.deploymentId, 'act_open_west', h.player)).rejects.toMatchObject({
      code: 'forbidden',
    });

    const midi = await h.engine.ingestMidi(
      { actionType: 'production_action', actionData: { deploymentId: h.deploymentId, actionId: 'act_open_west' } },
      'midi'
    );
    expect(midi?.ok).toBe(true);
    const instanceId = h.engine.production.tables.listSceneMaps(h.deploymentId)[0]?.vttInstanceId;
    expect(h.engine.vtt.tables.getInstance(instanceId!)!.state.doors[0]?.state).toBe('open');
  });
});
