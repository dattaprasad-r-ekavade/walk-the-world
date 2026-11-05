# Walk the World — Technical Architecture

Onboarding doc for contributors. Read this + `plan.md` (roadmap, what's done
and why) and you can work on any part of the system. README.md covers setup;
this covers how it actually works.

## System overview

```
┌────────────┐  fly/travel   ┌──────────────────┐
│  app/page  │──────────────▶│ /street?lat&lon  │  default walk experience
│ (CesiumJS) │               │ (street runtime, │
│  globe     │               │  Three.js)       │
└────────────┘               └────────┬─────────┘
                                      │ fetchCityData(lat, lon)
                             ┌────────▼─────────┐
                             │ 3-tier cache      │
                             │ 1 memory/IndexedDB    │  7-day TTL, 12 complete cells
                             │ 2 R2 public domain│  https://myjyotishai.in/<key>.json
                             │ 3 /api/city/<key> │  R2 hit, else Overpass + write-back
                             └────────┬─────────┘
                                      │ cold miss only
                             ┌────────▼─────────┐
                             │ lib/overpassServer│  per-category parallel queries
                             │ (server-side)     │  (7.3 caps), 4 mirrors, partial OK
                             └──────────────────┘
                                      │
                             ┌────────▼─────────┐
                             │ city-builder      │  Web Worker: Extrude/merge
                             │ (19.1)            │  → transferable buffers
                             └──────────────────┘
```

Whatever gets rendered once is uploaded to R2 and served warm forever
("the world maps itself"). Terrain (AWS Terrarium) and ground imagery (OSM
raster tiles) stream from free public hosts and are never stored by us.

## The cell system (the core idea)

The world is divided into cells keyed by rounded coordinates:

- `cityCacheKey(lat, lon)` → `wtw_city6_<lat.toFixed(3)>_<lon.toFixed(3)>`
  (lib/city-contract.js). The `6` is `CACHE_VERSION` — bump it to
  invalidate every cache tier at once (browser cache keys, R2 objects, edits).
  **The key and neighbor-grid contract is shared from `lib/city-contract.js`, including seed scripts.**
- A cell's data = one Overpass fetch of radius 650 m around the cell origin
  (`fetchOverpassCell`), stored as `{ elements: [...] }` in raw OSM JSON
  shape (ways with `geometry`, nodes, relations with `members`).
- Neighbor streaming uses an arrival-anchored grid (±0.0055°), concurrency 2.
  The center stays stable until the player crosses a tile boundary. Seed scripts
  use the same grid, including diagonals. Exact-cell requests replace the old
  sequential nearby-key probing. Existing public cache and edit addresses remain valid.
- Per-cell edits (map editor) live in R2 at `edits/<cellkey>.json`:
  `{ assets: [{name,url,lat,lon,rotY,scale}], terrain: [{lat,lon,radius,height}],
  tagOverrides: {"way/123": {k:v}}, hidden: ["node/456", ...] }`.

## Server pieces

| File | What it does |
|---|---|
| `lib/overpassServer.js` | Server owns Overpass retries: mirrors race two at a time (second starts after 1.8 s or on failure), first complete answer wins and aborts the rest. If every mirror fails fast, it sweeps them again after a backoff (3 rounds). Shared 85 s deadline, at most 28 s per attempt. Caller cancellation propagates. Partial responses retain their status. |
| `lib/r2Server.js` | S3-compatible storage adapter. Text is gzipped; GLBs use binary helpers. City reads/writes accept cancellation. `checkEditorKey` compares the request header to `EDITOR_SECRET` in constant time. |
| `lib/read-bounded-json.js` | Streaming body readers for write routes: reject on declared or actual size before buffering everything. |
| `app/api/city/[key]/route.js` | GET validates cache entries before use, fetches within a 105 s total budget, and stores only complete results. PUT requires editor authorization before consuming the bounded body and validates the payload. Partial responses are `no-store`. |
| `app/api/edits/[key]/route.js` | GET returns edits JSON or `{}`; PUT saves a JSON object (bounded 1 MB read, 400 on bad JSON, 413 when too large, editor key required). |
| `app/api/assets/route.js` | GET lists `assets/` (returns same-origin `url` + `cdnUrl`; empty list if R2 listing fails); POST streams a raw GLB body (`?name=x.glb`, 30 MB cap, editor key). |
| `app/api/assets/[name]/route.js` | Streams GLB bytes same-origin so GLTFLoader needs no bucket CORS. |
| `lib/overtureServer.js` | DuckDB-over-S3 Overture footprint queries (lazy import — duckdb never loads at build). Needs `npm run overture-index` once. |

