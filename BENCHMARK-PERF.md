# Refactor Performance Benchmark

> The `Before` / `After` table below is a historical comparison from the earlier
> refactor. It is not a current production baseline. Use the versioned local
> runner below for new comparisons, and do not compare runs with different GPU
> renderers or cache/fixture conditions.

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

## Current local runner

Run against a built app with the same fixture, browser renderer mode, viewport,
quality preset and cache state for each candidate. The population placement uses
the same seeded random stream on each run; the default seed is `1337`.

```bash
npm run bench -- --base-url http://127.0.0.1:3456 --fixture benchmarks/fixtures/rome-showcase-osm.json --lat 41.8902 --lon 12.4922 --preset medium --renderer-mode browser-default --walk-ms 12000 --seed 1337 --skip-globe --out benchmarks/results/stage0/local.json
```

Supported options are `--base-url`, `--fixture`, `--route`, `--lat`, `--lon`,
`--preset` (`low|medium|high`), `--renderer-mode` (`software|browser-default`),
`--walk-ms` (minimum 1000), `--seed` (0 through 4294967295), `--out`,
`--screenshot` (optional rendered street capture), `--headed`
`--drive` and `--skip-globe`. `--drive` waits for seeded traffic, approaches a
nearby car, enters through the normal `C` control handler and drives with `W`.
Reports contain the selected WebGL renderer, per-frame
renderer counters, asynchronous GPU timing when the extension is available,
frame-time percentiles, movement displacement, resources and browser errors.
Missing GPU timing support is recorded as unavailable; renderer submission time
is CPU time and must not be interpreted as GPU time.
