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
- [x] 7.3 Per-category Overpass caps (buildings 2000 / roads 800 / landuse
      600 / props 700) instead of one shared cap — dense cells can't starve a
      category. (done: parallel category queries in `lib/overpassServer.js`,
      CACHE_VERSION → 6)
- [~] 7.4 `building:part` support — towers like Mumbai/Dubai skylines are
      modeled as parts; we currently drop them.
- [~] 7.5 Terrain upgrade where free lidar exists: keep Terrarium (30 m)
      global, override with Copernicus GLO-30 (already in Terrarium) and
      national lidar (USGS 3DEP, UK/NL/DK) via a per-region source map.
      India: no free lidar; Cartosat DEM (ISRO Bhuvan) is 30 m and
      registration-gated — not worth the pipeline; skip.
- [~] 7.6 Overture as *validator*, not just filler: cross-check OSM building
      count vs Overture per cell; if OSM < 30% of Overture, auto-blend.
- [x] 7.7 Name-aware props: shop/amenity nodes with `name` → storefront signs (done in 13.3: sprite name-boards + colored awnings at POIs)
      (the "living city" layer from OSM_TAGS.md §5).

## Phase 8 — Graphics pipeline improvements

- [x] 8.1 **Instancing everywhere**: props are individual meshes today
      (~100s of draw calls). Merge per-kind into `InstancedMesh` (lamps,
      benches, bollards…) — one draw call per prop type. Biggest win.
- [x] 8.2 **Shadows**: a single directional-light shadow map (2048, tight
      frustum around the player, updated when sun moves) transforms depth
      perception at street level for ~1-2 ms/frame.
- [x] 8.3 **SSAO / post stack**: contact shadows where buildings meet ground (done cheaper: baked vertex-color AO on walls + painted footprint contact shadows; true SSAO/bloom deferred to 16.2)
      kill the "floating boxes" look. three r170 post-processing works;
      consider N8AO (cheap SSAO lib).
- [~] 8.4 **Upgrade three r170 → r17x + WebGPURenderer** (production-ready
      since r171, auto-fallback to WebGL2). TSL is still rough-edged; adopt
      renderer first, TSL later. Expect wins on many-object scenes.
- [~] 8.5 Texture atlas for facades: bake 4-6 facade variants into one atlas,
      vary by UV offset per building — visual variety at zero extra draws.
- [~] 8.6 Roof geometry from `roof:shape` (gabled/hipped) — kills "every (partial: heuristic hipped roofs on small houses + rooftop tanks/AC shipped; tag-driven shapes still open → 17.3)
      building is a box"; cheap lathe/prism generation.
- [x] 8.7 Distance fog tuned per weather + height fog for dawn/dusk moods;
      tonemapping (ACES) + slight bloom on lamp glows at night. (done:
      FogExp2 density by weather + dusk mood; ACES exposure by sun elev;
      brighter additive lamp pools at night. Full SSAO/UnrealBloom → 16.2.)
- [~] 8.8 LOD rings: full detail < 300 m, merged-untextured 300-800 m,
      billboards beyond — prerequisite for seamless streaming (Phase 10.1).

## Phase 9 — R2 to the fullest (better quality, zero egress cost)

Free tier facts (verified): 10 GB Standard storage, 1 M Class-A (writes),
10 M Class-B (reads) per month, **zero egress**. `r2.dev` is rate-limited for
testing only; a **custom domain puts the bucket behind Cloudflare's CDN**
with real caching.

