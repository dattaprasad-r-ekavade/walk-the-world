# Walk the World — Performance and Visuals Implementation Plan

Updated: 27 October 2026. Status: Stage 0 instrumentation, synthetic fixtures,
and an attributed/sanitized real-city fixture are implemented. Five same-
condition integrated-GPU repetitions are recorded as provisional because frame
pacing drifted. Deterministic multi-cell movement, a stable matched matrix, and
release acceptance remain open. Implementation continues.

## 1. Verified baseline and scope

Fetched origin on 27 October 2026 and verified that local `main` and
`origin/main` both point to `adf6d073a56f1dd8e2937aeb9147e4fc4645eca0` before
this implementation checkpoint. Earlier performance and setup branch work is
already merged into `main`. Stage 0.4/0.5 changes are local and uncommitted;
recheck the remote before the next checkpoint.

This is the active implementation sequence for
[PERFORMANCE-VISUALS-PLAN.md](PERFORMANCE-VISUALS-PLAN.md), which contains
online research, sources and alternatives accessed on 27 October 2026.
The old roadmap is preserved in
[docs/PLAN-LEGACY-2026-10-27.md](docs/PLAN-LEGACY-2026-10-27.md).
Its historical checkboxes are not new validation. [plan2.md](plan2.md)
retains broader product goals.

Goal: more convincing real streets, responsive walking/driving, bounded resources
and preserved editor/reconstruction behaviour. Keep Next.js/React, Cesium globe
travel and Three.js street rendering. Improve the existing pipeline before
adopting Rust/Wasm/SIMD where measurement justifies them. The lockfile specifies
Three.js 0.170.0: inspect matching APIs/source before using current online examples.
Keep dependency upgrades separate from performance experiments.

Implementation follows the bounded checkpoints below. Deployment, production
cache publication and purchases remain separate release work.

## 2. Features already present: retain and validate

| Existing code | Integration point | Remaining work |
|---|---|---|
| Two pooled geometry workers, transferable outputs | lib/engine/city-builder.js and city-builder.worker.js | Measure packing, queue, compute and copy overhead |
| Merged geometry and material caches | city-builder-core.js, materials.js, street/assemble-city.js | Measure residual colour/material fragmentation |
| Lit road ribbons and weather-driven roughness | getRoadMaterial and setRoadWetness in materials.js | Tune scale/response; validate new roads inherit weather |
| Pooled real streetlights: four created on high tier | street-lights.js and components/StreetEngine.js | Validate reassignment, streaming and quality transitions |
| Medium night bloom and high SSAO | post-fx.js and StreetEngine.js | Measure all passes; current bloom uses brightness threshold, not selective emissive masking |
| Quantized PMREM updates | env-map.js | Tune colour while retaining bounded updates/disposal |
| Instanced crowds, tier density caps and slower low/medium simulation | population.js, ped-walk.js, engine setup | Profile before rewriting simulation |
| Terrain eviction and cell cleanup | street/terrain.js, street/cell-stream.js, street/resources.js | Prove long-walk/return-route resource bounds |
| Collision grid, height caches, low-churn HUD | street/collision.js, street/ground-height.js, lib/perf.js | Preserve behaviour while adding diagnostics |

Older night-roadmap prose predates several features above. Do not rebuild them.
Source presence does not establish real-GPU visual acceptance or performance.

## 3. Work rules and acceptance gates

Implement one bounded stage/substage at a time. Preserve unrelated working-tree
changes. Keep a working fallback for experimental geometry/materials. Add tests
for meaningful contracts rather than implementation details. At every exit save
revision, environment, comparison, screenshots, keep/defer/revert decision,
limitations and rollback. Check off tasks only after exit criteria pass.

[PERFORMANCE-BUDGETS.md](PERFORMANCE-BUDGETS.md) remains the release authority:
60 FPS desktop target, 30 FPS low-mobile minimum, p95 frame time under 16.7/33.3 ms,
warm interactive under 4/6 s, streaming stalls under 100/150 ms, and bounded memory
during a 15-minute walk. Preserve existing menu and cold-start targets.

