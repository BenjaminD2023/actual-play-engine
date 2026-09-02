import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEngine } from '../src/engine.js';
import { sqliteStore } from '../src/store/sqlite.js';
import { emptyProject } from '../src/production/spec.js';
import type { PackedAsset, ProductionProject } from '../src/production/types.js';
import type { QLabNetworkConfig } from '../src/qlab/types.js';

export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

export function pngAsset(id = 'asset_map'): PackedAsset {
  return {
    id,
    hash: createHash('sha256').update(TINY_PNG).digest('hex'),
    mime: 'image/png',
    originalName: 'crypt.png',
    byteSize: TINY_PNG.byteLength,
    role: 'map',
    data: TINY_PNG,
  };
}

export function cryptProject(asset: PackedAsset = pngAsset()): ProductionProject {
  const project = emptyProject({ title: 'Clockwork Crypt', author: 'maker' });
  project.assets.push({
    id: asset.id,
    hash: asset.hash,
    mime: asset.mime,
    originalName: asset.originalName,
    byteSize: asset.byteSize,
    role: asset.role,
  });
  project.variables.push({ id: 'var_door', key: 'westDoorOpen', kind: 'boolean', defaultValue: false });
  project.cueSlots.push({
    id: 'slot_door_sound',
    key: 'sound.west-door.open',
    name: 'West door grind',
    category: 'sound',
    description: 'Stone grinding',
    expectedEffect: 'One-shot door scrape',
    suggestedCueName: 'crypt-door',
    required: true,
    rehearsalNotes: 'Loud',
    expectedDurationMs: 1200,
    startStop: 'start',
    failurePolicy: 'warn',
    dmVisible: true,
  });
  project.actors.push(
    {
      id: 'actor_ranger',
      name: 'Ranger',
      kind: 'player',
      tokenAssetId: null,
      size: 70,
      disposition: 'ally',
      hiddenByDefault: false,
      dmLabel: null,
      bindingSlot: 'player-1',
      visionDistance: 420,
      emitsLight: false,
    },
    {
      id: 'actor_lurker',
      name: 'Lurker',
      kind: 'enemy',
      tokenAssetId: null,
      size: 70,
      disposition: 'enemy',
      hiddenByDefault: true,
      dmLabel: 'hidden scout',
      bindingSlot: null,
      visionDistance: 0,
      emitsLight: false,
    }
  );
  project.scenes.push({
    id: 'scene_crypt',
    title: 'Clockwork Crypt',
    notes: '',
    tags: ['crypt'],
    order: 0,
    archived: false,
    mapAssetId: asset.id,
    animated: false,
    grid: { mode: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.3, unitsPerCell: 5, unitName: 'ft' },
    background: '#111',
    defaultCameraId: 'cam_west',
    defaultControlPageId: 'page_dm',
    encounterId: null,
    startActionId: null,
    endActionId: null,
    fogRegions: [
      {
        id: 'fog_west',
        name: 'West Hall',
        kind: 'reveal',
        shape: 'rect',
        points: [
          { x: 0, y: 0 },
          { x: 200, y: 200 },
        ],
        sceneId: 'scene_crypt',
      },
    ],
    doors: [
      {
        id: 'door_west',
        name: 'West Door',
        sceneId: 'scene_crypt',
        wall: { a: { x: 40, y: 80 }, b: { x: 120, y: 80 } },
        secret: false,
        initialState: 'closed',
        soundSlotId: 'slot_door_sound',
        lightSlotId: null,
        revealRegionId: 'fog_west',
      },
    ],
    windows: [],
    lights: [
      {
        id: 'light_torch',
        name: 'West torches',
        sceneId: 'scene_crypt',
        x: 80,
        y: 80,
        bright: 40,
        dim: 80,
        color: '#ffaa55',
        group: 'west',
      },
    ],
    cameras: [{ id: 'cam_west', name: 'West hall', sceneId: 'scene_crypt', audience: 'broadcast', x: 80, y: 80, zoom: 1 }],
    tokens: [
      { id: 'tok_ranger', actorId: 'actor_ranger', sceneId: 'scene_crypt', x: 70, y: 140, hidden: false, locked: false },
      { id: 'tok_lurker', actorId: 'actor_lurker', sceneId: 'scene_crypt', x: 400, y: 240, hidden: true, locked: false },
    ],
    annotations: [],
  });
  project.actions.push({
    id: 'act_open_west',
    name: 'Open West Door',
    description: 'Open door, reveal hall, fire sound',
    sceneId: 'scene_crypt',
    visibleTo: ['dm'],
    availableWhen: { kind: 'atom', variableId: 'var_door', op: 'is_false' },
    confirmation: 'none',
    cooldownMs: 0,
    failurePolicy: 'warn',
    steps: [
      { id: 'st1', kind: 'open_door', label: 'Open', params: { doorId: 'door_west' }, onFailure: 'halt_all' },
      { id: 'st2', kind: 'reveal_fog', label: 'Reveal', params: { regionId: 'fog_west' }, onFailure: 'warn' },
      { id: 'st3', kind: 'toggle_vtt_light', label: 'Torches', params: { lightId: 'light_torch', enabled: true }, onFailure: 'warn' },
      { id: 'st4', kind: 'set_variable', label: 'Flag', params: { variableId: 'var_door', value: true }, onFailure: 'warn' },
      { id: 'st5', kind: 'fire_sound_slot', label: 'Sound', params: { slotId: 'slot_door_sound' }, onFailure: 'warn' },
    ],
  });
  project.pages.push({
    id: 'page_dm',
    title: 'Crypt tablet',
    sceneId: 'scene_crypt',
    order: 0,
    controls: [
      {
        id: 'ctl_open',
        pageId: 'page_dm',
        kind: 'button',
        label: 'Open West Door',
        description: '',
        color: '#e2b14a',
        size: 'l',
        actionId: 'act_open_west',
        sceneId: 'scene_crypt',
        condition: null,
        confirmation: 'none',
        order: 0,
        group: 'doors',
      },
    ],
  });
  return project;
}

