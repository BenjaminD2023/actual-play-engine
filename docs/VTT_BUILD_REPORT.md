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

## Production-style scenario

`npm run simulate-vtt` → `packages/engine/tests/vtt-simulate.test.ts` against **SqliteStore** + shipped `VttRuntime`:

- Gridless, hex-flat, hex-pointy, square
- Map upload, publish (revision frozen), instantiate, stage, activate
- Player tokens + hidden enemy `Lurker`
- Walls, door, window, light, fog, annotation, template, terrain, condition, aura
- Ownership: player one **cannot** move player two (`forbidden`)
- Player raw snapshot JSON **omits** `Lurker`; DM snapshot includes it
- Encounter spawn, combat turn, HP via existing `updatePlayerHp` (single authority)
- Poll open + vote, handout, rundown, registered action + `ingestMidi('recording_marker')`
- Durable command id replay (`duplicate: true`)
- Checkpoint preview (`mutatesLive: false`) then restore (audited, fog rolled back)
- Scene package export/import checksum
- `replayAt` reconstruction with `liveMutated: false`
- SQLite reopen restores players and scenes
- Separate test: MockQLab `dropNext` → preset step status **`unconfirmed`**, not `ok`

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
