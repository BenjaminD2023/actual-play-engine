# Actual Play Engine

Importable show-control engine for D&D actual plays. Theme and page chrome stay in each show app. This repo is the theatre computer: QLab, MIDI, combat, audience votes, HP, a fire log, and a first-class 2D VTT.

It is extracted from the Jun 2026 black-box show (`Actual_Play_Jun26`) and rewritten so a web click cannot report success unless QLab acked — or the operator sees `unconfirmed`.

## Packages

| Package | Import | Role |
|---|---|---|
| `@actualplay/protocol` | command/event schemas | Browser-safe runtime validation |
| `@actualplay/engine` | `createEngine` | Framework-agnostic core + VTT runtime |
| `@actualplay/next` | `createActualPlayHandlers` | Next.js App Router routes, middleware, hooks |
| `@actualplay/vtt` | `VttCanvas` | PixiJS canvas + snapshot client |
| `@actualplay/bridge` | companion `.app` | MIDI host on the QLab Mac |
| `@actualplay/vtt-reference` | `npm run dev:vtt` | Full director/player/broadcast console |

## Import into the next show

```ts
import { createEngine, sqliteStore } from '@actualplay/engine';
import { createActualPlayHandlers, actualPlayMiddleware } from '@actualplay/next';

export const engine = createEngine({
  store: sqliteStore('./data/show.db'),
  qlab: { host: '127.0.0.1', port: 53000 },
  vtt: { enabled: true, assetRoot: './data/assets' },
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

A sibling reference show lives at [actual-play-sample](https://github.com/BenjaminD2023/actual-play-sample) ([repo page](https://benjamind2023.github.io/actual-play-sample/)).

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
npm run build
npm test
npm run simulate-show
npm run simulate-vtt
npm run verify
```

## VTT reference console

```bash
npm run build
npm run dev:vtt
```

Open `http://127.0.0.1:38480/login`. Seed users: `admin/admin`, `dm/dm`, `p1/p1`, `p2/p2`, `audience/audience`.

Typical session:

1. Sign in as `admin` and open Director.
2. Click **prepare live show** (creates, publishes, instantiates, activates House map, places Ranger/Cleric/Lurker).
3. Connect players on `/player`, audience on `/audience`, broadcast on `/broadcast`, projector on `/projector`, operator on `/operator`.
4. Run **Preflight** before a dress. Use **Rehearsal** when QLab is dry-run.
5. **Replay** reconstructs the session without mutating live state.

QLab: dry-run is the default in the reference app. Point `createEngine({ qlab: { host, port } })` at a live workspace for dress rehearsal. MIDI uses `ACTION_CATALOG` through `POST /api/actualplay/midi/relay` and virtual-button press. Backup is the SQLite file `apps/vtt-reference/data/show.db` plus `data/assets`. Restore by replacing those files; migrations apply on next start.

See `docs/VTT_ARCHITECTURE.md`, `docs/VTT_PROTOCOL.md`, `docs/VTT_SECURITY.md`, `docs/VTT_OPERATIONS.md`, `docs/VTT_TESTING.md`.
