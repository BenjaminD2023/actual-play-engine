# VTT build status

- **Current phase:** Complete on `feat/full-vtt`. VTT is registered on `createEngine().vtt` with `vtt.enabled` default false.
- **Completed:** Protocol, migrations, opaque sessions, capabilities, durable commands/events, domain, assets, projections, Next routes, Pixi client, reference app, replay reconstruction, preflight dashboard, MIDI/virtual-button action catalog, Playwright multi-client e2e, 200-token fixture, role-correct extra viewports, viewport-locked boards, `npm run verify` including post-canvas/asset visual QA.
- **Remaining:** P3 only (per-role chrome, animated-map Pixi fallback, CRDT notes, HTTP/SSE ephemeral rather than WebSocket, GPU/4K culling beyond the 200-token CPU fixture).
- **Known defects:** None P0–P2. Hidden Lurker is omitted from player/audience/broadcast/projector/overlay raw JSON and from those screenshots when those roles are logged in. Admin on a player route still sees hidden tokens (capability, not a leak).
- **Integration gate:** Opened after isolated verify, then public registration; post-integration verify exit 0.
