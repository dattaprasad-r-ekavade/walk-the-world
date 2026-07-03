# Walk the World — Refactor & Performance Plan

Benchmark baseline and results live in `benchmarks/before.json`, `benchmarks/after.json`, and `BENCHMARK-PERF.md`.

## Phase 0 — Benchmark harness

- [x] 0.1 Add `scripts/bench-perf.mjs` (cold load, FPS, React renders, minimap draws)
- [x] 0.2 Run **before** baseline and save to `benchmarks/before.json`

## Phase 1 — React & render-loop performance (highest impact)

- [x] 1.1 Throttle engine status updates — refs + batched HUD (`useEngineStatus`)
- [x] 1.2 Throttle minimap RAF (15 FPS moving, 2 FPS idle, skip unchanged)
- [x] 1.3 Index `groundHeight` with tile grid + frame cache (`lib/engine/street/ground-height.js`)

## Phase 2 — Architecture & deduplication

- [x] 2.1 Extract shared `GameShell` component (toolbar, minimap, chips, panels)
- [x] 2.2 Extract `ControlsPanel` into `Panels.jsx`
- [x] 2.3 Fix `/street` page — `useSearchParams` + Suspense (no flash)
- [x] 2.4 Replace `window.location.href` with Next.js `useRouter`
- [x] 2.5 Extract `useGameKeyboard` hook
- [x] 2.6 Split `StreetEngine.js` into `lib/engine/street/` modules (collision, ground-height, constants, hud-ref)
- [x] 2.7 Split `Globe.js` into `lib/cesium/` modules (walker-state, constants)

## Phase 3 — State & data layer

- [x] 3.1 Add Zustand store for game settings, panel, session persistence
- [x] 3.2 Add TanStack Query for city data, reverse geocode, weather (`hooks/use-city-data.js`, `use-geocode-query.js`, `Providers`)
- [x] 3.3 Shared geocode hooks (`use-reverse-geocode.js`, `use-geocode-query.js`)

## Phase 4 — Engine performance

- [x] 4.1 Street engine: ref-based HUD updates (`lib/engine/street/hud-ref.js`)
- [x] 4.2 Precipitation: batch particle updates every 2 frames
- [x] 4.3 Cesium: enable `requestRenderMode` when idle in fly mode
- [x] 4.4 Neighbor prefetch: parallel with concurrency limit of 2

## Phase 5 — Reliability & polish

- [x] 5.1 `EngineErrorBoundary` around Globe and StreetEngine
- [x] 5.2 Re-enable `reactStrictMode` with safe double-mount guards
- [x] 5.3 Add Vitest + smoke tests for `lib/engine/geo` and street modules
- [x] ~~5.4 Add GitHub Actions CI~~ (removed — saves Actions minutes)
- [x] 5.5 TypeScript-style JSDoc types in `lib/types/index.js`

## Phase 6 — Final benchmark

- [x] 6.1 Run **after** benchmark and save to `benchmarks/after.json`
- [x] 6.2 Write `BENCHMARK-PERF.md` comparing before vs after

## Key results (see BENCHMARK-PERF.md)

| Metric | Before | After |
|--------|--------|-------|
| Street FPS | 3 | **16** |
| Street minimap draws / 12s | 225 | **13** |
| Street React renders | 8 | **6** |
