# Production Maker security

- Packs reject zip-slip, SVG, unknown steps, duplicate IDs, circular actions, and secret-shaped keys.
- Cue numbers and QLab passcodes are deployment-only; they are stripped from player/audience snapshots.
- DM execute is server-authorized. Players receive 403 on `production.executeAction`.
- Custom OSC is not accepted from a pack. Admin-approved OSC templates must be allowlisted in the deployment (not shipped as unrestricted pack code).
- Existing engine sessions, CSRF Host checks, and hidden-token projection still apply.
