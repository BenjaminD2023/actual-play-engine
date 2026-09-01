# VTT build status

- **Current phase:** Complete on `feat/full-vtt`. VTT is registered on `createEngine().vtt` with `vtt.enabled` default false.
- **Completed:** Protocol, migrations, opaque sessions, capabilities, durable commands/events, domain, assets, projections, Next routes, Pixi client, reference app, replay reconstruction, preflight dashboard, MIDI/virtual-button action catalog, Playwright multi-client e2e, 200-token fixture, `npm run verify` ×2 + final.
- **Remaining:** P3 only (per-role chrome, animated-map Pixi fallback, CRDT notes, WebSocket ephemeral).
- **Known defects:** None P0–P2.
- **Integration gate:** Opened after isolated verify, then public registration; post-integration verify exit 0.
