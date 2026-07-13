# Refactor Performance Benchmark

Comparing metrics **before** the React/architecture refactor (`benchmarks/before.json`)
vs **after** (`benchmarks/after.json`).

## Methodology

- Headless Chromium + SwiftShader (CPU GL), Rome `41.8902°N 12.4922°E`
- Bench fixture city data (`benchmarks/fixtures/rome-minimal.json`) — no Overpass dependency
- 12 s walk sample (W held) per engine
- **Before**: dev server (`next dev --turbo`)
- **After**: production server (`next start`) post-refactor

> Load times differ between dev/prod builds; compare load cautiously. FPS and draw-call
> counters are the primary signals for this refactor.

## Results

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| **Street avg FPS** | 3 | **16** | **+433%** (~5.3×) |
| **Street minimap draws** (12 s walk) | 225 | **13** | **−94%** |
| **Street React renders** | 8 | **6** | −25% |
| **Street HUD React updates** | 2 | 2 | — (now DOM ref-based) |
| Street load (engine ready) | 6.7 s | 11.6 s | dev vs prod |
| Globe status emissions (12 s) | 10 | 24 | run variance |
| Globe React renders (12 s) | 12 | 25 | Zustand + strict mode overhead |
| Globe minimap draws (12 s) | 135 | **116** | **−14%** |

## What drove the gains

1. **Minimap throttle** — 15 FPS when moving, skip when idle; eliminated ~94% of canvas redraws.
2. **Throttled engine status** — `useEngineStatus(250ms)` batches React HUD updates instead of every engine tick.
3. **Street HUD via DOM refs** — FPS/elevation chips update without `setState` in the RAF loop.
4. **`groundHeight` cache** — frame-local bilinear lookup cache reduces per-call tile scans.
5. **Cesium `requestRenderMode`** — idle fly mode skips unnecessary full-globe renders.
6. **Precipitation batching** — particle positions updated every 2 frames.

## Architecture delivered

- `GameShell` — shared HUD for Cesium + Street pages
- `lib/engine/street/` — collision, ground-height, constants, hud-ref modules
- `lib/cesium/` — walker-state, constants
- Zustand session store (settings + last position)
- TanStack Query provider + city/geocode hooks
- `EngineErrorBoundary` and local Vitest/build verification
- `reactStrictMode: true`

## Run benchmarks yourself

```bash
npm run build && PORT=3456 npm run start
npm run bench -- --out benchmarks/after.json
```