Env (`.env.local`, never committed): `NEXT_PUBLIC_CESIUM_ION_TOKEN(_1/_2)`,
`R2_*`, `NEXT_PUBLIC_R2_PUBLIC_BASE` (public bucket domain), `EDITOR_SECRET`.
On Vercel all of these must be set in project env; `NEXT_PUBLIC_*` bake at
build time.

## Street engine (lib/engine/street/runtime.js)

`createStreetRuntime()` boots and runs the street-level world with no React
dependency. `components/StreetEngine.js` is the React shell: it owns HUD state,
creates one runtime per spawn point (and ground source), and talks to it
through three narrow interfaces:

- `ui`: callbacks the engine reports through (`setStage`, `setReadyPct`,
  `setLiveHud`, `setUiMode`, …);
- `store`: a small adapter over the persisted game store (`getSettings`,
  `changeSetting`, `recordWalk`, …), never React hooks;
- `api`: what the runtime returns (`setTime`, `setWeather`, `setQuality`,
  `captureScreenshot`, `editorApi`, …), held in `engineRef`.

`dispose()` aborts outstanding work, removes listeners, disposes the worker
pool and scene resources, and releases shared material atlases.

| Module (lib/engine/street/) | Owns |
|---|---|
| `runtime.js` | Boot sequence, frame loop, input wiring, quality presets, lifetime |
| `renderer-setup.js` | WebGL renderer, GPU detection, on-demand shadow scheduler, measured frame render |
| `shader-warmup.js` | `compileAsync` warm-up for city cells, shadow-depth variants, population, bloom |
| `render-diagnostics.js` | Attributing newly linked shader programs (diagnostics only) |
| `sky.js` | Sky colour, fog, sun/moon, hemisphere, IBL, exposure from hour + weather |
| `precipitation.js` | Rain/snow particles |
| `quality-governor.js` | Render-scale governor + auto preset steps (pure) |
| `player-motion.js` | Walk/fly steps, wall sliding, bridge decks, chase boom, safe spawn (pure) |
| `ktx2-install.js` | Uploading KTX2 facade sets and their GPU-byte budget |
| `editor.js` / `editor-input.js` | Editor state, picking, persistence / its mouse and key handling |
| `terrain.js`, `cell-stream.js`, `assemble-city.js`, `collision.js`, `spawn.js` | Terrain tiles, neighbour streaming, scene assembly, footprint collision, spawn framing |
| `population-models.js`, `avatar.js`, `live-weather.js`, `debug-api.js` | GLB population overrides, mannequin + headlights, Open-Meteo, `window.__streetDebug` |

Benchmark hooks (`window.__BENCH_*`) are read only through `lib/bench.js`,
which returns an inert config outside a benchmark. Boot sequence:

1. **Local frame** — `makeLocalFrame(lat0, lon0)` (lib/engine/geo.js) gives
   `toLocal(lat,lon) → {x,z}` meters (ENU) and `toGeo(x,z)` back. +x east,
   +z south-ish (z = -north); Y is up, meters everywhere.
2. **Terrain** — 3×3 Terrarium z14 PNG tiles → 65×65 heightmaps
   (`terrainTiles` Map) + skirted meshes; ground texture = OSM raster
   composited on a canvas (2048 px center tile) that later gets roads/
   shadows painted into it (`tileCanvases`). `createGroundHeight` bilinear-
   samples the heightmaps; `createTerrainPatcher` mutates them + the mesh
   for editor terrain edits.
3. **PROGRESSIVE FIRST PAINT** — loading screen drops here (readyPct 100),
   player can walk on terrain; the city streams behind a toast. Do not gate
   anything new on city data being present.
4. **City build (`loadCity`)** — builds geometry in a reusable two-worker pool; main-thread
   assembly yields between geometry batches and heavy sections. Buildings: footprint ring → ExtrudeGeometry →
   **caps split from walls via material groups** (walls get facade texture +
   emissive night windows; caps render as plain concrete) → walls get
   vertex-color AO (darken toward street) × per-building tint jitter →
   batched into `byColor` merged meshes. Roads are NOT meshes: painted into
   the ground canvas (casing/fill/markings/sidewalk bands/zebra crossings at
   `highway=crossing` nodes) plus terrain-conforming decal ribbons. Also:
   waterways, bridges (walkable decks in `bridgeDecks`), rails, barriers,
   props (baked per-material in lib/engine/props.js), hipped roofs for small
   houses, rooftop tanks/AC, POI awnings, street furniture, lamp light pools.
