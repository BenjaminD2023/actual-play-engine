# VTT security

- Session cookies are opaque server-side ids. A JSON cookie with `userId`/`role` is rejected (unauthenticated).
- State-changing VTT requests are origin-checked against `Host` (localhost and 127.0.0.1 are treated as the same loopback host).
- Logout revokes the server session.
- Scoped tokens (broadcast, projector, operator, overlay, api, bridge) are stored hashed, with expiry and revocation.
- Player HP and character patches cannot target another player's record.
- Broadcast/projector/audience writes are read-only except ping/poll where explicitly allowed.
- Hidden tokens, secret doors, DM-only walls/annotations, and private notes are omitted from projected JSON.
- Assets: magic-byte MIME checks, 25MB cap, SVG rejected, path traversal rejected, zip-slip rejected (`..`, absolute paths).
- Webhooks: HMAC-SHA256, allowlisted events, no eval / remote code.
- QLab: unconfirmed on dropped ack; never a false success.