export async function productionHarness(qlab?: QLabNetworkConfig | { dryRun: true }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'production-'));
  const engine = createEngine({
    store: sqliteStore(path.join(dir, 'show.db')),
    qlab: qlab ?? { dryRun: true },
    cues: { 'crypt-door': '1', 'show.welcome': '1' },
    vtt: { enabled: true, assetRoot: path.join(dir, 'assets') },
    production: { enabled: true },
  });
  await engine.start();
  const session = engine.ensureSession('Crypt');
  const now = new Date().toISOString();
  engine.store.createUser({
    id: 'user-dm',
    first_name: 'Dana',
    last_name: 'Master',
    username: 'dm',
    email: 'dm@local',
    role: 'dm',
    password_hash: 'x',
    created_at: now,
    updated_at: now,
  });
  engine.store.createUser({
    id: 'user-p1',
    first_name: 'Pat',
    last_name: 'One',
    username: 'p1',
    email: 'p1@local',
    role: 'player',
    password_hash: 'x',
    created_at: now,
    updated_at: now,
  });
  engine.store.createPlayer({
    id: 'player-1',
    auth_user_id: 'user-p1',
    session_id: session.id,
    character_name: 'Ranger',
    character_class: 'ranger',
    character_level: 3,
    armor_class: 15,
    current_hp: 24,
    max_hp: 24,
    temp_hp: 0,
    version: 1,
    spell_slots_level_1: 0,
    spell_slots_level_2: 0,
    spell_slots_level_3: 0,
    spell_slots_level_4: 0,
    spell_slots_level_5: 0,
    spell_slots_level_6: 0,
    spell_slots_level_7: 0,
    spell_slots_level_8: 0,
    spell_slots_level_9: 0,
    inspiration_tokens: 0,
    portrait_url: '',
    audience_tags: '[]',
    is_active: true,
    created_at: now,
    updated_at: now,
  });
  const dm = engine.vtt.actorFrom({ userId: 'user-dm', role: 'dm' });
  const player = engine.vtt.actorFrom({ userId: 'user-p1', role: 'player', playerId: 'player-1' });
  const audience = engine.vtt.actorFrom({ userId: 'aud', role: 'audience' });
  return { dir, engine, session, dm, player, audience };
}
