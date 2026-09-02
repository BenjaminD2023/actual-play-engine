# Production actions

An action is a validated sequence of steps. Live execution goes through `engine.production.executeAction`.

Internal steps (VTT/engine) commit first. External QLab steps use `engine.fireShowCue`. Statuses: `ok | skipped | unconfirmed | failed | blocked | compensated`.

A dropped QLab acknowledgement is **unconfirmed**, never success. VTT mutations stay. `retryExternal` re-runs only unconfirmed/failed external steps.

Conditions support `eq`, `neq`, `gt`, `lt`, `contains`, `is_true`, `is_false`, plus `all`/`any` groups. No JavaScript expressions.

Example: Open Crypt Entrance opens the door, reveals west-hall fog, enables torches, sets `westDoorOpen`, fires `sound.crypt.entrance` and `light.crypt.cold-blue`.
