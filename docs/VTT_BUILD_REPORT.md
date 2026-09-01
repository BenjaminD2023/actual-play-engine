# VTT build report

Branch: `feat/full-vtt`  
Date: 2026-09-01  
Nothing was merged, pushed, published, or deployed.

## Phase A — baseline (before VTT)

Recorded in `{SCRATCH}/baseline.log` from `/Users/benjamin/actual-play-engine` while still on `main` at `5aeb3e5` with **uncommitted QLab reconnect/listCues work**.

Git at baseline:

```
On branch main
Your branch is up to date with 'origin/main'.
modified: packages/engine/src/qlab/session.ts
modified: packages/engine/src/commands/bus.ts
… (QLab reconnect / listCues / applyQLabConfig)
untracked: packages/engine/src/qlab/cues.ts
           packages/engine/tests/qlab-cues.test.ts
           packages/engine/tests/qlab-reconnect.test.ts
```

Those files were **not discarded**. They were committed first on this branch as `de1c253 Preserve QLab reconnect, listCues, and applyQLabConfig work.`

| Command | Result |
|---|---|
| `npm install` / workspace audit | ok (138 packages) |
| `npm run build` | ok (engine + next) |
| `npm test` | **38 engine tests**, **3 next tests**, **2 bridge tests** passed |
| `npm run simulate-show` | **1 passed** |

## Architecture delivered

| Package | Role |
|---|---|
| `@actualplay/protocol` | Browser-safe command/event/snapshot schemas, runtime validation |
| `@actualplay/engine` | `createEngine().vtt` (`vtt.enabled` default **false**), migrations 001–003, durable commands/events, projections, assets, replay |
| `@actualplay/next` | Opaque sessions, CSRF Host check, `/api/actualplay/vtt/*`, MIDI relay, virtual-button press |
| `@actualplay/vtt` | Pixi canvas, snapshot client, layer order |
| `apps/vtt-reference` | Director, prepare, player, audience, broadcast, projector, overlay, operator, replay, preflight, rehearsal |

Safety switch: `createEngine()` passes `{ enabled: false }` unless the caller sets `vtt.enabled: true`. `VttRuntime.execute` throws `unavailable` when disabled.

QLab: a dropped acknowledgement is **`unconfirmed`**, never `ok`. Preset steps use `ok \| skipped \| unconfirmed \| failed \| compensated`.

## `npm run verify` (two full runs after the remaining work)

Both runs exit **0**.

### Verify 1 (`{SCRATCH}/verify-1.log`)

Engine: **56 passed**. Next: **6 passed**. `simulate-vtt`: **2 passed**. Playwright: **2 passed (17.1s)**.

### Verify 2 / final (`{SCRATCH}/verify-final.log`, after the 200-token fixture)

```
stdout | tests/vtt-perf.test.ts
{"seedMs":1122,"moveMs":3,"snapMs":2,"tokens":200,"walls":200}

 Test Files  15 passed (15)
      Tests  57 passed (57)

 ✓ tests/vtt-simulate.test.ts (2 tests)
      Tests  2 passed (2)

  ✓  1 tests/e2e/multiclient.spec.ts:46:5 › required views render a canvas or operator controls
  ✓  2 tests/e2e/multiclient.spec.ts:87:5 › multi-client ownership, hidden JSON, and read-only views
  2 passed (9.5s)
```

Next adapter: **6 passed** (includes forged JSON cookie → 401, cross-origin VTT POST → 403, virtual-button catalog press).

### Verify after Phase N expansion (`{SCRATCH}/verify-phase-n.log`)

exit **0**. Engine **58 passed** (16 files). Next **6**. simulate-vtt **2**. Playwright **2 passed (12.8s)**.

```
PHASE_N_COVERED 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91
PHASE_N 70 PASS dropped QLab acknowledgement
PHASE_N 71 PASS result is unconfirmed not ok
  2 passed (12.8s)
```

Check **92** is this `npm run verify`.

### Verify after skeptic repairs (`{SCRATCH}/verify-skeptic.log`)

exit **0**. Engine **59 passed**. Next **6**. VTT client **5**. Playwright **2 passed (11.8s)**.

