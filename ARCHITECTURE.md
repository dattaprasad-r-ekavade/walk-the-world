# Walk the World — Technical Architecture

Onboarding doc for contributors. Read this + `plan.md` (roadmap, what's done
and why) and you can work on any part of the system. README.md covers setup;
this covers how it actually works.

## System overview

```
┌────────────┐  fly/travel   ┌──────────────────┐
│  app/page  │──────────────▶│ /street?lat&lon  │  default walk experience
│ (CesiumJS) │               │ (StreetEngine,   │
│  globe     │               │  Three.js)       │
└────────────┘               └────────┬─────────┘
                                      │ fetchCityData(lat, lon)
                             ┌────────▼─────────┐
                             │ 3-tier cache      │
                             │ 1 localStorage    │  7-day TTL, same machine
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
  (lib/engine/cityData.js). The `6` is `CACHE_VERSION` — bump it to
  invalidate every cache tier at once (localStorage keys, R2 objects, edits).
  **It is duplicated in scripts/warm-cities.mjs — keep in sync.**
- A cell's data = one Overpass fetch of radius 650 m around the cell origin
  (`fetchOverpassCell`), stored as `{ elements: [...] }` in raw OSM JSON
  shape (ways with `geometry`, nodes, relations with `members`).
- Neighbor prefetch: the engine warms the 4 adjacent cells (±0.0055°)
  10 s after load, concurrency 2, via the same `fetchCityData` path so the
  shared cache always holds full-fidelity cells.
- Per-cell edits (map editor) live in R2 at `edits/<cellkey>.json`:
  `{ assets: [{name,url,lat,lon,rotY,scale}], terrain: [{lat,lon,radius,height}],
  tagOverrides: {"way/123": {k:v}}, hidden: ["node/456", ...] }`.

## Server pieces

| File | What it does |
|---|---|
| `lib/overpassServer.js` | Mirror list (overpass-api.de → kumi.systems → private.coffee), two-pass timeouts **[15 s, 40 s]** across all mirrors, two parallel queries per cell (buildings `out geom 2000`; infra roads/water/rail/nodes + relations), `Promise.allSettled` → partial results beat none. `parseCityKey` validates cell keys. |
| `lib/r2Server.js` | S3 client for R2 (`R2_ENDPOINT/ACCESS_KEY/SECRET/BUCKET`). Text objects are stored **gzipped** (`uploadObject`/`downloadObject`, ContentEncoding: gzip, 6-10× smaller). **Binary must use `uploadBinary`/`downloadBinary`** — the text path does a UTF-8 round-trip that corrupts GLBs (learned the hard way). `listObjects`, `checkEditorKey` (compares `x-editor-key` header to `EDITOR_SECRET`). |
| `app/api/city/[key]/route.js` | GET: R2 hit → stream; miss → Overpass → respond + async upload. maxDuration 120. |
| `app/api/edits/[key]/route.js` | GET returns edits JSON or `{}`; PUT saves (1 MB cap, editor key required). |
| `app/api/assets/route.js` | GET lists `assets/` (returns same-origin `url` + `cdnUrl`); POST uploads raw GLB body (`?name=x.glb`, 30 MB cap, editor key). |
| `app/api/assets/[name]/route.js` | Streams GLB bytes same-origin so GLTFLoader needs no bucket CORS. |
| `lib/overtureServer.js` | DuckDB-over-S3 Overture footprint queries (lazy import — duckdb never loads at build). Needs `npm run overture-index` once. |

Env (`.env.local`, never committed): `NEXT_PUBLIC_CESIUM_ION_TOKEN(_1/_2)`,
`R2_*`, `NEXT_PUBLIC_R2_PUBLIC_BASE` (public bucket domain), `EDITOR_SECRET`.
On Vercel all of these must be set in project env; `NEXT_PUBLIC_*` bake at
build time.

## Street engine (components/StreetEngine.js)

One big client component (~2000 lines), deliberately monolithic around a
single `useEffect(lat0, lon0)`; extracted pure helpers live in
`lib/engine/street/*` and `lib/engine/*`. Boot sequence:

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
4. **City build (`loadCity`)** — iterates `data.elements`, yields to rAF
   every 120 features. Buildings: footprint ring → ExtrudeGeometry →
   **caps split from walls via material groups** (walls get facade texture +
   emissive night windows; caps render as plain concrete) → walls get
   vertex-color AO (darken toward street) × per-building tint jitter →
   batched into `byColor` merged meshes. Roads are NOT meshes: painted into
   the ground canvas (casing/fill/markings/sidewalk bands/zebra crossings at
   `highway=crossing` nodes) plus terrain-conforming decal ribbons. Also:
   waterways, bridges (walkable decks in `bridgeDecks`), rails, barriers,
   props (baked per-material in lib/engine/props.js), hipped roofs for small
   houses, rooftop tanks/AC, POI awnings, street furniture, lamp light pools.
5. **Population** — `createPopulation` (lib/engine/population.js): one
   InstancedMesh each for pedestrians/cars/birds walking or driving the
   road graph parsed from `roadPaths`; density scales with POIs, hour,
   rain. Model overrides via asset library naming: `car.glb`, `bird.glb`,
   `pedestrian.glb` (auto-scaled, ground-aligned, must face +Z; sideways
   vehicles are auto-rotated).
6. **Ambience** — lib/engine/ambience.js, synthesized noise beds
   (traffic/wind/rain) through one master gain; starts on first user
   gesture; 🔊 button mutes (localStorage `wtw_muted`).

Key runtime structures (all in the effect scope; shared via
`engineRef.current`): `roadPaths` `{pts: Vector2[](x, .y=z!), width, color,
id: "way/123", tags}`, `propMarkers`, `pois`, `bridgeDecks`, `buildingMats`
(emissive intensity driven by `applySky`), `lampPools`, `edits`/`editsKey`.

**Per-frame loop:** player move w/ footprint-grid collision
(`createCollision` — point-in-polygon over a 60 m grid; footprints carry
`meta {id, tags}` for picking), bridge deck standing, camera (first/third/
editor-fly), spinners, `population.update(dt, player, hour, raining)`,
precipitation, shadow frustum follow, HUD refs (no React re-render — HUD
values go through `posRef`/hud-ref, React state is only for panels/modes).

**Sky/time:** `applySky(hour)` positions sun/moon, tunes fog + light
intensities, drives window glow + lamp pools via `winGlow`. Live weather:
Open-Meteo → `setTime/setWeather/setPrecip` (settings panel button).

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

- `npx vitest` — unit tests (lib/engine/geo + street modules).
- `window.__streetDebug` — test/debug hooks: `player`, `groundHeight`,
  `meshes()`, `pickAt(x,y)`, `propMarkers()`, `fly`, `setTime(h)`.
  `window.__engineReady` flips true when the city finished streaming.
  `window.__BENCH_MODE` + `?bench=1` uses a fixture instead of network.
- Headless smoke pattern (used throughout development): playwright +
  swiftshader, block bigdatacloud/open-meteo/myjyotishai routes, wait for
  `__streetDebug`, poke hooks, screenshot.
- `scripts/bench-perf.mjs` + BENCHMARK*.md — before/after methodology.

## Operational scripts

- `node scripts/warm-cities.mjs [base] [--list|--group="Goa"|--budget=N|
  --state=file|--conc=N]` — seeds R2 for lib/geo.js PLACES +
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
4. **CACHE_VERSION** lives in two files (cityData.js, warm-cities.mjs).
5. **Overpass etiquette**: ≤2 concurrent from one IP; mirrors rate-limit
   silently (queries hang, then time out). The two-pass budget must stay
   under Vercel's `maxDuration 120`.
6. **Line endings**: repo has no `.gitattributes`; Windows checkouts rely on
   `core.autocrlf true` (set locally). Without it every file diffs.
7. **Editor writes need `EDITOR_SECRET`** set on the deployment; the UI
   works without it, only Save fails (401).
8. **R2 public domain is CDN-ready** (plan 12.3 done): CORS allows localhost +
   `walk-the-world-delta.vercel.app`; Cache Rule on myjyotishai.in caches
   city JSON (verify with GET — HEAD always shows `DYNAMIC` on R2). GLBs still
   go same-origin via `/api/assets/<name>` so GLTFLoader needs no bucket CORS.
9. **Emissive/appearance state is driven by `applySky`** — if you add
   anything that glows at night, hook its intensity there (see `winGlow`).

## Where to add things (quick map)

- New OSM feature rendering → the parse loop in `loadCity`
  (StreetEngine.js), collect into arrays near `roadPaths`/`pois`, build
  merged meshes after the loop. Always merge/instance; never one mesh per
  feature.
- New agent type in the world → lib/engine/population.js (follow the
  peds/cars pattern: list + InstancedMesh + update()).
- New prop kind from OSM tags → lib/engine/props.js builders + the node
  `kind` mapping in StreetEngine's parse loop.
- New API → app/api/*, gate writes with `checkEditorKey`, store via
  r2Server (gzip text / binary as appropriate).
- New tool/mode in the editor → extend `editor.tool` union in editorClick +
  panel buttons + hotkey in onKey + (if undoable) `editor.undo` entry.
- Roadmap → plan.md (phases; tick items with notes when done).