Proposed experiment gates, recalibrated only after establishing measurement noise:

- Visual-only change: no repeatable p95 frame-time regression above 3%, no
  input-ready regression above 5%, and no newly failed absolute budget.
- Rust: at least 25% lower complete geometry-stage time on representative dense
  cells, including conversions/copies, with observable loading/stutter benefit
  and acceptable cold startup and memory.
- SIMD: at least 10% additional complete geometry-stage saving over scalar Wasm
  on intended devices; kernel-only gains do not qualify.
- An improved baseline that still misses its release target remains a failed gate.
  Do not silently reduce DPR, population, viewing distance or effects in A/B tests.

Use at least five measured repetitions after warm-up; alternate baseline/candidate
order and report median/spread. Record commit, lockfile/toolchain, OS/browser,
actual GPU, viewport/DPR, preset, route/seed, weather/time, cache and asset revision.
Lock adaptive quality for A/B; test adaptation separately. Include integrated GPU,
mid-tier desktop and real mobile with sustained thermal use. Unavailable devices
remain explicit open checks. Separate deterministic fixtures from real-network
cold starts. Software rendering proves no hardware speedup.

## 4. Stage 0 — Trustworthy profiling and fixtures

First implementation checkpoint. Files: lib/perf.js, components/StreetEngine.js,
lib/engine/city-builder.js, city-builder.worker.js, street/assemble-city.js,
scripts/bench-perf.mjs and benchmarks/fixtures/.

- [x] 0.1 Define a versioned result schema: environment, settings, stage timings,
  frame intervals, resource counts, validation errors and unavailable measurements.
  Bound telemetry; detailed tracing runs only in diagnostics.
- [x] 0.2 Instrument fetch/cache, JSON decode, clipping/filtering, queue delay,
  input packing and postMessage submission, worker compute and roundtrip/output
  bytes, assembly, canvas repaint and renderer CPU submission. Define
  terrain-ready, input-ready, first-building and streaming-complete separately.
  Report worker clone/transfer as combined roundtrip data; the browser worker API
  does not provide a separate clone or transfer wall-time measurement.
- [x] 0.3 Derive p50/p95/p99 frame time, frames over 50/100 ms and 1% low FPS
  (1000 divided by mean of slowest 1% frame intervals). Record duration/sample
  count and exclude background-tab throttling explicitly.
- [x] 0.4 Aggregate renderer counters across all passes. Use asynchronous GPU
  timers where available; discard disjoint samples and never block for results.
  Time around render is CPU submission time; counters are not a VRAM-byte meter.
- [x] 0.5 Add recorded showcase-city, dense, sparse and difficult-polygon fixtures
  with provenance/licensing. Keep minimal Rome as a smoke test, not
  visual/capacity evidence.
  - [x] Generate repeatable synthetic showcase, dense, sparse and complex-polygon
    fixtures; identify them as synthetic CC0 data.
  - [x] Seed population placement in benchmark mode (`--seed`, default 1337).
  - [x] Add a real-world showcase-city extract with OSM attribution, ODbL
    provenance and a sanitized source archive; synthetic fixtures remain the
    repeatable density/geometry controls.
- [x] 0.6 Extend and validate the benchmark CLI for fixture, route, coordinates,
  preset, renderer mode, duration, seed and output. Fail nonzero on failed
  checks/console/asset errors. Document switches only after they exist.
- [ ] 0.7 Prove street movement via player displacement. The runner focuses the
  Street page and requires measurable displacement.
  - [x] Require displacement for walking and add a seeded driving run that
    enters a nearby traffic car through the normal control handler.
  - [ ] Add deterministic walk and drive routes that cross a cell boundary and
    validate neighbor streaming and resource limits.
