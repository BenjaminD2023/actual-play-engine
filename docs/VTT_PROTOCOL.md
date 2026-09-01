# VTT protocol

`PROTOCOL_VERSION` is `1` (`actualplay.vtt`).

Commands are envelopes:

```json
{ "id": "uuid", "protocolVersion": 1, "type": "token.move", "sessionId": "...", "sceneInstanceId": "...", "expectedVersion": 3, "payload": {} }
```

Unknown `type` values throw `invalid_request` and never succeed.

Durable events carry a global increasing `sequence` per session. Clients:

1. GET `/vtt/snapshot`
2. Open SSE `/events` with `Last-Event-ID`
3. Apply in order, detect gaps, GET `/vtt/events?after=`
4. Fall back to a fresh snapshot

Error codes: `unauthenticated`, `forbidden`, `not_found`, `invalid_request`, `invalid_protocol`, `version_conflict`, `duplicate_command`, `unavailable`, `external_unconfirmed`, `external_failure`, `rate_limited`, `migration_required`, `asset_missing`, `scene_not_published`, `scene_not_active`, `unconfirmed`.
