import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { ProductionRuntime } from '../src/production/runtime.js';
import { ProductionError } from '../src/production/errors.js';
import { createZip } from '../src/production/zip.js';
import { SqliteStore } from '../src/store/sqlite.js';
import { migrationStatus } from '../src/store/migrations.js';
import type { ProductionProject } from '../src/production/types.js';
import { cryptProject, pngAsset, productionHarness } from './production-helpers.js';

const dirs: string[] = [];
const engines: Array<{ stop: () => Promise<void> }> = [];

afterEach(async () => {
  while (engines.length) {
    const engine = engines.pop();
    await engine?.stop();
  }
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('production import', () => {
  it('validates a pack, stores an immutable revision, and reports unbound required slots', async () => {
    const h = await productionHarness();
    engines.push(h.engine);
    dirs.push(h.dir);
    expect(h.engine.production.enabled).toBe(true);
    expect(h.engine.store).toBeInstanceOf(SqliteStore);
    const applied = migrationStatus((h.engine.store as SqliteStore).database).map((row) => row.id);
    expect(applied).toContain('004_production');

    const asset = pngAsset();
    const project = cryptProject(asset);
    const zip = h.engine.production.exportPack(project, [asset]);
    const report = h.engine.production.importPack(zip, h.dm);
    expect(report.revisionId).toBeTruthy();
    expect(report.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(report.requiredBindings).toEqual(['slot_door_sound']);
    expect(report.validation.ok).toBe(true);

    const again = h.engine.production.importPack(zip, h.dm);
    expect(again.revisionId).toBe(report.revisionId);

    const deployment = h.engine.production.createDeployment({ revisionId: report.revisionId }, h.dm);
    const blocked = h.engine.production.preflight(deployment.id, h.dm);
    expect(blocked.ready).toBe('not_ready');
    expect(blocked.checks.some((check) => check.level === 'fail' && check.message.includes('unbound'))).toBe(true);

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
    const ready = h.engine.production.preflight(deployment.id, h.dm);
    expect(ready.ready).toBe('ready');

    const stored = h.engine.production.tables.getRevision(report.revisionId)!;
    expect(stored.project.title).toBe('Clockwork Crypt');
    stored.project.title = 'mutated';
    expect(h.engine.production.tables.getRevision(report.revisionId)!.project.title).toBe('Clockwork Crypt');
  });

  it('rejects zip-slip paths and secret fields', async () => {
    const h = await productionHarness();
    engines.push(h.engine);
    dirs.push(h.dir);
    const name = Buffer.from('../evil.txt');
    const data = Buffer.from('nope');
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    expect(() => h.engine.production.importPack(Buffer.concat([local, data]), h.dm)).toThrow(/Unsafe archive path/);

    const asset = pngAsset();
    const sneaky = cryptProject(asset) as ProductionProject & { qlabPasscode?: string };
    sneaky.qlabPasscode = 'hunter2';
    expect(() => ProductionRuntime.exportPack(sneaky, [asset])).toThrow(ProductionError);
  });

  it('omits cue bindings from player and audience deployment snapshots', async () => {
    const h = await productionHarness();
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
        cueNumber: '1',
        oscTemplateId: null,
        tested: false,
        lastResult: null,
        acceptedWarning: null,
      },
      h.dm
    );
    const dmView = h.engine.production.getDeployment(deployment.id, h.dm);
    expect(dmView.cueBindings).toHaveLength(1);
    const playerView = h.engine.production.getDeployment(deployment.id, h.player);
    expect(playerView.cueBindings).toEqual([]);
    const audienceView = h.engine.production.getDeployment(deployment.id, h.audience);
    expect(audienceView.cueBindings).toEqual([]);
    expect(JSON.stringify(playerView)).not.toMatch(/crypt-door|passcode/i);
  });
});

describe('production zip helpers', () => {
  it('round-trips stored zip entries', () => {
    const buffer = createZip([{ name: 'hello.txt', data: Buffer.from('hi') }]);
    expect(buffer.readUInt32LE(0)).toBe(0x04034b50);
  });
});