Repairs recorded here:

- Hex-flat / hex-pointy draw hex cells (`gridDrawModel`); fog/terrain use stored polygons; `mapAssetId` loads `/vtt/assets/:id`.
- Canvas pan (drag empty), wheel zoom, pinch zoom; ping / ruler / drag-preview on the selection layer.
- Director / Prepare / Rehearsal have scene library, grid calibration, wall/door/light/fog/camera, inspector, QLab, rundown, panic.
- Operator: activate scene, run preset, show/hide handout, QLab status, panic, connection-loss warning.
- Audience cannot `poll.open` / `poll.close`; votes stay on `/polls/:id/vote`.
- Webhooks HMAC-sign, POST, and retry; deliveries recorded `ok`/`failed`.
- Clients subscribe to `/vtt/stream` via `VttConnection` (Last-Event-ID + gap fill), not interval snapshot polling.
- Phase N #58 asserts the shown handout id; Playwright `door.setState` expects 200; `runMigrations()` is the rollback test.
- GET `/vtt/assets/:id` copies `Uint8Array.from(buffer)` so pooled Node Buffers do not pad a 70-byte PNG to 8192 bytes (`router.test.ts` asserts GET bytes equal the uploaded file). Verify after that fix: `{SCRATCH}/verify-asset-bytes.log`, next **7 passed**, Playwright **2 passed (10.8s)**.

### Verify after viewport-lock and role-correct extra shots (`{SCRATCH}/verify-complete.log`)

exit **0**. lint **ok**. protocol **3**. engine **59** (16 files). next **7**. bridge **2**. VTT client **5**. reference public-API **1**. simulate-show **1**. simulate-vtt **2**. Playwright **2 passed (11.7s)**.

```
{"seedMs":1131,"moveMs":4,"snapMs":2,"tokens":200,"walls":200}
PHASE_N 70 PASS dropped QLab acknowledgement
PHASE_N 71 PASS result is unconfirmed not ok
PHASE_N_COVERED 1,2,…,69,72,…,91
  ✓  1 tests/e2e/multiclient.spec.ts:46:5 › required views render a canvas or operator controls (3.1s)
  ✓  2 tests/e2e/multiclient.spec.ts:87:5 › multi-client ownership, hidden JSON, and read-only views (7.6s)
  2 passed (11.7s)
```

Check **92** is this `npm run verify`. Extra viewports are now captured as p1 / audience / operator, and projector/overlay snapshots assert `Lurker` is absent.

## Production-style scenario

Shipped `npm run simulate-vtt` (`tests/vtt-simulate.test.ts`) against **SqliteStore** + `createEngine().vtt`, plus Playwright real clients (`multiclient.spec.ts`).

Every Phase N item 1–91 is asserted (`PHASE_N n PASS …` in `{SCRATCH}/production-scenario.log`). 70–71 are the MockQLab `dropNext` preset step. 32–33, 36–40, 55–61, 62–65, 83, 89 also run through separate browser contexts (DM, p1, p2, audience, broadcast, projector, operator).

P1 repaired during this expansion: broadcast/projector snapshots treated `ownerUserId === null` as “this viewer owns the token”, which leaked hidden `Lurker` into raw JSON. Projection now requires a non-null user/player id. Open doors no longer block line of sight. Scene import applies the packaged document onto a new scene id.

## MIDI / virtual buttons

`ACTION_CATALOG` is the single registry. `engine.ingestMidi` and `engine.pressVirtualButton` call `vtt.handleRegisteredAction` when VTT is enabled. `qlab_cue` with a dropped QLab reply stays `unconfirmed`. Unknown CommandBus types now return `ok: false` (combat.* and `player.action` still complete in `executeCombat` / `executePlayerAction`).

## Replay / preflight views

Replay: read-only Pixi reconstruction, filter, play/pause, step, scrub, JSON/CSV/markers export. Reconstruction clones published revision + `applyReplayEvent`; live instance version is unchanged.

Preflight: Ready / Ready with warnings / Not ready, with OK/WARN/FAIL checks (database, migrations, QLab, cues, MIDI token, live/staged assets, drafts, webhooks, unconfirmed fire-log).

