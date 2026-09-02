# Production Maker operations

## Maker

```bash
cd /Users/benjamin/actual-play-production-maker
npm install
npm run dev:maker
```

Open http://127.0.0.1:38490. Create or open Clockwork Crypt. Publish a revision, then Export `.actualplay-pack`.

Backup: copy `apps/maker/data/maker.db` and `apps/maker/data/assets`.

## Import into the engine

```ts
const engine = createEngine({
  store: sqliteStore('./data/show.db'),
  qlab: { dryRun: true },
  vtt: { enabled: true },
  production: { enabled: true },
  cues: { 'crypt-door': '12', 'light.crypt.cold-blue': '20' },
});
await engine.start();
const report = engine.production.importPack(zipBuffer, adminActor);
const deployment = engine.production.createDeployment({ revisionId: report.revisionId }, adminActor);
engine.production.bindCue(deployment.id, { slotId, kind: 'show_cue', cueName: 'crypt-door', ... }, adminActor);
await engine.production.publishDeployment(deployment.id, adminActor);
await engine.production.executeAction(deployment.id, 'act_open_west', dmActor);
```

Preflight must be `ready` (or ready with an accepted warning) before a required slot can go live.

Rollback: `rollbackDeployment(deploymentId, previousRevisionId)`.
