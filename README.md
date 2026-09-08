# Actual Play Engine

Actual Play Engine is a TypeScript show-control runtime for tabletop actual plays. It coordinates QLab, MIDI controls, combat state, audience voting, HP tracking, an append-only fire log, and a reusable 2D VTT.

Show apps keep their own theme and page chrome. This workspace owns the live-show state and the rule that matters most: a QLab command cannot report success unless QLab acknowledges it. Missing acknowledgements are recorded as `unconfirmed`.

## Workspace

| Package | Import | Purpose |
|---|---|---|
| `packages/protocol` | `@actualplay/protocol` | Browser-safe command and event schemas |
| `packages/engine` | `@actualplay/engine` | Framework-agnostic show-control core and VTT runtime |
| `packages/next` | `@actualplay/next` | Next.js App Router handlers, middleware, and client hooks |
| `packages/vtt` | `@actualplay/vtt` | React and PixiJS VTT canvas |
| `apps/bridge` | private app | MIDI host for the Mac connected to the control surface |
| `apps/vtt-reference` | private app | Director, player, audience, broadcast, projector, and operator reference UI |

## Requirements

- Node.js 18.18 or newer
- npm
- QLab with OSC enabled for live cue control; development can use dry-run mode

## Get started

```bash
npm install
npm run build
npm test
npm run dev:vtt
```

Open <http://127.0.0.1:38480/login>. The reference app uses QLab dry-run mode by default.

For the complete build, lint, unit, simulation, and browser test suite:

```bash
npx playwright install
npm run verify
```

## Use the engine in a show app

The packages are not published yet. Reference the local workspace from the show app:

```json
{
  "dependencies": {
    "@actualplay/protocol": "file:../actual-play-engine/packages/protocol",
    "@actualplay/engine": "file:../actual-play-engine/packages/engine",
    "@actualplay/next": "file:../actual-play-engine/packages/next"
  }
}
```

Build this workspace before installing or running the show app:

```bash
npm run build
```

Create and start one engine instance:

```ts
// lib/engine.ts
import { createEngine, sqliteStore } from '@actualplay/engine';

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

Expose the engine through a Next.js catch-all route:

```ts
// app/api/actualplay/[...path]/route.ts
import { createActualPlayHandlers } from '@actualplay/next';
import { engine } from '@/lib/engine';

export const { GET, POST, PUT, PATCH, DELETE } = createActualPlayHandlers(engine);
```

Add the supplied authentication middleware:

```ts
// middleware.ts
export { actualPlayMiddleware as middleware } from '@actualplay/next';
```

A sibling reference show lives in `../actual-play-sample`.

## QLab and cue names

Enable **Workspace Settings → Network → Accept OSC commands** in QLab. The default OSC port is `53000`; passcodes and workspace IDs are optional.

Numbered cues use `/cue/{n}/start`. The legacy `/go` address for a cue remains aliased. Workspace panic uses `/panic` and jumps the command queue.

Use stable, show-neutral cue keys:

```text
show.welcome
show.end
combat.battle-1
combat.battle-2
pc.wizard.fireball
```

Legacy names (`welcome`, `battle1`, `battle2`, and `end`) still resolve when their replacements are mapped. Missing mappings are errors and are never silently skipped.

Use dry-run mode when QLab is unavailable:

```ts
createEngine({
  qlab: { dryRun: true },
  cues: { 'show.welcome': '1' },
});
```

## MIDI bridge

On the Mac connected to the MIDI surface:

1. Generate a token with `POST /api/actualplay/midi/bridge-token`. The raw token is shown once; only its hash is stored.
2. In `apps/bridge`, run `npm install`, then `npm start`.
3. Enter the show URL and token.

The bridge sends MIDI input to the engine and never controls QLab directly. The engine remains the only process allowed to fire cues.

## VTT reference console

Start the console with `npm run dev:vtt`, then sign in with one of these development-only accounts:

| Role | Credentials |
|---|---|
| Admin | `admin` / `admin` |
| DM | `dm` / `dm` |
| Player 1 | `p1` / `p1` |
| Player 2 | `p2` / `p2` |
| Audience | `audience` / `audience` |

A typical rehearsal flow is:

1. Sign in as `admin` and open Director.
2. Select **prepare live show** to create and activate the House map and place the seeded characters.
3. Connect the required `/player`, `/audience`, `/broadcast`, `/projector`, and `/operator` views.
4. Run **Preflight** before a dress rehearsal. Use **Rehearsal** while QLab is in dry-run mode.
5. Use **Replay** to reconstruct a session without changing live state.

For live QLab, replace the reference app's dry-run configuration with `qlab: { host, port }`. Back up `apps/vtt-reference/data/show.db` and `apps/vtt-reference/data/assets`; restore them in place and restart the app so migrations can run.

## Production Maker

Preproduction authoring lives in the sibling `../actual-play-production-maker` project:

```bash
npm run dev:maker
```

Open <http://127.0.0.1:38490>, export an `.actualplay-pack`, and import it into an engine with the production and VTT runtimes enabled:

```ts
const engine = createEngine({
  production: { enabled: true },
  vtt: { enabled: true },
  qlab: { dryRun: true },
});

engine.production.importPack(zip, adminActor);
```

Run the production import checks with `npm run verify:production-maker`.

## Reliability model

- Persistent QLab TCP connection using OSC 1.1 and double-END SLIP framing
- Serialized command queue with preemption for panic and stop
- Write, drain, and `/reply` acknowledgement before success
- Append-only fire log recording actor, source, cue, and acknowledgement
- Idempotent command IDs for duplicate clicks and MIDI bounce
- Mock QLab coverage; `npm run simulate-show` exercises welcome → combat → panic

The engine cannot certify QLab, the network, or macOS. It can refuse to claim that an unacknowledged cue fired.

## Documentation

- VTT: [architecture](docs/VTT_ARCHITECTURE.md), [protocol](docs/VTT_PROTOCOL.md), [security](docs/VTT_SECURITY.md), [operations](docs/VTT_OPERATIONS.md), and [testing](docs/VTT_TESTING.md)
- Production Maker: [architecture](docs/PRODUCTION_MAKER_ARCHITECTURE.md), [actions](docs/PRODUCTION_ACTIONS.md), [security](docs/PRODUCTION_MAKER_SECURITY.md), [operations](docs/PRODUCTION_MAKER_OPERATIONS.md), and [testing](docs/PRODUCTION_MAKER_TESTING.md)

## Native sample integration

The local `feat/native-vtt` integration exposes framework-neutral HTTP handlers from `@actualplay/engine/vtt` and `@actualplay/engine/production`. The Next adapter is a compatibility wrapper. Maker and Engine share the browser-safe `@actualplay/protocol/production` contract; no QLab credentials belong in it.

`npm run build:libs` builds the shared protocol, engine, Next adapter and Pixi canvas without building a reference app. Use matching engine, maker and sample checkouts. The sample README documents the complete workflow and tests. Public event readers must supply the viewer actor to `eventsSince`; omitting it is for trusted internal replay only.