4b. **Spawn framing** (`lib/engine/street/spawn.js`) — chooses where the player
   stands and which way they face. Ray-marches the camera's view cone against
   building footprints and scores candidates on coverage × openness, so the
   first frame is a street with buildings in it rather than open ground. Reuses
   the collision system's `insideBuilding` as its hit test. `roadPoints` (from
   city-builder-core) exist *only* to feed this, and are clipped to 150 m of
   the cell origin before crossing the worker boundary. Streamed neighbour
   cells pass `skipPlayerSpawn`; resume-from-saved-position uses `pickHeading`,
   which fixes the heading but never moves the player (moving would make the
   saved position drift a little further every session). Debug:
   `__streetDebug.spawnFraming()`; measure across cities with
   `node scripts/diag-spawn.mjs`.
5. **Population** — `createPopulation` (lib/engine/population.js): one
   InstancedMesh each for pedestrians/cars/birds walking or driving the
   road graph parsed from `roadPaths`; density scales with POIs, hour,
   rain. Model overrides via asset library naming: `car.glb`, `bird.glb`,
   `pedestrian.glb` (auto-scaled, ground-aligned, must face +Z; sideways
   vehicles are auto-rotated).
6. **Ambience** — lib/engine/ambience.js, synthesized noise beds
   (traffic/wind/rain) through one master gain; starts on first user
   gesture; 🔊 button mutes (localStorage `wtw_muted`).

Key runtime structures (on the runtime's shared `runtime.current` object,
which assembly, streaming and the editor read and append to): `roadPaths` `{pts: Vector2[](x, .y=z!), width, color,
id: "way/123", tags}`, `propMarkers`, `pois`, `bridgeDecks`, `buildingMats`
(emissive intensity driven by `applySky`), `lampPools`, `edits`/`editsKey`.

**Per-frame loop:** player move w/ footprint-grid collision
(`createCollision` — point-in-polygon over a 60 m grid; footprints carry
`meta {id, tags}` for picking), bridge deck standing, camera (first/third/
editor-fly), spinners, `population.update(dt, player, hour, raining)`,
precipitation, shadow frustum follow, HUD refs (no React re-render — HUD
values go through `posRef`/hud-ref, React state is only for panels/modes).

**Sky/time:** `applyEnvironment(hour)` in runtime.js calls `sky.apply()`
(sun/moon, fog, light intensities, exposure), then drives window glow, lamp
pools, street lights and bloom from the returned night `glow`. Live weather:
Open-Meteo (`live-weather.js`) → `setTime/setWeather/setPrecip` (settings
panel button).

## Globe (lib/globe/)

`components/Globe.js` is a thin shell around `createGlobeRuntime()`
(`lib/globe/runtime.js`): Cesium viewer setup, the street-bound fly-down and
hand-off, fly controls and quality. `walker.js` is walk mode inside Cesium,
`osm-buildings.js` the lazy styled OSM Buildings tileset, `road-overlay.js`
the Overpass road corridors, and `globe-math.js` the pure helpers (solar
time, weather atmosphere, adaptive resolution).

## Editor & debug (in-world)

- **E** = editor, **B** = tag inspector — also on-screen buttons (bottom
  right). Both modes detach into a fly camera (`fly` rig): scroll zoom, MMB
  orbit around cursor pivot, Shift+MMB pan, RMB freelook, WASD/Space/C.
- Tools (hotkeys 1-5): Select (click-tolerant 3 m), Flatten/Raise/Lower
  (brush radius slider; patches heightmap live), Hide OSM (removes feature
  on next load). Selected assets: **G** grab-move (click confirm/Esc cancel),
  R rotate, [ ] scale, X delete. **Ctrl+Z** undoes place/move/hide/terrain.
- Picking: `resolveOsmAt(hit)` — mesh `userData.osm` chain → nearest
  propMarker ≤3 m → `footprintAt` (ray-nudged for wall hits) → nearest road
  centerline (remember roadPaths pts are Vector2 with z in `.y`).
- Persistence: 💾 Save PUTs the whole edits JSON with `x-editor-key` from
  localStorage `wtw_editor_key`. Edits re-apply on load: terrain patches
  before city build, hidden filtered out of elements, tagOverrides merged
  over tags, assets placed after build.
- `/editor` page = asset **upload** UI only (special names documented there).

## Testing & benchmarks

- `npm test` — unit tests (Vitest). `npm run typecheck` — JSDoc types for
  modules that opt in with `// @ts-check` (see tsconfig.check.json).
- `npm run test:e2e -- <baseUrl>` — offline Playwright smoke test of a running
  build (home menu, street boot on the Rome fixture, walking, teardown). CI
  runs it after lint/typecheck/test/build.
- `window.__streetDebug` — test/debug hooks: `player`, `groundHeight`,
  `meshes()`, `pickAt(x,y)`, `propMarkers()`, `fly`, `setTime(h)`.
  `window.__engineReady` flips true when the city finished streaming.
  `window.__BENCH_MODE` + `?bench=1` uses a fixture instead of network.
