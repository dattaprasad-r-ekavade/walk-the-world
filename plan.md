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

---

# Expansion Plan — Data Accuracy · Graphics · R2 · Ambitious Ideas

Researched 2026-07-07. No code changed yet — this is the agreed backlog.

## Phase 7 — Data accuracy for free (why the Pune bridge is missing)

**Diagnosis (verified live):** the North Main Road bridge EXISTS in OSM — 3
`highway + bridge=yes` ways within 650 m of our Pune spawn, and our query does
fetch them. Two things hide it:

1. **Rivers don't render.** The Mula-Mutha (like most large rivers worldwide)
   is mapped as a **multipolygon relation**, and we only fetch `way`s. No
   water under the bridge → the deck reads as ordinary road. This is the #1
   reason non-western areas "look flat": Indian/Asian cities lean heavily on
   relations for water, big campuses, and complex buildings.
2. **Bridge deck heuristic is timid** — deck sits 1.2 m over endpoint ground
   with railings only; over a wide river dip that reads as road, not bridge.

- [x] 7.1 Fetch relations: add `relation(${around})[natural=water];
      relation(${around})[waterway=riverbank];relation(${around})[building];`
      with `out geom` and assemble outer rings server-side (members come
      inline with `out geom`). Render exactly like way-polygons.
- [x] 7.2 Bridge visual upgrade: clearance = max(endpoint ground, water level
      + 4 m); side girders + darker underside so decks read as bridges even
      without water.
- [ ] 7.3 Per-category Overpass caps (buildings 2000 / roads 800 / landuse
      600 / props 700) instead of one shared cap — dense cells can't starve a
      category. (Buildings already split; finish the job.)
- [ ] 7.4 `building:part` support — towers like Mumbai/Dubai skylines are
      modeled as parts; we currently drop them.
- [ ] 7.5 Terrain upgrade where free lidar exists: keep Terrarium (30 m)
      global, override with Copernicus GLO-30 (already in Terrarium) and
      national lidar (USGS 3DEP, UK/NL/DK) via a per-region source map.
      India: no free lidar; Cartosat DEM (ISRO Bhuvan) is 30 m and
      registration-gated — not worth the pipeline; skip.
- [ ] 7.6 Overture as *validator*, not just filler: cross-check OSM building
      count vs Overture per cell; if OSM < 30% of Overture, auto-blend.
- [ ] 7.7 Name-aware props: shop/amenity nodes with `name` → storefront signs
      (the "living city" layer from OSM_TAGS.md §5).

## Phase 8 — Graphics pipeline improvements

- [x] 8.1 **Instancing everywhere**: props are individual meshes today
      (~100s of draw calls). Merge per-kind into `InstancedMesh` (lamps,
      benches, bollards…) — one draw call per prop type. Biggest win.
- [x] 8.2 **Shadows**: a single directional-light shadow map (2048, tight
      frustum around the player, updated when sun moves) transforms depth
      perception at street level for ~1-2 ms/frame.
- [ ] 8.3 **SSAO / post stack**: contact shadows where buildings meet ground
      kill the "floating boxes" look. three r170 post-processing works;
      consider N8AO (cheap SSAO lib).
- [ ] 8.4 **Upgrade three r170 → r17x + WebGPURenderer** (production-ready
      since r171, auto-fallback to WebGL2). TSL is still rough-edged; adopt
      renderer first, TSL later. Expect wins on many-object scenes.
- [ ] 8.5 Texture atlas for facades: bake 4-6 facade variants into one atlas,
      vary by UV offset per building — visual variety at zero extra draws.
- [ ] 8.6 Roof geometry from `roof:shape` (gabled/hipped) — kills "every
      building is a box"; cheap lathe/prism generation.
- [ ] 8.7 Distance fog tuned per weather + height fog for dawn/dusk moods;
      tonemapping (ACES) + slight bloom on lamp glows at night.
