# VTT build report

Branch: `feat/full-vtt`  
Date: 2026-09-01

## Baseline (before VTT implementation)

Recorded at `{SCRATCH}/baseline.log` from `/Users/benjamin/actual-play-engine`.

- `npm install` — ok
- `npm run build` — ok (engine + next)
- `npm test` — **38 engine tests, 3 next tests, 2 bridge tests passed**
- `npm run simulate-show` — **1 passed**

Pre-existing QLab reconnect/listCues work was uncommitted on `main` and committed first on this branch as `de1c253` so it was not discarded.

## Isolated then integrated implementation

VTT ships as:

- `@actualplay/protocol` — runtime-validated command/event envelopes
- Engine `VttRuntime` on `createEngine().vtt` with `vtt.enabled` safety switch (default false)
- Versioned SQLite migrations `001_baseline` / `002_foundation` / `003_vtt`
- Opaque server sessions (JSON cookie forgery → 401)
- Durable command ids (replay / different-body reject)
- Viewer projections that omit hidden tokens from **raw JSON**
- Pixi layer order in `@actualplay/vtt`
- Next routes under `/api/actualplay/vtt/*`
- Reference app `apps/vtt-reference` using public packages + HTTP

QLab preset steps use `unconfirmed` when MockQLab drops replies (`tests/vtt-simulate.test.ts`).

## `npm run verify` (twice)

Both runs exit 0.

| Run | Log |
|---|---|
| 1 | `{SCRATCH}/verify-1.log` |
| 2 | `{SCRATCH}/verify-2.log` |

Included: protocol/engine/next/vtt TypeScript builds, Next.js production build of the reference app (16 static pages), lint, full vitest, `simulate-show`, `simulate-vtt`.

Engine vitest: **50 passed**. Next: **5 passed** (forged JSON cookie + cross-origin VTT POST). Protocol, VTT client layers, reference public-API grep: passed. Playwright e2e: **2 passed**.

## Playwright

`npx playwright --version` → **1.62.1**.

`npm run test:e2e` (Chrome, production `next start` on :38480) — **2 passed** (`apps/vtt-reference/tests/e2e/multiclient.spec.ts`):

- Required views render titles and a canvas ≥200×200 (director, prepare, player, audience, broadcast, projector, overlay, rehearsal) plus operator/replay/preflight.
- Separate contexts: admin/DM, p1, p2, audience, broadcast, projector, operator.
- Player snapshot JSON **omits** `Lurker`; DM snapshot includes it.
- p1 `token.move` on own token → 200; on p2's token → 403; audience move → 403.
- Broadcast has no `prepare live show` control.

Screenshots: `{SCRATCH}/views/*.png`. Player view shows two party tokens; director view also shows the hidden enemy (red).

## Production-style scenario

`npm run simulate-vtt` (`tests/vtt-simulate.test.ts`) against the shipped runtime:

1. Create scene, upload PNG map, square grid, publish, instantiate, stage
2. Preset activates the live instance
3. Player token + encounter spawn
4. Event-gap listing (`eventsSince`)
5. Preflight ready/warnings
6. Separate test: dropped QLab ack in a preset step is **`unconfirmed`**, not `ok`

## Known remaining P3

- Reference views share a console shell (functional, not unique chrome per role)
- Animated map playback is file-backed (WebM/MP4 accepted) with static Pixi fallback
- Collaborative CRDT notes are versioned documents, not a CRDT

No known P0/P1/P2 after verify ×2.