- Headless smoke pattern (used throughout development): playwright +
  swiftshader, block bigdatacloud/open-meteo/myjyotishai routes, wait for
  `__streetDebug`, poke hooks, screenshot.
- `scripts/bench-perf.mjs` + BENCHMARK*.md — before/after methodology.

## Operational scripts

- `npm run seed:demo` — warms the 4 demo cities (`DEMO_PLACES` in lib/places.js: Pune, Edinburgh, Tokyo, New York). Fast travel, Today's walk and Where-am-I only offer these.
- `node scripts/warm-cities.mjs [base] [--list|--group="Goa"|--budget=N|
  --state=file|--conc=N]` — seeds R2 for lib/places.js PLACES +
  lib/seedPlaces.js SEED_GROUPS (88 places/440 cells ≈ 19 MB). Resumable
  via state file; re-runs skip warm cells.
- `npm run overture-index` — one-time Overture parquet footer scan → R2.

## Gotchas (each one cost us a debugging session)

1. **Binary vs text in R2**: `downloadObject` returns UTF-8 text and will
   corrupt GLBs — use `downloadBinary`. Cloudflare serves gzip-stored JSON
   decompressed to clients without Accept-Encoding; stored size ≠ served size.
2. **roadPaths points are `THREE.Vector2(x, z)`** — the z coordinate lives in
   `.y`. Any distance math against them must map `.y → z`.
3. **Custom models face +Z**; the loader rescales to real-world size (car
   4.4 m, ped 1.75 m) and floors at y=0. Rigged GLBs merge into bind pose
   (T-pose) — only static-posed models work as `pedestrian.glb` until VAT
   (plan 15.1).
4. **CACHE_VERSION and CELL_STEP** are shared in lib/city-contract.js.
5. **Overpass etiquette**: the browser does not contact Overpass directly.
   Each engine streams at concurrency 2; mirror attempts share the API deadline.
   This is not a distributed rate limiter across Vercel instances.
6. **Line endings**: repo has no `.gitattributes`; Windows checkouts rely on
   `core.autocrlf true` (set locally). Without it every file diffs.
7. **Editor writes need `EDITOR_SECRET`** set on the deployment; the UI
   works without it, only Save fails (401).
8. **R2 public domain is CDN-ready** (plan 12.3 done): CORS allows localhost +
   `walk-the-world-delta.vercel.app`; Cache Rule on myjyotishai.in caches
   city JSON (verify with GET — HEAD always shows `DYNAMIC` on R2). GLBs still
   go same-origin via `/api/assets/<name>` so GLTFLoader needs no bucket CORS.
9. **Emissive/appearance state is driven by `applyEnvironment`** (runtime.js)
   — if you add anything that glows at night, hook its intensity there.

## Where to add things (quick map)

- New OSM feature rendering → `city-builder-core.js` for parsing/geometry,
  then `street/assemble-city.js` for scene assembly. Always merge/instance; never one mesh per
  feature.
- New agent type in the world → lib/engine/population.js (follow the
  peds/cars pattern: list + InstancedMesh + update()).
- New prop kind from OSM tags → lib/engine/props.js builders + the node
  `kind` mapping in city-builder-core.js.
- New API → app/api/*, gate writes with `checkEditorKey`, store via
  r2Server (gzip text / binary as appropriate).
- New tool/mode in the editor → extend `editor.tool` union in editorClick +
  panel buttons (components/street/EditorPanel.jsx) + hotkey in
  editor-input.js + (if undoable) an `editor.undo` entry.
- New per-frame behaviour → a module with `update(dt, …)` called from the
  loop in runtime.js; keep the loop allocation-free.
- Roadmap → plan.md (phases; tick items with notes when done).

## Loading and validation changes (September 2026)

- The homepage menu is usable without WebGL. Cesium loads only when globe
  exploration is selected; Explore Shibuya goes straight to the street renderer.
- Complete cells use a bounded in-memory cache and IndexedDB. Old localStorage
  city entries are not trusted or migrated. Partial results never enter either
  cache; editor mutations receive a separate copy of fetched data.
- Browser subscribers share in-flight requests. Leaving the world cancels the
  fetch when its last subscriber leaves. A short negative CDN cache prevents
  repeated miss probes. Cold work remains bounded inside the API; no durable
  background queue or new cloud infrastructure is provisioned.
- Failed cell assembly rolls back reserved IDs, collision data and scene objects.
  Expired failures retry even when the player stands still.
- Regression coverage: `tests/city-route.test.js`, `city-loading.test.js`,
  `stream-lifecycle.test.js`, and `overpass-deadline.test.js`.