- [ ] 8.8 LOD rings: full detail < 300 m, merged-untextured 300-800 m,
      billboards beyond — prerequisite for seamless streaming (Phase 10.1).

## Phase 9 — R2 to the fullest (better quality, zero egress cost)

Free tier facts (verified): 10 GB Standard storage, 1 M Class-A (writes),
10 M Class-B (reads) per month, **zero egress**. `r2.dev` is rate-limited for
testing only; a **custom domain puts the bucket behind Cloudflare's CDN**
with real caching.

- [ ] 9.1 **Custom domain on the bucket** (e.g. `assets.walktheworld.dev`) →
      cached at Cloudflare edge, cache-control headers honored. Every asset
      below then ships CDN-fast worldwide.
- [ ] 9.2 **Pre-baked ground textures**: today every client composites OSM
      tiles + paints roads into a canvas (CPU work, OSM tile-server load,
      z15-capped blur). Instead: server bakes the finished 2048² ground
      texture per cell ONCE (tiles + roads + areas + crossings), stores WebP
      in R2 (~150-400 KB). Clients download one image — faster load, sharper
      ground (can bake at z17 quality), OSM tile policy pressure gone.
- [ ] 9.3 **Pre-built city meshes**: bake parsed geometry (buildings merged,
      roads, props transforms) into a compact binary (or Draco/glTF) per
      cell. Client skips Overpass parse + extrusion entirely — near-instant
      cell loads. R2 becomes a world CDN, not just a JSON cache.
- [ ] 9.4 Region pre-bake script: warm the 16 fast-travel cities + rings
      around them overnight (stays comfortably inside free-tier ops).
- [ ] 9.5 Asset pack in R2: facade atlas, road/rail textures, avatar, future
      GLBs — versioned folder, immutable cache headers.
- [x] 9.6 Gzip city JSONs (they compress 6-10×) until 9.3 replaces them.

## Phase 10 — Ambitious ideas (pick the ones that spark)

- [ ] 10.1 **Seamless world streaming** — walk forever; neighbor cells stream
      in/out (needs 8.8 LODs). The single biggest "wow".
- [ ] 10.2 **Time machine** — OSM has history; Overture has releases. Slider
      that rebuilds the same street from 2015 vs today's data.
- [ ] 10.3 **Live layer** — OpenSky aircraft overhead with real flight
      numbers; GTFS-RT buses/trains gliding along their actual routes;
      day/night terminator on the globe.
- [ ] 10.4 **Photo mode** — free camera + DoF + filters + watermark
      "walktheworld.dev · Pune" → users share screenshots = free marketing.
- [ ] 10.5 **Walk journal** — trail line on the minimap, km walked, countries
      visited, elevation climbed; export a "walk card" image.
- [ ] 10.6 **Ambient audio** — birds in parks, traffic on roads, waves at
      coasts, rain audio tied to live weather (freesound.org CC0).
- [ ] 10.7 **NPC pedestrians/traffic** — instanced mannequins walking road
      graphs, simple cars on driveable roads; density from real POI density.
- [ ] 10.8 **"Guess where I am"** — hide the HUD, drop somewhere random,
      let the player guess on the world map (the descoped GeoGuessr, single
      player, zero backend).
- [ ] 10.9 **VR walk** (WebXR) — three.js supports it; walking your childhood
      street in VR is an unforgettable demo.
- [ ] 10.10 **Seasonal foliage** — tree color by latitude + month (green
      summer, orange October, bare + snow in winter).

## Suggested sequencing

1. **6.1 + 6.2** (relations + bridge visuals) — fixes Pune-class gaps, the
   stated pain.
2. **7.1 + 7.2** (instancing + shadows) — cheap, dramatic.
3. **8.1 + 8.2** (custom domain + baked ground) — quality AND speed AND
   removes OSM tile-server dependence.
4. Then one Phase 9 pick — 10.1 if ambitious, 10.4 if quick.


## Phase 11 — Editor & debug tooling (done)