- [x] 9.1 **Custom domain on the bucket** (done: apex https://myjyotishai.in serves the bucket; client tries it first via NEXT_PUBLIC_R2_PUBLIC_BASE) →
      cached at Cloudflare edge, cache-control headers honored. Every asset
      below then ships CDN-fast worldwide.
- [~] 9.2 **Pre-baked ground textures**: today every client composites OSM
      tiles + paints roads into a canvas (CPU work, OSM tile-server load,
      z15-capped blur). Instead: server bakes the finished 2048² ground
      texture per cell ONCE (tiles + roads + areas + crossings), stores WebP
      in R2 (~150-400 KB). Clients download one image — faster load, sharper
      ground (can bake at z17 quality), OSM tile policy pressure gone.
- [~] 9.3 **Pre-built city meshes**: bake parsed geometry (buildings merged,
      roads, props transforms) into a compact binary (or Draco/glTF) per
      cell. Client skips Overpass parse + extrusion entirely — near-instant
      cell loads. R2 becomes a world CDN, not just a JSON cache.
- [x] 9.4 Region pre-bake script: warm the 16 fast-travel cities + rings (done as scripts/warm-cities.mjs + lib/seedPlaces.js: 88 places / 440 cells, resumable)
      around them overnight (stays comfortably inside free-tier ops).
- [~] 9.5 Asset pack in R2: facade atlas, road/rail textures, avatar, future (partial: GLB model library in R2 done — car/bird/test-cube; texture packs land with 17.1)
      GLBs — versioned folder, immutable cache headers.
- [x] 9.6 Gzip city JSONs (they compress 6-10×) until 9.3 replaces them.

## Phase 10 — Ambitious ideas (pick the ones that spark)

- [~] 10.1 **Seamless world streaming** — walk forever; neighbor cells stream
      in/out (needs 8.8 LODs). The single biggest "wow".
- [~] 10.2 **Time machine** — OSM has history; Overture has releases. Slider
      that rebuilds the same street from 2015 vs today's data.
- [~] 10.3 **Live layer** — OpenSky aircraft overhead with real flight
      numbers; GTFS-RT buses/trains gliding along their actual routes;
      day/night terminator on the globe.
- [~] 10.4 **Photo mode** — free camera + DoF + filters + watermark (= 15.2)
      (core done in 15.2: HUD hide + free fly + PNG save; DoF/filters/watermark still open)
      "walktheworld.dev · Pune" → users share screenshots = free marketing.
- [~] 10.5 **Walk journal** — trail line on the minimap, km walked, countries
      visited, elevation climbed; export a "walk card" image.
- [x] 10.6 **Ambient audio** — birds in parks, traffic on roads, waves at (done in 13.4: synthesized traffic/wind/rain beds, hour+weather aware, mute button)
      coasts, rain audio tied to live weather (freesound.org CC0).
- [x] 10.7 **NPC pedestrians/traffic** — instanced mannequins walking road (done in 13.1/13.2, plus real GLB models via asset library; VAT walk animation → 15.1)
      graphs, simple cars on driveable roads; density from real POI density.
- [~] 10.8 **"Guess where I am"** — hide the HUD, drop somewhere random, (= 15.5)
      (core done in 15.5; polish/scoring still open)
- [~] 10.9 **VR walk** (WebXR) — three.js supports it; walking your childhood
      street in VR is an unforgettable demo.
- [~] 10.10 **Seasonal foliage** — tree color by latitude + month (green
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

Dashboard steps done (2026-07-09): R2 CORS + Cache Rule on myjyotishai.in —
browser fetches city JSON from the CDN directly (see 12.3). GLBs still go
through `/api/assets/<name>` (same-origin; optional later if you want CDN GLBs).


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
- [x] **12.3 Serve warm cells without touching Vercel.** (done 2026-07-09:
      R2 CORS allows localhost + https://walk-the-world-delta.vercel.app;
      Cache Rule on myjyotishai.in → GET returns MISS then HIT / Age.
      Note: HEAD always shows DYNAMIC on R2 custom domains — verify with GET.)
      `cityData.js` tries `NEXT_PUBLIC_R2_PUBLIC_BASE` first; warm loads are
      pure CDN, zero Vercel function invocations.
- [x] **12.4 Overpass budget that fits serverless.** Passes [15s, 40s] instead
      of [20s, 60s]; add `overpass.private.coffee` as third mirror (same
      operator as kumi, explicitly no rate limits); accept partial results —
      if buildings answered but infra timed out, render buildings-only and
      let a background retry fill the rest. Worst case fits inside the
      function cap with room to respond.
- [~] **12.5 Instant placeholder city (later).** While Overpass streams, drop
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
- [~] **13.5 Transit ghosts.** Buses/trams gliding along `route` relations and
      the existing rails; stops already render (stations array).
- [x] **13.6 Birds (flock done, ground animals open) & animals.** Instanced flocking birds (classic boids, ~50
      instances), pigeons that scatter when the player runs through, dogs in
      parks.
- [~] **13.7 Multiplayer ghosts (ambitious).** Other live players as
      translucent avatars: positions over WebSocket via a Cloudflare Worker +
      Durable Object (free tier covers portfolio traffic easily). "You are
      walking Tokyo with 3 others right now."

Suggested order: 12.1 → 12.2 → 12.4 (cold start is the complaint) → 13.1 →
13.3 → 13.2 (visible life fastest) → rest.


## Phase 14 — Planet-scale data pipeline (real data, zero Overpass)

- [x] **14.1 Offline cell generator.** (partial: seed catalog warm-bake done via
      `scripts/warm-cities.mjs` + R2 — ~440 cells across demo cities; Overpass
      cold path still used outside the seed. Full offline planet.osm.pbf → cell
      JSON pipeline still open: ~87GB PBF download, ~150–250GB working disk,
      full downtowns ~200–300GB R2.)
- [~] **14.2 Overture height/landuse backfill.** Overture ships ML-derived
      building heights + land use with better coverage than OSM in sparse
      regions (Machu Picchu-grade areas). Merge into cells at generation time
      via the existing DuckDB pipeline.
- [~] **14.3 GTFS transit (real timetables).** Thousands of agencies publish
      GTFS feeds free (transitland index). Buses/trams gliding on real routes
      at real times of day — pairs with the live clock. Per-city static JSON
      baked into R2, no runtime API.

## Phase 15 — Living crowds & stickiness

- [x] **15.1 VAT pedestrians (the T-pose fix).** (done: procedural walk-cycle
      vertex shader on InstancedMesh via `lib/engine/ped-walk.js` + `aPhase`;
      Blender VAT textures can still replace later via asset library.)
- [x] **15.2 Photo mode.** (done: H / 📷 hides HUD, free-fly camera, 📸 PNG
      download via canvas.toDataURL; Esc exits. Grain/vignette/watermark later.)
      Also: 📤 share button copies `/street?lat&lon` from live `posRef`.
- [x] **15.3 Passport & walk stats.** (done: localStorage via zustand
      `passport` — km walked per place + total; 🛂 panel in GameShell.)
- [x] **15.4 Daily destination.** (done: date-seeded pick from PLACES +
      SEED_GROUPS on the title menu — "⭐ Today's walk: {name}".)
- [x] **15.5 Where-am-I mini-game.** (done: menu "🎲 Where am I?" → random
      city with HUD hidden + 4-choice panel; reverse-geocode suppressed until
      guess; play again from reveal.)
- [~] **15.6 Multiplayer ghosts.** Cloudflare Worker + Durable Object
      (free tier: 100k req/day — plenty) relaying player positions over
      WebSocket; translucent avatars. "Walking Tokyo with 3 others."

## Phase 16 — Renderer leap

- [~] **16.1 WebGPU migration.** three.js WebGPURenderer is production-ready
      (r171+) with automatic WebGL2 fallback via `three/webgpu`; Safari 26
      closed the gap. Unlocks compute-shader crowds (thousands of agents) and
      TSL node materials. Big refactor — its own branch, benchmarked before/
      after like the original engine rewrite.
- [~] **16.2 Postprocessing tier (quality-gated).** SSAO + bloom (night
      windows/lamp pools would bloom beautifully) + vignette/color-grade LUT
      behind the existing quality setting. LUT + vignette are nearly free;
      SSAO/bloom only on "high".
- [~] **16.3 GPU auto-detect.** Probe GPU tier on boot (render-time sample or
      WEBGL_debug_renderer_info) → auto-pick quality so weak phones never see
      shadows+population at once.
- [~] **16.4 PWA.** Manifest + service worker caching visited cells: install
      to home screen, re-walk your neighborhood offline.

## Phase 17 — Real visuals on a free budget (research 2026)

Verdicts first: **Google Photorealistic 3D Tiles — skip.** Now an Enterprise
SKU at only 1,000 free root-tile events/month (the $200 universal credit died
March 2025); a single busy demo day would blow it. Everything below is $0.

- [x] **17.1 CC0 PBR material set.** (done: `MeshStandardMaterial` + procedural
      albedo/normal/roughness in `lib/engine/materials.js`; buildings/roads/
      roofs/terrain use PBR. Drop CC0 maps at `/textures/*.jpg` or R2 later to
      replace procedural canvases — Poly Haven / ambientCG.)
- [x] **17.2 HDRI sky + image-based lighting.** (done: procedural equirect →
      PMREM in `lib/engine/env-map.js`; `scene.environment` blends with clock/
      weather; hemisphere fill reduced. Swap in Poly Haven HDRIs on R2 when
      ready — same controller.)
- [x] **17.3 OSM appearance tags we already download but ignore.** (done for
      colour/material/shape flags: `building:colour`, `colour`,
      `building:material`, `roof:colour`, `roof:material`, `roof:shape` →
      wall/roof buckets via `lib/engine/styles.js`. True gabled/dome meshes
      still open — pitched roofs reuse the hipped fan when shape requests it.)
      `building:part` (detailed landmark massing) remains → 7.4.
- [x] **17.4 Satellite ground option.** (done: Settings → Ground map OSM /
      Satellite; Esri World Imagery tiles via `lib/engine/ground-tiles.js`,
      live swap without reload; attribution in CREDITS + settings hint.)
- [x] **17.5 Facade UV rework → storefronts.** (done: facade atlas +
      `remapWallUVs` in `lib/engine/facade-uv.js`; storefront band for retail/
      commercial + near-POI buildings; upper floors use window bands.)


- [x] **17.6 Ambient music (licensed-safe soundtrack).** (done: day/night
      synth pads through ambience master, Settings music On/Off, mute still
      governs all; optional `public/audio/day.ogg` + `night.ogg` CC0 loops
      auto-detected. CREDITS.md updated.)

Shipped 2026-07-09: 17.5 + 15.1 + 18.1 + glass UI. Remaining phase items
marked skipped ([~]) unless revisited.


## Phase 18 — Player vehicles & movement modes

Everything below reuses existing systems: car/GLB models, groundHeight,
footprint collision, the road graph, water polygons, the live clock.

- [x] **18.1 Drivable car (the big one).** (done: C enter/exit nearest AI car;
      arcade controller in `lib/engine/street/vehicle.js`; chase cam, night
      headlights, engine hum via ambience; bounce vs footprints; half speed off-road.)
- [~] **18.2 Bicycle / scooter.** Same controller, tamer constants, fits
      footways — the natural way to see Amsterdam or Goa. Cheap once 18.1
      exists.
- [~] **18.3 Boat.** Water polygons are already parsed (rivers/lakes) —
      a small boat clamped to water with shore collision. Venice, the
      Mula-Mutha, Sydney harbour.
- [~] **18.4 Taxi / delivery missions.** Purpose for driving: pick up a
      pedestrian, drop at a named POI (both already in the data), timer +
      earnings tally in localStorage. Turns the sandbox into a game loop.
- [~] **18.5 Time trials + ghost replays.** Checkpoint runs on real streets;
      best-run ghost recorded to localStorage (positions @ 10Hz ≈ a few KB).
      Beat your own ghost through Shibuya.
- [~] **18.6 Traffic obeys signals.** OSM `highway=traffic_signals` nodes are
      in the cells already — AI cars queue at red lights on a simple timer
      cycle; player ignores them at their peril (18.4 fare bonus for clean
      driving). Sells the simulation instantly.

Order: 18.1 → 18.4 → 18.6 (car → purpose → believability), 18.2/18.3/18.5
as side quests.


## Phase 19 — CPU architecture: Workers & WebAssembly (honest verdicts)

Reality check first: the engine is GPU/draw-call and network bound. Per-frame
JS (population ~250 agents, grid-indexed groundHeight, footprint collision)
measures in fractions of a millisecond — WASM there would be complexity for
nothing. Where it DOES pay:

- [x] **19.1 Web Worker city builder (do this before any WASM).** (done:
      `lib/engine/city-builder-core.js` + `city-builder.worker.js`; parse +
      Extrude/merge off main thread; transferable buffers; canvas road paint +
      scene.add stay on main via `assemble-city.js`. Falls back to sync build.)
- [~] **19.2 Rapier physics (Rust→WASM) for Phase 18 vehicles.** The one
      clearly justified WASM adoption: ~1MB module, deterministic rigid-body
      physics, raycast vehicle controller built in. Real suspension, mass,
      collisions against building footprints as static colliders. Hand-rolled
      arcade physics (18.1) is fine for v1; Rapier is the upgrade when cars
      should FEEL heavy. Also free: falling crates, props with mass.
- [~] **19.3 WASM earcut triangulation (only if profiling says so).** Building
      extrusion leans on JS earcut inside three.js; a WASM earcut can cut
      polygon triangulation 2-5×. But it's a one-time build cost already
      hidden behind 19.1's worker — profile after 19.1, adopt only if the
      worker build still exceeds ~1s on dense cells.
- [x] **19.4 Where NOT to use WASM (recorded so we don't relearn it):**
      per-frame agent updates (too few agents, crossing the JS↔WASM boundary
      per frame can cost more than it saves), JSON parsing (native parse is
      already C++), gzip (native DecompressionStream), anything GPU-bound.
      If crowds ever scale 10-50× (post-16.1), prefer GPU compute over WASM.

Order: 19.1 with/before 10.1 streaming; 19.2 lands with Phase 18; 19.3 only
after profiling.
