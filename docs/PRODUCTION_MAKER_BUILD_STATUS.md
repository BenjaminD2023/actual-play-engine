# Production Maker build status

- **Current phase:** Engine import/runtime integrated; Maker sibling published.
- **Completed:** `feat/production-vtt-maker` (`647ec81`, `9c7b84d`). Sibling https://github.com/BenjaminD2023/actual-play-production-maker. Spec 10 tests, runtime 10, maker persist 5, engine 66 including Open West Door + unconfirmed QLab retry. Maker UI visually inspected.
- **Remaining:** Full 97-step numbered scenario as one log; richer map bitmaps on Clockwork Crypt scenes; runtime-reference Playwright may still be iterating.
- **Test evidence:** `npm run verify:production-maker` 7 passed; engine `npm test` 66 passed.
- **Known defects:** Clockwork Crypt scenes warn missing_map (publish allowed). Scene canvas is 2D authoring, not Pixi.
- **Import-compatibility status:** Pack format v1 importable via `engine.production.importPack`.
- **Final integration status:** Public `engine.production` registered; engine branch not pushed.