- [x] **11.1 Asset library** — upload .glb to R2 under `assets/` via `/editor` page
      (`POST /api/assets?name=x.glb`, `x-editor-key` header = `EDITOR_SECRET`).
      Listing: `GET /api/assets`. Files served same-origin via
      `GET /api/assets/<name>` so GLTFLoader needs no bucket CORS.
- [x] **11.2 Map editor (E key in /street)** — arm an asset and click the ground
      to place; Select tool + R rotate / [ ] scale / X delete; Flatten tool
      patches the heightmap live. 💾 Save persists per-cell edits to R2
      (`edits/<cellkey>.json` via PUT `/api/edits/<key>`); placements and
      terrain patches re-apply on every load.
- [x] **11.3 Debug mode (B key in /street)** — click any building or road to see
      its OSM tags (buildings via footprint meta, roads via nearest-centerline
      lookup). Tags editable as `key=value` lines → saved as local overrides in
      the same edits JSON, merged over Overpass data on reload. "Edit on OSM"
      deep-links to openstreetmap.org for real upstream fixes.

- [x] **11.4 Terrain brushes & OSM feature removal** — editor now has Raise /
      Lower / Flatten brushes (4-60m radius slider, clicks stack) for closing
      terrain gaps by hand, and a 🗑 Hide OSM tool that removes stray/broken
      buildings or roads (persisted per cell, filtered out on load; "Unhide
      all" / "Reset terrain" to revert).

Dashboard steps still open (both optional): R2 Cache Rule for edge caching, and
a bucket CORS policy if you ever want the browser to fetch city JSON / GLBs
directly from https://myjyotishai.in instead of through the API routes.


## Phase 12 — Cold-start: first image in seconds, not minutes

**Diagnosis (measured in code, matches user reports exactly).** The loading
screen blocks until `readyPct >= 100`, and that waits on `await cityDataPromise`
— the full Overpass fetch. On a cold cell the server tries pass 1 (20s × 2
mirrors) then pass 2 (60s × 2 mirrors) = up to **160s worst case**, but the
Vercel function is capped at `maxDuration 120` → killed → 500 → client gets
`null` → "Ready (terrain only)". That is precisely "2–3 minutes for the first
image, and no buildings". Terrain itself is ready at readyPct 55 within ~5–10s;
users just never see it.

- [x] **12.1 Progressive first paint (the big one).** Drop the loading screen
      as soon as terrain + spawn are ready (~readyPct 55→100 after terrain).
      Walk immediately on "map-textured" ground (the OSM raster already shows
      roads/footprints), stream buildings in when Overpass answers, with a
      small "streaming city…" toast instead of a blocking bar. First image
      ~5–10s even on stone-cold cells.
- [x] **12.2 Seed the cache.** `scripts/warm-cities.mjs`: loop the fast-travel
      PLACES (+ 4 neighbor cells each) through `/api/city/`. Run once locally
      (or on a schedule) — every demo city becomes a warm R2 hit (~1–3s).
      Whatever is rendered once is cached forever, so seed what users will try.
- [ ] **12.3 Serve warm cells without touching Vercel.** `cityData.js` already
      tries `NEXT_PUBLIC_R2_PUBLIC_BASE` first; it currently fails on missing
      bucket CORS and falls back to the API. Dashboard steps (both free):
      R2 bucket → Settings → CORS policy allowing GET from the app origins,
      and a Cache Rule on myjyotishai.in (currently `cf-cache-status: DYNAMIC`)
      → warm loads become pure CDN, zero function invocations.
- [x] **12.4 Overpass budget that fits serverless.** Passes [15s, 40s] instead
      of [20s, 60s]; add `overpass.private.coffee` as third mirror (same
      operator as kumi, explicitly no rate limits); accept partial results —
      if buildings answered but infra timed out, render buildings-only and
      let a background retry fill the rest. Worst case fits inside the
      function cap with room to respond.
- [ ] **12.5 Instant placeholder city (later).** While Overpass streams, drop
      simple grey blocks from Overture-cached footprints if present, replaced
      when real data lands.

## Phase 13 — Populated world (living cities)

All data comes from tags already in the cached city JSON — no new APIs.

- [x] **13.1 Pedestrians.** (done — instanced walkers on the street graph, hour/weather density) Low-poly walkers on the walkable-way graph
      (footways/residential/paths already in roadPaths). One InstancedMesh,
      LOD-style: near instances get bobbing walk animation via vertex shader
      time offset, far ones slide. Density from POI counts per area (shops,
      amenities) × time-of-day curve (lunch rush, empty at 3am, matches the
      live-clock/weather system — fewer people in rain).
- [x] **13.2 Traffic.** (done — instanced cars on drivable ways, oneway respected) Cars as instanced boxes-with-wheels following road
      centerlines, direction from `oneway`, speed by highway class, simple
      spacing (no overtaking). Headlight sprites + red taillights at night.
- [x] **13.3 POI life (signs).** (done — sprite name-boards for nearest named shops/amenities; lit windows done — emissive night windows driven by the sky cycle) `shop`/`amenity` nodes → storefront signs (canvas
      textures), lit windows near commercial POIs at night, café awnings,
      market stalls. Makes commercial streets read as alive at zero data cost.
- [x] **13.4 Ambient audio.** (done — synthesized traffic/wind/rain beds, hour+weather aware, mute button) Positional loops: traffic hum scaled by road
      class density, birds in `leisure=park`/tree clusters by day, crickets at
      night, rain layer tied to the existing weather state. Web Audio, tiny.
- [ ] **13.5 Transit ghosts.** Buses/trams gliding along `route` relations and
      the existing rails; stops already render (stations array).
- [x] **13.6 Birds (flock done, ground animals open) & animals.** Instanced flocking birds (classic boids, ~50
      instances), pigeons that scatter when the player runs through, dogs in
      parks.
- [ ] **13.7 Multiplayer ghosts (ambitious).** Other live players as
      translucent avatars: positions over WebSocket via a Cloudflare Worker +
      Durable Object (free tier covers portfolio traffic easily). "You are
      walking Tokyo with 3 others right now."

Suggested order: 12.1 → 12.2 → 12.4 (cold start is the complaint) → 13.1 →
13.3 → 13.2 (visible life fastest) → rest.


## Phase 14 — Planet-scale data pipeline (real data, zero Overpass)

- [ ] **14.1 Offline cell generator.** Download `planet.osm.pbf` (~80GB, free)
      or per-country extracts from Geofabrik; run an osmium/pyosmium script
      that emits the exact same city-cell JSON the API produces today; bulk
      upload to R2. All cities on Earth ≈ 300GB ($4.50/mo R2) generated in
      days on one machine — no Overpass, no rate limits, no cold cells ever.
      Free-tier variant: generate only the seed catalog + top-N city cores
      (10GB free = ~160k dense cells ≈ every major downtown on the planet).
- [ ] **14.2 Overture height/landuse backfill.** Overture ships ML-derived
      building heights + land use with better coverage than OSM in sparse
      regions (Machu Picchu-grade areas). Merge into cells at generation time
      via the existing DuckDB pipeline.
- [ ] **14.3 GTFS transit (real timetables).** Thousands of agencies publish
      GTFS feeds free (transitland index). Buses/trams gliding on real routes
      at real times of day — pairs with the live clock. Per-city static JSON
      baked into R2, no runtime API.

## Phase 15 — Living crowds & stickiness

- [ ] **15.1 VAT pedestrians (the T-pose fix).** Bake a walk cycle to a
      Vertex Animation Texture in Blender (OpenVAT, free) from a CC0 rigged
      character; playback in a small shader with per-instance time offsets.
      Proven at 2000+ animated instances on low-end GPUs — real walking
      humans, still one draw call. Ship mesh+VAT via the asset library.
- [ ] **15.2 Photo mode.** Hide HUD, free camera, optional grain/vignette,
      one-click screenshot download. Near-zero effort, maximum shareability.
- [ ] **15.3 Passport & walk stats.** km walked per city, places visited,
      date-stamped "stamps" (localStorage). "Walked 4.2 km in Tokyo."
- [ ] **15.4 Daily destination.** Date-seeded "today's walk" city on the
      menu — a reason to return every day. One function.
- [ ] **15.5 Where-am-I mini-game.** Random drop, guess the city from what
      you see (GeoGuessr-style). Data already in the cells.
- [ ] **15.6 Multiplayer ghosts.** Cloudflare Worker + Durable Object
      (free tier: 100k req/day — plenty) relaying player positions over
      WebSocket; translucent avatars. "Walking Tokyo with 3 others."

## Phase 16 — Renderer leap

- [ ] **16.1 WebGPU migration.** three.js WebGPURenderer is production-ready
      (r171+) with automatic WebGL2 fallback via `three/webgpu`; Safari 26
      closed the gap. Unlocks compute-shader crowds (thousands of agents) and
      TSL node materials. Big refactor — its own branch, benchmarked before/
      after like the original engine rewrite.
- [ ] **16.2 Postprocessing tier (quality-gated).** SSAO + bloom (night
      windows/lamp pools would bloom beautifully) + vignette/color-grade LUT
      behind the existing quality setting. LUT + vignette are nearly free;
      SSAO/bloom only on "high".
- [ ] **16.3 GPU auto-detect.** Probe GPU tier on boot (render-time sample or
      WEBGL_debug_renderer_info) → auto-pick quality so weak phones never see
      shadows+population at once.
- [ ] **16.4 PWA.** Manifest + service worker caching visited cells: install
      to home screen, re-walk your neighborhood offline.

## Phase 17 — Real visuals on a free budget (research 2026)

Verdicts first: **Google Photorealistic 3D Tiles — skip.** Now an Enterprise
SKU at only 1,000 free root-tile events/month (the $200 universal credit died
March 2025); a single busy demo day would blow it. Everything below is $0.

- [ ] **17.1 CC0 PBR material set.** Poly Haven + ambientCG are fully CC0
      (commercial OK, no attribution): photoscanned facades, asphalt,
      concrete, terracotta at 1-2K resolution. Download once, host on R2
      (free egress), replace the procedural canvas textures: real plaster/
      brick/glass facades, tiling asphalt with normal maps. Biggest visual
      upgrade per hour of work available. ~20-40MB of textures total.
- [ ] **17.2 HDRI sky + image-based lighting.** Poly Haven HDRIs (CC0): a
      handful of sky domes (clear noon, golden hour, overcast, night) as
      scene.environment — physically-plausible ambient light and reflections
      instead of flat hemisphere light. Blend selection into the live
      clock/weather system. A few MB each, cached in R2.
- [ ] **17.3 OSM appearance tags we already download but ignore.**
      `building:colour`, `building:material`, `roof:colour`, `roof:shape`
      (gabled/hipped/dome!), `building:part` (detailed landmark massing —
      e.g. tiered towers). Zero new data cost — parse what's in the cells.
- [ ] **17.4 Satellite ground option.** Esri World Imagery tiles are free
      with attribution for non-commercial apps — a settings toggle swapping
      the OSM raster ground for aerial imagery. Real rooftops/ground colors
      under the extruded buildings; keep OSM raster as default for the game
      look.
- [ ] **17.5 Facade UV rework → storefronts.** Switch facade UVs from
      world-meters to per-floor bands so ground floors get shopfront glass +
      doors near POIs and floor counts read correctly. Prereq for 17.1
      looking its best.

Suggested order: 17.1 → 17.2 → 15.1 → 15.2/15.3 (cheap wins) → 14.1 → 16.x.
