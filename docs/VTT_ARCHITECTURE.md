# VTT architecture

The VTT is an engine-authoritative 2D tabletop for live actual-play production. Show apps keep their own branding. The engine owns state; Pixi/React clients never persist map mutations locally.

## Packages

| Package | Role |
|---|---|
| `@actualplay/protocol` | Browser-safe types, command/event schemas, runtime validation |
| `@actualplay/engine` | Stores, QLab, combat, polls, VTT runtime, migrations |
| `@actualplay/next` | App Router handlers, opaque sessions, VTT HTTP/SSE |
| `@actualplay/vtt` | Typed client, SSE gap recovery, Pixi canvas |
| `@actualplay/vtt-reference` | Full Next.js console using only public imports |

## Authority

Prepared scenes (draft → immutable published revision) are separate from session-owned live instances. HP, initiative, polls, and QLab acknowledgements remain the existing engine records. Tokens may bind to players but do not duplicate those fields as VTT authority.

A QLab cue is never reported `ok`/`confirmed` without an acknowledgement. Preset steps use `ok | skipped | unconfirmed | failed | compensated`.

## Isolation then registration

`createEngine({ vtt: { enabled: false } })` is the default. The runtime is still constructed so sessions, migrations, and tests can run. Public `index` exports of VTT helpers are added after the pre-integration suite passes. `vtt.enabled: false` remains a safety switch.
