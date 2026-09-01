# VTT testing

| Command | What it proves |
|---|---|
| `npm test` | Protocol, engine (including VTT domain/store/QLab), Next, bridge |
| `npm run simulate-show` | Existing show-control simulation |
| `npm run simulate-vtt` | Production-style VTT scenario + unconfirmed QLab preset step |
| `npm run verify` | build + lint + tests + both simulations + Playwright e2e |
| `npm run test:e2e` | Multi-client Playwright against the production reference app |
| `vitest run tests/vtt-perf.test.ts` | 200-token / 200-wall move + snapshot timings |

Vitest tests import shipped constructors (`createEngine`, `VttRuntime`, `sqliteStore`, `parseCommandEnvelope`) rather than reimplementing them.

Hidden-data tests stringify raw snapshots and assert secret names/ids are absent.