- [ ] 0.8 Capture matched production warm/cold/day/night/rain/crossing baselines
  and rank CPU, GPU, network and memory bottlenecks.
  - [x] Collect five 12-second warm, stationary, fixed-medium samples on Intel
    UHD 630; retain as a provisional repeatability check, not a release baseline.
  - [ ] Repeat after checking Chromium foreground state, OS load and integrated-
    GPU thermal/power conditions; alternate baseline/candidate runs for A/B.
  - [ ] Complete cold/warm, day/night, rain and moving/cell-crossing scenarios;
    include a mobile device before closing the hardware matrix.

### Implementation checkpoint — Stage 0 instrumentation, fixtures and hardware repeatability

Local checkpoint on 27 October 2026, based on `adf6d07` plus the working-tree
changes. The benchmark schema is version 2. Diagnostics capture frame intervals,
CPU render submission, all-pass Three.js counters, asynchronous WebGL2 GPU timer
results, resource counts and lifecycle timings. Renderer counters aggregate the
full logical frame, including shadow/post-processing passes. GPU query results
are read only after availability, disjoint results are dropped, outstanding
queries are bounded, and cleanup disposes pending queries. These counters do not
claim VRAM bytes. Diagnostics remain opt-in.

The seeded synthetic showcase/dense/sparse/complex-polygon fixtures and benchmark
seed are in place. Walking requires displacement. The driving scenario uses the
normal vehicle-entry input and records displacement. Neither scenario yet proves
deterministic cell-boundary streaming. The fixture README distinguishes synthetic
CC0 data from the old Rome smoke fixture, whose provenance is unverified.

Validation on this checkpoint: `npm test -- --reporter=dot` passed (10 files,
90 tests); `npm run build` passed. The app was run locally from the production
build. A separate visible Chromium run confirmed WebGL2 on Intel UHD 630
(ANGLE/D3D11) with the GPU timer-query extension supported. The fixed-medium run
was a warm, live-data 12-second walk at 1046x654 CSS pixels and DPR 1.25:

- [Fixed-medium hardware report](benchmarks/results/stage0/main-adf6d07-local-intel-uhd-medium-live-api-fixed-12s.json)
- [Captured scene](benchmarks/results/stage0/intel-uhd-medium-live-api-2026-10-27.png)
- 539 frame samples: 22.85 ms mean, 16.7 ms p50, 33.5 ms p95, 49.8 ms p99;
  two frames exceeded 50 ms and none exceeded 100 ms. The measured 1% low was
  18.96 FPS.
- CPU render submission: 14.34 ms mean and 19.30 ms p95. GPU timer: 536 samples,
  11.94 ms mean, 15.77 ms p95 and 18.61 ms p99; no disjoint samples were dropped.
- 576 average draw calls and 359,625 average triangles per frame; maximum 631
  calls and 506,916 triangles. Resources at capture: 590 geometries, 30 textures
  and 28 programs. Reliable VRAM byte counts remain unavailable.
- Player displacement was 49.91 m. The spawn cell was warm from IndexedDB and
  loaded 3,489 city elements plus one terrain tile. Adjacent-cell R2 requests
  were CORS-blocked and two local API neighbor requests returned 502. No
  benchmark validation errors were recorded, but the route’s streaming failures
  limit any scene-capacity conclusion.

This one run indicates that both CPU render submission and GPU execution consume
a substantial fraction of the frame budget; the draw-call count also merits an
audit. It is only a diagnostic sample, not a stable bottleneck ranking or an A/B
result. The browser’s quality tier, DPR, shadow setting and post-FX setting
stayed fixed for this run.

Five additional 12-second stationary repetitions were collected without moving
the player, on the same warm spawn cell and fixed-medium preset. The individual
reports and [five-run summary](benchmarks/results/stage0/main-adf6d07-local-intel-medium-idle-five-run-summary.json)
are saved in `benchmarks/results/stage0/`:

