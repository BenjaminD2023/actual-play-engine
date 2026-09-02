# Production Maker architecture

Three stages:

1. **Authoring** (sibling project `actual-play-production-maker`) — no live QLab, no show DB secrets. Creators design VTT scenes, semantic cue slots, multi-step actions, triggers, and the DM tablet layout.
2. **Deployment** (`createEngine().production`) — import an immutable pack revision, bind actors and QLab cues, preflight, rehearse, publish.
3. **Live play** — DM executes prepared actions only. Engine remains authority for auth, VTT, HP, initiative, polls, MIDI, and QLab acknowledgements.

QLab success is never inferred. A dropped acknowledgement stays `unconfirmed`. Internal VTT mutations are kept; only external steps retry.

Packages:

- `@actualplay/production-spec` — browser-safe schemas
- `@actualplay/production-runtime` / `engine.production` — import, bindings, runner
- `@actualplay/production-ui` — DM deck and admin panels
- Existing `@actualplay/engine` VTT, QLab, stores