## Playwright / visual inspection

`npx playwright --version` → **1.62.1**. Production `next start` on :38480, Chrome.

Reference boards are viewport-locked (`100dvh`, no document scroll on director/player/broadcast). Extra viewport shots in `multiclient.spec.ts` are taken from the **matching role** (p1, audience, operator), not from the admin smoke pass.

Inspected screenshots in `{SCRATCH}/views/` after the canvas/asset-byte and viewport-lock fixes:

| File | Role | Notes |
|---|---|---|
| `director.png` / `desktop-director.png` | admin/DM | Square grid, fog rect, wall/door, Lurker (red) visible, scene library, map tools, inspector, QLab connected, panic |
| `prepare.png` | admin | Grid calibration (square/hex/gridless), draft title, map tools |
| `desktop-player.png` | p1 | Two party tokens only; **no Lurker**; Ranger HP 22/22 then 21/22 after −1 |
| `player-tablet.png` | p1 @ 768×1024 | Canvas fills remaining viewport; Ranger 21/22; no Lurker |
| `player-phone.png` | p1 @ 390×844 | Same projection; nav is a single scrolling row |
| `audience.png` / `audience-phone.png` | audience | Vote Fight/Talk; no Open poll; no Lurker |
| `broadcast-1080.png` / `broadcast-1920.png` | audience | Ranger/Cleric only; poll Fight:1 Talk:0; no prepare-live |
| `projector-1920.png` | audience | Same read-only projection as broadcast; **no Lurker** in UI or raw JSON |
| `overlay-1920.png` | audience | Ranger/Cleric only; **no Lurker** in UI or raw JSON |
| `operator.png` / `operator-phone.png` | dm | Large touch targets: activate, preset, turns, rundown, poll, handout, QLab, panic |
| `replay.png` | admin | Read-only banner (“Live session is not mutated”); play/pause/step/scrub; 9 events |
| `preflight.png` | admin | **Ready with warnings** (MIDI token missing, no map asset); OK database/migrations/QLab dry-run/cues |
| `rehearsal.png` | admin | Dry-run copy; scene library; map tools; panic |

Admin visiting `/player` still sees Lurker (viewHiddenToken). That is not a leak: p1/audience/broadcast/projector/overlay snapshots stringify without `Lurker`.

No unexplained page errors in the e2e run.

## Performance (shipped runtime, vitest)

200 tokens + 200 walls on Sqlite-backed memory harness:

| Step | Measured |
|---|---|
| Seed | 594–1122 ms |
| One `token.move` | 3 ms |
| DM snapshot projection | 2 ms |

Bounds in `tests/vtt-perf.test.ts`: move < 500 ms, snapshot < 250 ms.

## Security changes

- Opaque server sessions (not client-editable JSON cookies)
- Forged JSON cookie → **401**
- CSRF: Host-normalized same-origin (localhost ↔ 127.0.0.1)
- Cross-origin VTT POST → **403**
- Player cannot move another’s token; audience write forbidden
- Hidden tokens omitted from **raw** projected JSON
- Zip-slip / path traversal rejected on import
- Scoped broadcast/projector credentials are read-only viewers

## Database migrations

`schema_migrations` with checksummed 001_baseline / 002_foundation / 003_vtt. Fresh DBs and pre-VTT DBs migrate without dropping users/sessions/players/HP/polls/MIDI/buttons/cues/fire log. Failed migrations do not leave a half-applied schema (transactional).

## Remaining P3 (nonblocking)

- Reference views share one console shell (functional per-role pages, not unique chrome per role)
- Animated maps: WebM/MP4 accepted on disk; Pixi uses a static fallback frame
- Shared notes are versioned documents, not a CRDT
- Ephemeral presence uses in-memory HTTP/SSE (not a WebSocket server); it is not authoritative
- 4K texture / GPU culling is not instrumented beyond the 200-token CPU fixture
- Broadcast/projector 1920×1080 still shows a thin unused strip under the Pixi canvas (sidebar fills the column)

No known P0, P1, or P2 after verify ×2 plus the canvas/asset, viewport-lock, and role-correct screenshot pass.
