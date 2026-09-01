# VTT operations

## Run the reference console

```bash
npm install
npm run build
npm run dev:vtt
```

SQLite file: `apps/vtt-reference/data/show.db`. Assets: `apps/vtt-reference/data/assets`.

Seed logins: `admin` / `admin`, `dm` / `dm`, `p1` / `p1`, `p2` / `p2`, `audience` / `audience`.

## Migrations

SQLite applies `001_baseline`, `002_foundation`, `003_vtt` transactionally. Existing pre-VTT databases are stamped `001_baseline` and then receive 002/003 without dropping users, HP, polls, MIDI, or fire logs. There is no automatic destructive migration or database delete.

## Preflight

`GET /api/actualplay/vtt/preflight` returns `ready` or `ready_with_warnings` plus actionable warning codes (QLab down, missing map asset, etc.).

## Safety switch

```ts
createEngine({ vtt: { enabled: false } })
```

still migrates SQLite and serves existing show-control routes.