- Median frame p95 was 50.0 ms (range 33.5–50.7 ms); median p99 was 66.0 ms.
  The 1% low ranged from 10.9–18.9 FPS. Frames over 50 ms rose from 5 in the
  first repetition to 46 in the fifth; the last repetition included one frame
  over 100 ms.
- Median CPU render-submission p95 was 32.5 ms (range 23.1–43.2 ms). Median GPU
  p95 was 21.65 ms (range 18.07–24.26 ms). The timer extension returned samples
  in all five repetitions, with no disjoint samples.
- All runs held 611 draw calls and 362,800 triangles per sampled frame, with
  579 geometries, 30 textures and 28 programs. All were visible-tab samples and
  recorded zero player displacement, as intended for the stationary scenario.

The changing frame times and rising late-run stall count mean these repetitions
do not establish a stable release baseline. The cause is not isolated: check
browser focus, background machine activity, integrated-GPU power/thermal state,
and remote streaming before using this set for A/B decisions. The CPU and GPU
measurements are both material, so optimize only after a stable comparison.

Earlier base-commit `52873ca` and SwiftShader reports are historical smoke tests;
the browser-default and synthetic headless runs on `adf6d07` also selected
SwiftShader. They validate runner paths only and are not hardware performance
comparisons. The [synthetic dense report](benchmarks/results/stage0/main-adf6d07-stage0-5-synthetic-dense-seed1337.json)
recorded 48 geometries/25 textures/19 programs; the [seeded drive report](benchmarks/results/stage0/main-adf6d07-stage0-7-synthetic-drive-seed1337.json)
recorded 8.32 m of movement with a vehicle active.

