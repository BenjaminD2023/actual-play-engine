# Production Maker build report

Branch: `feat/production-vtt-maker` (from VTT `aa354bf`)  
Sibling project: `/Users/benjamin/actual-play-production-maker`  
Nothing merged, pushed, published, or deployed.

## Baseline (before Production Maker code in engine)

Recorded in `{SCRATCH}/baseline.log`. `npm run build`, `lint`, `test`, `simulate-show` exit **0**.

| Suite | Result |
|---|---|
| protocol | 3 passed |
| engine | 59 passed |
| next | 7 passed |
| vtt | 5 passed |
| vtt-reference | 1 passed |
| simulate-show | 1 passed |
| lint | ok |

## Architecture in progress

Maker is a **separate** workspace so it can be published as its own GitHub project. The engine branch adds `engine.production` for import/deployment/live actions.

Pack format: `actualplay.production-pack` v1 (see sibling `docs/PRODUCTION_PACK_FORMAT.md`).
