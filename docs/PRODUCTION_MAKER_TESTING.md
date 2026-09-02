# Production Maker testing

```bash
# Engine branch feat/production-vtt-maker
npm run verify:production-maker
npm test -w @actualplay/engine -- tests/production-import.test.ts tests/production-action.test.ts tests/production-qlab-unconfirmed.test.ts
npm run verify

# Sibling Maker repo
cd ../actual-play-production-maker
npm test
npm run test -w @actualplay/production-spec
npm run test -w @actualplay/production-runtime
npm run test -w @actualplay/production-ui
npm run test -w @actualplay/production-maker
```

Security tests cover zip-slip, secret keys, player 403, hidden tokens omitted from raw JSON, QLab unconfirmed.