The first Overpass capture was not saved; the follow-up request to an alternate
public instance timed out after 90 seconds. A custom BBBike extract was then
requested for the Rome Colosseum area and downloaded from the provider's ready
queue. The retained fixture contains 326 building-tagged ways (319 unique
footprints after production deduplication), 1,122 highway ways and 1,176 tagged
nodes in a 12.48799,41.88676–12.49701,41.89424 bbox. Rebuild it with
`npm run fixtures:build:rome`. The source XML included contributor account
attributes despite the provider help page's general statement that extracts
omit author metadata; the committed archive and JSON have those attributes
removed. The provenance sidecar records both the original download hash and the
sanitized archive hash. The JSON records its provider file date, extraction
area, attribution and ODbL 1.0 terms. See [fixture details](benchmarks/fixtures/README.md),
[BBBike extract service guidance](https://extract.bbbike.org/extract.html), and
[OSM copyright and license guidance](https://www.openstreetmap.org/copyright).

The real-world fixture completed two browser benchmark smokes on 27 October.
Both used headless Chromium with SwiftShader, no GPU timer-query support and no
movement-window FPS samples; these are fixture/renderer integration checks, not
performance evidence. The [six-second smoke report](benchmarks/results/stage0/main-adf6d07-osm-rome-swiftshader-6s.json)
records 4,524 fixture elements, no browser or asset errors, 49.2 seconds to
stream the spawn city and 3.5 m of movement. The [capture-run report](benchmarks/results/stage0/main-adf6d07-osm-rome-swiftshader-capture.json)
records 54.7 seconds to stream the same fixture and 0.5 m movement. Its rendered
scene capture is saved at
`benchmarks/results/stage0/rome-osm-showcase-swiftshader.png`.

Remaining Stage 0 gates: make deterministic walk and drive paths cross cell
boundaries; and
stabilise the five-run baseline before alternating matched candidate runs across
warm/cold, day/night/rain and crossing scenarios. Include real mobile hardware.
The current stationary repetition set is useful for repeatability diagnostics
but must not be used as a pass/fail A/B baseline. No shader, texture or visual
rendering behavior changed in this checkpoint.

Exit: repeated JSON/captures and a measured bottleneck report, without
architecture changes. Once noise and network variability are understood, choose
the next rendering or streaming stage based on those results. Bring geometry
work forward only if complete measured geometry-stage time dominates.

## 5. Stage 1 — Scheduling, allocation and streaming stability

Files: city-builder.js, city-builder-core.js, street/assemble-city.js,
street/cell-stream.js, street/terrain.js and street/resources.js.

- [ ] 1.1 Split measured assembly/paint/upload hotspots into time-budgeted work.
  Start individual chunk goals at 8 ms desktop / 12 ms mobile, then calibrate.
  Prioritise centre/visible data and stagger finished neighbour uploads.
- [ ] 1.2 Bound queues, cancel obsolete work and reject stale results. Preserve
  transactional rollback of scene objects, footprints and reserved IDs.
- [ ] 1.3 Compare one/two geometry workers on low-core devices. Include KTX2
  decoder workers in contention/memory decisions; retain defaults unless measured.
- [ ] 1.4 Reduce measured clones and temporary allocations. Index repeated road/
  POI queries only if traces justify it; preserve collision and height caches.
- [ ] 1.5 Verify terrain eviction/revisit, road repaint, shared material ownership,
  late imagery callbacks and stationary retries.

Exit: reduced measured spikes, lifecycle regression checks pass, and resident
resources stabilise in a 15-minute walk. Keep geometry semantics unchanged.

## 6. Stage 2 — Material families, batching and shader discipline

Files: styles.js, materials.js, facade-uv.js, city-builder-core.js,
street/assemble-city.js, post-fx.js and StreetEngine.js.

- [ ] 2.1 Inventory material keys, batches, shader programs and map samples per
  tier. Existing caches already share resources; target residual fragmentation.
- [ ] 2.2 Map raw OSM material names to a small family table, retaining meaningful
  plaster/brick/stone/metal/glass differences and deterministic colour variation.
- [ ] 2.3 Prototype family batching with linear-space vertex tint. Preserve AO/
  jitter without multiplying base tint twice. Keep chunk-local culling bounds,
  feature metadata and independent collision/editor picking.
- [ ] 2.4 Audit sRGB colour/emissive maps versus non-colour normal/ORM data and
  one final tone/output conversion in direct/post-processed rendering.
- [ ] 2.5 Compare simple low/far materials with near PBR using actual GPU timings.
  Preserve important road, glass and metal response.
- [ ] 2.6 Keep necessary shader patches version-matched, with stable cache keys
  and shared uniforms. Preserve fog/instancing/lighting/vertex colours/depth.
  Time/weather changes must not trigger per-object shader recompilation.

Exit: lower submission/program cost or approved visual gain at neutral cost;
no hue, silhouette, placement or editor-selection regression.

## 7. Stage 3 — Offline asset pipeline and compressed texture pilot

Files: materials.js, facade-uv.js, textures.js, model loading in StreetEngine.js,
public/sw.js and CREDITS.md. Proposed: assets/manifest.json,
scripts/build-assets.mjs and public/textures/.

- [ ] 3.1 Curate a coherent plaster/brick/stone/concrete/asphalt/paving set and
  small prop kit. Use the researched Poly Haven, ambientCG, Kenney and Quaternius
  sources; record actual asset URLs/licenses. Reuse existing credited assets.
- [ ] 3.2 Record author, license, source hash, metre scale, UV density, map roles
  and output revision. Preserve map/imagery attribution separately.
- [ ] 3.3 Normalise pivots/+Z direction; prune unused geometry/maps. Bake shallow
  facade detail into shared atlases, align emissive masks, add mip-safe gutters
  and avoid baking directional sunlight into albedo.
- [ ] 3.4 Pin offline conversion tools. Compare KTX2 ETC1S/UASTC per map type,
  inspecting normals, window detail and masks. ORM packing saves files; stock
  shaders may still sample each map separately.
- [ ] 3.5 Add one shared support-detected KTX2 loader, bounded decoder workers,
  self-hosted matching decoders and disposal. Preserve procedural fallback and
  measure transfer/compile/transcode/upload plus estimated GPU residency.
- [ ] 3.6 Start shared 512–1024 maps on low/medium and selective 2048 near atlases
  on high. Generate mipmaps; inspect gutters, repeat seams and projected detail.
  PNG/WebP transfer compression alone does not imply GPU memory compression.
- [ ] 3.7 Inspect/prune/deduplicate/simplify selected GLBs with glTF Transform.
  Compare Meshopt/Draco only where savings justify decoder cost; validate existing
  model merging, maps, orientation and instancing.
- [ ] 3.8 Content-hash derived outputs and make service-worker caching revision-
  aware. Stream optional detail after walking is usable; failed decode/network
  leaves a working scene. Production publication is separate release work.

Exit: approved captures, byte/transcode/upload/memory accounting, acceptable cold
input-ready time and tested offline/failure fallback. Avoid bulk library imports.

## 8. Stage 4 — Roads, lighting and regional visual identity

Files: materials.js, env-map.js, post-fx.js, street-lights.js, ground-tiles.js,
street/assemble-city.js and StreetEngine.js.

- [ ] 4.1 Fix reference poses for showcase day/dusk/night/rain. Tune exposure,
  sky/fog and palettes before more effects; preserve geography/night legibility.
- [ ] 4.2 Refine existing road ribbon scale, roughness, normals, markings and
  terrain fit. Remove duplicate layers/z-fighting before more decals. Keep far
  painted coverage and reserve detail for useful near views.
- [ ] 4.3 Tune existing wetness and validate late-created road materials inherit
  current weather. Roughness/environment response is an approximation, not mirror
  reflection. Keep SSR and planar reflection deferred.
- [ ] 4.4 Verify existing four-light high-tier pool reassignment, newly streamed/
  evicted lamp markers and quality transitions. Stable light counts avoid shader
  churn, but visible zero-intensity lights can still cost shading; measure policy.
  Do not add a second pool or shadow map for every lamp.
- [ ] 4.5 Tune existing half-resolution bloom before selective masking; compare
  extra passes if masking is needed. Compare optional SSAO with vertex/baked
  contact shading; inspect halos and washed-out daytime surfaces.
- [ ] 4.6 Retain quantized PMREM/shadow updates. Measure small-object shadow
  pruning and contact approximations without losing essential silhouette shadows.
  Do not regenerate environments every frame.
- [ ] 4.7 Improve shared facade/storefront variation and baked trim/dirt/reveals.
  Reserve geometry for near entrances/roofs/silhouettes. Avoid default parallax,
  displacement or costly fragment noise. Triplanar is a measured steep-slope
  option, not the default terrain shader.

Exit: approved visuals at matched DPR/population/view distance and measured tier
GPU budgets. Existing roads/lights are refined, not recreated. Real-GPU night/
bloom review is mandatory; headless evidence is insufficient.

## 9. Stage 5 — Spatial detail, vegetation and analytic weather

Files: street/assemble-city.js, street/cell-stream.js, props.js, population.js,
ped-walk.js, gpu-tier.js and StreetEngine.js.

- [ ] 5.1 Add chunk-local projected-size LOD. Calibrate starting 0–50 m near and
  50–150 m mid bands against FOV/driving speed. Keep far massing, hysteresis and
  bounded updates. Collision/editor metadata stays independent.
- [ ] 5.2 Atlas/spatially instance curated props and vegetation. Compare geometry
  canopies with cutouts on mobile; layered cutouts still cause overdraw. Keep
  conservative moving-instance bounds rather than enable incorrect culling.
- [ ] 5.3 Add vertex sway only where valuable; match normals, depth/shadow
  deformation and bounds. Alpha-to-coverage requires MSAA, not a universal fix.
- [ ] 5.4 Prototype precipitation from seeds/time/wrap height in a vertex shader.
  Compare against CPU writes including GPU overdraw, pause/resume and player-
  relative movement. Keep only if the complete frame cost improves.
- [ ] 5.5 Tier detail/effects independently with gradual adaptation/hysteresis.
  Preserve manual overrides and current crowd caps/rates unless separately
  justified. Test thermal behaviour and transitions.

Exit: approved popping/seams on walk/drive routes, correct collisions, bounded
resources and neutral/improved frame pacing. Fog must not hide geometry regressions.

## 10. Stage 6 — Direct-buffer JavaScript and scalar Rust/Wasm

Prerequisite: Stage 0 demonstrates significant geometry cost. Otherwise record
a measured deferral and complete rendering work first.
Files: city-builder-core.js, city-builder.js and city-builder.worker.js.
Proposed: rust/city-geometry/, backend adapter, build instructions and parity tests.

- [ ] 6.1 Define versioned numeric inputs/outputs: Float64 geographic precision
  where needed, Float32 local geometry, ring offsets, heights/styles, indices
  and IDs. Specify metres/axes/winding/closure/cap-wall split/ownership.
- [ ] 6.2 Implement simple direct-buffer JS walls/caps as the algorithmic control
  against ExtrudeGeometry allocations. Keep unsupported features on existing JS.
- [ ] 6.3 Implement matching pure Rust geometry; preserve height/terrain/UV/AO/
  tint rules. Test concavity, duplicate points, degenerate/malformed rings and
  negative coordinates. Define holes/multipolygons explicitly; unsupported
  features fall back with a reason instead of silently disappearing.
- [ ] 6.4 Compile scalar-compatible wasm32-unknown-unknown with pinned tools and
  explicit target features; instantiate once per existing worker. Browser I/O
  and Three.js stay JS. No server rewrite or shared-memory threads here.
- [ ] 6.5 Make coarse whole-cell calls, count packing/copies, reuse bounded memory
  and free Rust output. Copy final output to transferable buffers: ordinary Wasm
  memory is not detachable output. Recreate typed views after memory growth.
  Test large-cell allocation failure and recovery.
- [ ] 6.6 Add backend selection, JS fallback, load/validation errors, timeout,
  progress and stale-result handling. Long synchronous Wasm may require worker
  termination to cancel. Preserve transactional rollback.
- [ ] 6.7 Verify production paths/MIME/fallback loading/cache, module fetch/
  compile/startup and two-worker memory, separately from warm computation.
- [ ] 6.8 Compare current JS, improved JS and scalar Wasm with matched fidelity
  and complete-stage cost. Apply section 3's adoption gate; record defer/reject
  results if JS wins. Add roads/roofs only in later bounded checkpoints.

Exit: bounds/winding/cap/UV/index/feature-ID parity and finite attributes;
editor/lifecycle checks pass and adoption is evidence-backed. Equivalent surfaces
are required, not byte-identical triangulation order.

## 11. Stage 7 — Conditional SIMD and batched simulation

Files: Rust crate, backend adapter, geometry fixtures/tests and benchmark runner.

- [ ] 7.1 Profile scalar kernels; choose transforms/bounds/UV/colour or batched
  height work. Branch-heavy parsing/triangulation is not the default SIMD target.
- [ ] 7.2 Build explicit scalar/SIMD variants; detect support before selecting
  SIMD. Retain scalar/JS fallbacks; require neither relaxed SIMD nor threads.
- [ ] 7.3 Test tails/alignment/floating-point tolerances. Compare whole cells
  across available Chromium/Firefox/Safari and x86/ARM devices; leave unavailable
  combinations open.
- [ ] 7.4 Adopt only if the incremental stage gate passes without startup/memory
  regression. Vector width is not an application speedup promise.
- [ ] 7.5 Consider collision/population batching only if later profiles identify
  a separate bottleneck. Avoid per-query/agent crossings; preserve driven-car
  responsiveness and interpolation across differing worker/render rates.

Exit: full-stage benefit and fallback parity, or explicit measured deferral.

## 12. Stage 8 — Optional prebuilt-cell alternative

Proposed: scripts/build-city-geometry.mjs, derived-cache adapter and editor
invalidation hooks, integrated with city-contract.js and the streamer.

- [ ] 8.1 Compare local recorded prebuilt cells against raw JSON plus runtime
  build, including compressed payload/decode/upload. Start with showcase areas.
- [ ] 8.2 Store cell-local geometry and origin transform, not player-specific
  coordinates. Retain feature/raw metadata for editor operations and fallback.
- [ ] 8.3 Key derived data by source/builder/material-atlas/terrain/edit revisions.
  Preserve raw JSON/API contracts; use a separate namespace, not overwritten
  raw objects or broad public-cache invalidation.
- [ ] 8.4 Rebuild affected cells after hide/tag/terrain edits. Test late terrain,
  neighbours and revisits; keep weather/time dynamic and unseen cells runtime-built.
- [ ] 8.5 Adopt only if end-to-end benefit justifies invalidation complexity.
  Document separately authorised publication/rollback; local evaluation needs no
  production R2 writes.

Exit: correct transforms/invalidation and measured benefit, or a deferral record.

## 13. Stage 9 — Integration and acceptance

- [ ] 9.1 Consolidate accepted paths and remove losing experiments from defaults.
  Verify geometry/texture/light/decoder ownership and teardown.
- [ ] 9.2 Run relevant existing unit tests and production build. Add meaningful
  parity/lifecycle/fallback tests and validate actual benchmark CLI behaviour.
- [ ] 9.3 Exercise centre/neighbour loading, stationary retry, abort in each async
  stage, eviction/return, editor hiding/tag/terrain edits and car collisions.
- [ ] 9.4 Run locked-quality day/night/rain walk/drive A/B, cold starts, decoder/
  Wasm failure, offline/cache and available context-loss recovery checks.
- [ ] 9.5 Complete real-hardware 15-minute walks and mobile thermal/control review.
  Inspect seams/shimmer/wetness/shadows/night visibility/LOD popping.
- [ ] 9.6 Update architecture, credits, performance results, this plan and release
  checklist with actual keep/defer decisions and remaining gates.

Done means approved visuals within applicable budgets with preserved gameplay,
editor and streaming behaviour. Build success, headless captures and fast kernels
cannot close real-device acceptance. Deployment/live validation is a separate gate.

## 14. Commands and retained evidence

Existing commands, rechecked against package.json:

    npm test
    npm run build
    npm run start -- --port 3456

Run the server separately; existing smoke/benchmark entry points:

    npm run bench -- --base-url http://127.0.0.1:3456 --out benchmarks/results.json
    npm run bench:street -- http://127.0.0.1:3456

These use a small fixture and do not satisfy Stage 0's full matrix. Implement
additional switches before documenting them as available.

Proposed evidence locations:

    benchmarks/fixtures/<city-or-stress-case>.json
    benchmarks/results/<stage>/<revision>-<device>-<scenario>.json
    benchmarks/results/<stage>/decision.md
    screenshots/performance-visuals/<stage>/<matched-pose>.png

Keep personal/large raw traces out of routine commits. Each decision describes
matched settings, tested hardware, thresholds and remaining gates.

## 15. Deferred work and next action

WebGPU/TSL needs migration of shader patches and post-processing, not a renderer
rename. Wasm threads need a measured use case and verified cross-origin isolation
for Cesium, imagery and model resources. SSR, volumetrics, displacement, dense
skeletal crowds and shadowed lamp arrays require separate high-tier budgets.
None is a prerequisite for this sequence.

**Next implementation task: Stage 0 only — trustworthy measurements,
representative fixtures and a bottleneck report.** Choose the following checkpoint
from its evidence while retaining the complete sequence above.
