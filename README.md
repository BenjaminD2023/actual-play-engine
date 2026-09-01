# Actual Play Engine

Importable show-control engine for D&D actual plays. Theme and page chrome stay in each show app. This repo is the theatre computer: QLab, MIDI, combat, audience votes, HP, and a fire log.

It is extracted from the Jun 2026 black-box show (`Actual_Play_Jun26`) and rewritten so a web click cannot report success unless QLab acked — or the operator sees `unconfirmed`.

## Packages

| Package | Import | Role |
|---|---|---|
| `@actualplay/engine` | `createEngine` | Framework-agnostic core |
| `@actualplay/next` | `createActualPlayHandlers` | Next.js App Router routes, middleware, hooks |
| `@actualplay/bridge` | companion `.app` | MIDI host on the QLab Mac |

## Import into the next show

```ts
import { createEngine, sqliteStore } from '@actualplay/engine';
import { createActualPlayHandlers, actualPlayMiddleware } from '@actualplay/next';

export const engine = createEngine({
  store: sqliteStore('./data/show.db'),
  qlab: { host: '127.0.0.1', port: 53000 },
  cues: {
    'show.welcome': '1',
    'show.end': '99',
    'combat.battle-1': '10',
    'combat.battle-2': '11',
  },
});

await engine.start();
```

```ts
// app/api/actualplay/[...path]/route.ts
import { createActualPlayHandlers } from '@actualplay/next';
import { engine } from '@/lib/engine';

export const { GET, POST, PUT, PATCH, DELETE } = createActualPlayHandlers(engine);
```

```ts
// middleware.ts
export { actualPlayMiddleware as middleware } from '@actualplay/next';
```

A sibling reference show lives at `/Users/benjamin/actual-play-sample` (not in this repo).

Until you publish, depend on the local packages:

```json
{
  "dependencies": {
    "@actualplay/engine": "file:../actual-play-engine/packages/engine",
    "@actualplay/next": "file:../actual-play-engine/packages/next"
  }
}
```

Build the engine first: `npm run build -w @actualplay/engine`.

## QLab

Enable **Workspace Settings → Network → Accept OSC commands**. Default port is `53000`. Optional passcode and workspace id are supported.

Numbered cues are fired with the official address `/cue/{n}/start` (legacy `/go` on a cue is aliased). Workspace panic is `/panic` and **jumps the command queue**.

A GO never returns `ok` unless QLab replied. A dropped reply is `unconfirmed`, logged, and the session reconnects.

Dry-run (no QLab process):

```ts
createEngine({ qlab: { dryRun: true }, cues: { 'show.welcome': '1' } })
```

## Show cue names

Use generic keys, not hardcoded Strixhaven labels:

- `show.welcome`, `show.end`
- `combat.battle-1`, `combat.battle-2`
- `pc.wizard.fireball`

Legacy names `welcome`, `battle1`, `battle2`, `end` still resolve if the new keys are mapped.

Missing map entries are errors. They are never silently skipped.

## Bridge

On the Mac that sees the MIDI surface:

1. Admin generates a token: `POST /api/actualplay/midi/bridge-token` (raw token is shown once; only a hash is stored).
2. In `apps/bridge`, install optional Electron/MIDI natives (`npm install`) and run `npm start`.
3. Paste the show URL and token.

The Bridge never talks to QLab directly. It posts MIDI to the engine; the engine is the only process allowed to fire cues.

## Reliability bar

- Persistent QLab TCP, OSC 1.1, double-END SLIP
- Serialized command queue; panic/stop preempt
- Write + drain + `/reply` wait
- Append-only fire log (who, source, cue, ack)
- Idempotent command ids (double-click / MIDI bounce)
- Mock QLab in tests; `npm run simulate-show` runs welcome → combat → panic

This does not certify QLab, the LAN, or macOS. It does refuse to pretend a cue fired.

## Develop

```bash
cd actual-play-engine
npm install
npm test
npm run simulate-show
```
