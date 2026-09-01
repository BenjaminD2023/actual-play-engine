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

Inspected screenshots in `{SCRATCH}/views/` and `apps/vtt-reference/test-results/views/`:

| View | Notes |
|---|---|
| Director desktop | Live map, Lurker visible to DM |
| Player desktop | Party tokens; hidden enemy omitted from raw JSON |
| Prepare | Draft editor |
| Audience | Poll surface |
| Broadcast 16:9 / 1920×1080 | Read-only map |
| Projector | Read-only |
| Overlay | Transparent overlay route |
| Operator mobile | Large controls, no canvas required |
| Replay | Read-only banner + play control |
| Preflight | Status badge + checklist |
| Rehearsal | Dry-run controls |

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

No known P0, P1, or P2 after verify ×2 plus the final verify including the performance fixture.
