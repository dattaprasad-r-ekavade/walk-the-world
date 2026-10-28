# Walk the World — Performance and Visuals Implementation Plan

Updated: 28 October 2026. Reviewed base: `e90a47a` on `main`; subsequent
rendering fixes and the benchmark-only wet-road prototype are in this checkpoint.
This is the active plan. The [previous detailed checkpoint](docs/PLAN-CHECKPOINT-2026-10-28-BEFORE-REVIEW.md)
preserves the full experiment history; its status is historical.

## 0. Demo track — priority 0

The product goal is a smooth, good-looking live demo of four cities:
Pune, Edinburgh, Tokyo and New York (`DEMO_PLACES` in [lib/geo.js](lib/geo.js)).
Work in this section comes before R1–R5 and Stages 4–9. A Stage 0–9 item
moves ahead of the demo track only when it fixes a problem a demo viewer can see
or feel.

Acceptance for demo-track items (lighter than section 3):

- A before/after screenshot at the same position, time and weather in each of
  the four demo cities, saved under `screenshots/demo-track/`.
- `npm test` and `npm run build` pass.
- One visible-Chrome performance smoke in one demo city shows no frame-time p95
  regression above 5%. The five-repetition matrix is not required.

Demo-track items:

- [x] **D1 — Ground and sidewalks near the player.** Done: raster darkened,
  world-space detail grain near the player, stronger zebras; road-decal lane
  markings still open. At street level the ground
  reads as a flat white/beige smear and road markings are hard to see. Make the
  first 60 m read as asphalt with markings, kerbs and paved sidewalks. Prefer a
  world-space detail texture faded with distance over a larger ground canvas.
- [ ] **D2 — Per-city demo presets.** Each demo place opens at a chosen time and
  weather (not the live local time; New York opened dark at 06:00) and a curated
  start position and heading (Pune spawned facing an empty lot). Live time and
  weather stay the default outside the demo places.
- [ ] **D3 — Facade textures visible on demo hardware.** Prefetch the shared KTX2
  set and Basis decoder while the menu is open. Allow the near facade set on the
  medium tier on desktop GPUs that support compressed formats. Low tier and
  mobile stay unchanged.
- [ ] **D4 — Benchmark mode cannot reach live visitors.** `?bench=1` only works
  in builds with `NEXT_PUBLIC_ENABLE_BENCH=1` or in development.
- [ ] **D5 — Remove dead deploy weight.** Delete the unhashed KTX2 and Basis
  decoder copies in `public/` (about 7 MB); the runtime uses only hashed paths.
  Stop the asset script from recreating them. Ignore raw benchmark JSON/PNG
  results in git; keep committed decision reports.
- [ ] **D6 — Service-worker revision on every build.** `npm run build` stamps a
  new shell-cache revision, so a deploy never serves an old shell.
- [ ] **D7 — Demo rehearsal checklist.** After each demo-track change, load all
  four cities on the live deployment, confirm all 36 demo cells are warm
  (`npm run seed:direct` seeds Overpass straight into R2 from a local machine,
  without the API route's 85 s limit), and record time-to-ready and one
  screenshot per city with `npm run rehearse`.
- [x] **D8 — Facade and storefront variation (from 4.7).** Done: wider
  storefront rule, per-building window band/U shift and tint. Ground-floor shopfronts,
  entrances and roof silhouettes at the four demo start points.

Process rules for every stage:

- Visual and demo fixes need matched screenshots plus one performance smoke.
  Keep the five-repetition rule only for changing defaults or quality tiers.
- At most one benchmark-only or report-only commit for every two commits that
  change what a viewer sees or feels. Raw benchmark output stays out of git.
- Update this plan in place. Do not add new root plan files; archive superseded
  plans under `docs/archive/`.

## 0b. Outside-view roadmap — priority 1 (after the demo track)

Source: outside-view research of October 2026 (peer projects, rendering tech,
data pipeline). Each item states what already exists so work does not repeat it.
Items marked (verify) rest on unconfirmed research claims; check them before
starting. Acceptance follows the demo-track rules in section 0.

Decisions taken from the research:

- Stay on Three.js. Engine ports (Babylon.js, PlayCanvas, Bevy/WASM) cost weeks
  and do not fix integrated-GPU fill rate. Unreal pixel streaming is rejected
  (per-session GPU cost and latency).
- Streets GL (MIT, github.com/StrandedKitty/streets-gl) is the closest peer:
  Simple 3D Buildings roofs and parts, SSAO, aerial perspective, prebuilt
  vector tiles. Reuse its ideas and MIT code freely. Treat GPL/LGPL projects
  (Blosm, OSM2World) as reading material only.
- Google Photorealistic 3D Tiles are not the main view: caching and R2 storage
  are prohibited, attribution and per-session billing apply, and street-level
  geometry looks melted. At most a far-horizon backdrop.
- Licence traps: Sentinel-2 cloudless 2018+ is non-commercial (and 10 m);
  Esri, Mapbox and Google imagery must not be cached; Vercel Hobby is
  non-commercial with a 300 s function cap.

### Phase A — visible quality and frame rate

- [x] **A1 — Render-scale governor (S).** Done (lib/engine/render-scale.js;
  `__streetDebug.renderScale()`). Scale the pixel ratio 0.6–1.0 from
  p90 frame time with hysteresis before stepping the whole preset down; FXAA
  when MSAA is off and the composer is active. Today only whole presets step.
- [x] **A2 — Atmosphere and grading (S).** Done: dawn/dusk fog tint, grade
  pass after OutputPass on composer tiers. Time-of-day fog tint and density,
  plus one grading pass (exposure, contrast, saturation, vignette) on tiers
  that already run the composer. No new fullscreen pass on the low tier.
- [ ] **A3 — Interior-mapping windows (M).** Fake rooms behind facade windows
  within ~40–60 m, lit at dusk/night. Highest visual gain per millisecond.
  Start from three-fenestra (MIT, MeshStandardMaterial subclass) or port the
  ray-box shader; small shared room cubemap atlas (4–8 rooms).
- [ ] **A4 — Sidewalks, kerbs and lane markings (M).** Offset road edges into
  sidewalk polygons (sidewalk=* tags, default when missing), 15 cm kerb,
  paving texture, centre/edge/lane markings from lanes/width/oneway.
- [ ] **A5 — Full roof shapes and building parts (M).** styles.js already reads
  roof:shape for the pitched-roof heuristic. Add gabled, hipped, skillion,
  pyramidal and dome roofs plus building:part/min_height. Candidate:
  `straight-skeleton` npm (StrandedKitty, MIT wrapper over CGAL WASM; check
  the CGAL licence before shipping). Prefer running it in the B1 baker with
  gabled/hipped templates as runtime fallback.
- [x] **A6 — Streamed cells rise in (S).** Done (street/cell-rise.js;
  shadows rebake when the last rise ends). New cells grow from the ground over
  ~0.6 s instead of popping in; transform-only so shared materials stay
  untouched.
- [ ] **A7 — Three.js r170 → r186 (M).** Verified low risk for this stack:
  WebGL EffectComposer passes unchanged; PCFSoftShadowMap deprecated (PCF is
  now soft); rough PBR materials brighter (r181); PMREM moved to cube render
  targets (r187); KTX2Loader.detectSupportAsync deprecated (r181). Re-test
  every onBeforeCompile chunk replacement and compare matched screenshots.

### Phase B — data foundation

- [ ] **B1 — Prebuilt cell format (M).** Compact per-cell binary (quantized,
  meshopt-compressed) produced by a baker that reuses city-builder-core, so the
  browser skips Overpass JSON parsing and geometry building for baked cells.
  Add frame-sliced GPU uploads and renderer.compileAsync shader warm-up.
  Supersedes Stage 8 (8.1–8.5) and the Stage 6 prerequisite question.
- [ ] **B2 — Overpass independence (M).** Self-hosted Overpass on a small VPS
  for target regions behind a Cloudflare Worker, or a custom Planetiler
  profile (Protomaps' basemap schema drops roof, lane and colour tags).
  `npm run seed:direct` remains the stopgap.
- [ ] **B3 — Procedural landuse ground (S–M).** Asphalt, grass, paving and
  water materials from landuse polygons instead of the near-white Carto
  raster; extends D1.
- [ ] **B4 — Overture gap fill (S).** The Overture footprint fallback already
  exists for sparse cells. Remaining: merge Overture height, num_floors,
  roof_shape, roof_color, facade_color and facade_material into OSM buildings
  that lack them, in the baker (fields exist in the schema; coverage is sparse).
  Overture segments have no lanes or sidewalk fields, so A4 uses OSM tags.

### Phase C — larger bets, only with measured benefit

- [ ] **C1 — osm2streets lanes and intersections (L).** Apache-2.0 Rust
  library; the repo has an `osm2streets-js` WASM binding with GeoJSON output.
  npm package name and WASM size are unconfirmed: build and measure first.
- [ ] **C2 — Far-field HLOD and horizon backdrop (L).** Flat-coloured low-detail
  far cells with cross-fade; optional Cesium OSM Buildings or photoreal tiles
  beyond the procedural radius, within their terms.
- [ ] **C3 — WebGPU prototype (L).** WebGPURenderer behind a flag with TSL
  ports of the facade and ground materials. Expected gain 0–20% on
  integrated GPUs; GLSL onBeforeCompile patches do not run on it.

Already present (no new work): ambient audio, street furniture and lamps,
instanced crowds and traffic, photo mode, share links, wet roads, PWA shell.
Streets GL is unmaintained since September 2024; use it as reference code only.

Skip: engine switch, photoreal tiles as the main view, @takram atmosphere and
clouds on integrated GPUs, realism-effects, path tracing, pixel streaming.

## 1. Progress and code review

The project has working profiling, bounded streaming, material families, compressed
facade textures and desktop lighting diagnostics. Rendering remains the current
focus. Implementation progress has outpaced release acceptance: live dense-city,
mobile, offline and several visual gates remain open.

| Stage | Current position | Remaining acceptance/work |
|---|---|---|
| 0 Profiling | 0.1–0.7 implemented; repeatable fixtures and hardware captures | 0.8 live dense-city cold/warm walk/drive matrix and hardware repeatability |
| 1 Streaming | Budgeted assembly, bounded queues, cancellation, copy/query improvements; desktop soak passed | Physical low-core/KTX2 contention, mobile assembly and input latency |
| 2 Materials | 2.1–2.6 comparisons/audits complete; losing experiments rejected | Real-city/mobile visuals and new cleanup issues below |
| 3 Assets | 3.1–3.8 implemented; compressed maps and optimized props | Offline/failure browser checks, lower-memory/mobile residency and far mip seams |
| 4 Roads/lights | 4.1, 4.2 and desktop 4.4 complete | Wetness, bloom/contact shading, shadows and facade variation |
| 5 Detail/weather | Planned | LOD, spatial instances, vegetation and analytic precipitation |
| 6–8 Alternatives | Conditional, deferred | Only prototype Rust/Wasm, SIMD or prebuilt cells after their measured prerequisite passes |
| 9 Integration | Open | Full regression, hardware/visual acceptance and release records |

Latest validation: all 138 tests across 21 files and the production build pass,
including the current roughness draft, resource cleanup and atlas fallback checks.
This review inspected source and matching installed Three.js 0.170.0 code; it did
not rerun the device performance matrix or prove release readiness. Existing tests
do not cover the ownership failures below.

### Priority issues found in this review

R1–R4 have implementation changes and unit checks; their remaining device and
browser validation gates are listed below. R6's evidence labels are reconciled.
Preserve gameplay and fallbacks.

- [ ] **R1 — P1: Validate the road-specific environment intensity fix.**
  Previously [materials.js](lib/engine/materials.js) changed `material.envMapIntensity`
  without binding an explicit `envMap`; [env-map.js](lib/engine/env-map.js)
  supplied `scene.environment`. In the installed Three.js 0.170.0,
  `WebGLRenderer.js:2110–2113` replaces that uniform with
  `scene.environmentIntensity` for this combination. The claimed wet-road-only
  reflection boost therefore did not reach the shader; roughness, normals and
  diffuse darkening still worked. The explicit map now binds the current PMREM
  to existing and newly streamed roads with shared ownership. Validate matched clear/rain captures;
  compare GPU/frame cost before accepting. Retain explicit environment binding
  whenever relying on the road-specific intensity.
  Roads now explicitly bind the current PMREM texture, including newly streamed
  materials; the shared-resource list protects it during cell eviction. A unit
  check covers replacement and inheritance. A visible Chrome recorded-Rome
  night/rain smoke completed with a valid five-second window, 33.5 ms frame p95,
  22.31 ms GPU timer p95 and no reported errors. This single run is not a matched
  performance comparison; paired visual review and repeated performance
  comparisons remain open. A WebGL audit observed the expected 2.71 wet-road
  intensity among uploaded uniform values; see the [environment audit](benchmarks/results/stage4/environment-resource-audit.md).
  The local screenshot still shows
  a subtle road response, and the wet-map prototype was also active in this run.

- [ ] **R2 — P1: Validate PMREM output target ownership.**
  Previously [env-map.js](lib/engine/env-map.js) kept only
  `pmrem.fromEquirectangular(tex).texture` and disposed that texture on updates.
  The returned render target owns framebuffer/depth attachments; the installed
  renderer releases those through the render target's dispose event
  (`WebGLTextures.js:320–323,380+`). Repeated quantized time/weather updates
  bypassed that teardown. The whole output target is now disposed on replacement
  and shutdown, with scene references cleared safely. Verify repeated time/weather
  cycles on one renderer with framebuffer/renderbuffer accounting, since stable
  `renderer.info.memory.textures` alone cannot establish this.
  Implementation now retains and disposes each PMREM target, clears only its own
  scene reference, and preserves the previous environment if generation fails.
  The lifecycle unit check passes. A visible Intel UHD/WebGL2 audit recorded
  stable 19 framebuffer and 16 renderbuffer counts over six repeated day/night
  cycles; [details and limitations](benchmarks/results/stage4/environment-resource-audit.md).
  Real-GPU engine teardown and longer/device-specific checks remain open.

- [ ] **R3 — P2: Validate post-processing pass disposal.**
  Previously [post-fx.js](lib/engine/post-fx.js) called only `composer.dispose()`.
  Three.js 0.170.0's EffectComposer disposes its two buffers and copy pass, but
  does not dispose added SSAO, bloom or output passes. The owned passes are now
  disposed exactly once before releasing the composer. Check repeated
  engine entry/exit and their render-target/material cleanup; the existing
  quality-policy tests do not exercise teardown.
  The controller now disposes these passes once, including the SSAO material
  and noise texture omitted by Three.js 0.170's pass disposer. A lifecycle unit
  check covers repeated disposal; real-GPU entry/exit resource checks remain open.

- [ ] **R4 — P2: Validate the atlas-layout failure fallback in a browser.**
  Previously [ktx2-textures.js](lib/engine/ktx2-textures.js) parsed the layout
  after transcodes and outside the cleanup-protected callback block. Invalid JSON
  could bypass `disposeParsed()`. The loader now validates the layout before
  transcodes and guards payload construction. Verify malformed JSON and
  missing/invalid rectangle entries keep procedural/shared maps operational and
  release all successfully decoded textures once. Persistent GPU leakage on this
  path has not been measured; this is a confirmed explicit-cleanup gap.
  The loader now validates required atlas rectangles and dimensions before high
  transcodes, and guards all subsequent payload construction and installation.
  Unit checks cover invalid JSON/rectangles, shared fallback and disposal after an
  installation error. A visible Chrome run with service workers blocked injected
  invalid JSON, observed the fallback, retained shared maps and moved 4.09 m;
  [browser evidence](benchmarks/results/stage3/invalid-layout-browser-check.md).
  Cached asset/route offline responses are verified in Chrome; uncached offline
  failure handling and the schema-invalid rectangle browser case remain open.
  [Service-worker report](benchmarks/results/stage3/service-worker-offline-check.md).

- [ ] **R5 — P2, benchmark prototype: Wet-map transition and acceptance are unfinished.**
  [materials.js:204](lib/engine/materials.js) swaps roughness textures at
  `wetness >= 0.3`, creating a discontinuous pattern change. Review a gradual
  transition or justify the threshold with captures. The draft adds a shared
  64×64 texture in an existing sampler slot, but its first upload, residency,
  appearance and matched performance have not been measured. The material test
  checks map switching, not visual continuity or frame cost. It is now opt-in
  for benchmarks; the product uses the baseline map. A matched five-second
  smoke showed no clear road-specific visual gain; the sample is too short and
  host load varied, so it cannot establish performance. See the [smoke report](benchmarks/results/stage4/wet-road-map-smoke.md).
  Keep 4.3 open for further visual work.

### Evidence/documentation corrections

- [x] **R6 — P2: Reconcile hardware labels in the lighting reports.**
  The inactive-light report describes an i5-1035G1/Intel UHD machine but later
  called it UHD 630; the lifecycle note repeated that label despite host telemetry
  being disabled. All 18 retained lighting captures identify the same
  i5-1035G1/Intel(R) UHD Graphics host. The lifecycle capture identifies the
  WebGL adapter as Intel UHD Graphics (0x00008A56), but does not record its CPU.
  Reports now use only the captured names; no UHD 630 claim remains.
- Earlier baseline text claimed local main was 20 commits ahead and unpushed.
  That is superseded: `e90a47a` was verified on local and remote main before
  the current checkpoint.
- Historical schema-v3 notes are superseded by schema v4. Old results remain tied
  to their recorded revisions and schemas.
- Most recent raw lighting captures are local and untracked; committed decision
  reports summarize them. Keep a reproducible, sanitized evidence bundle before
  a final release claim. Missing raw files on another checkout do not mean a run
  has been repeated there.

## 2. Scope and current working draft

Keep Next.js/React, Cesium globe travel, Three.js street rendering and existing
editor/reconstruction behavior. [docs/PERFORMANCE-VISUALS-RESEARCH.md](docs/PERFORMANCE-VISUALS-RESEARCH.md)
holds research and alternatives. Superseded plans ([plan2.md](docs/archive/plan2.md),
[ROADMAP.md](docs/archive/ROADMAP.md), [the legacy roadmap](docs/PLAN-LEGACY-2026-10-27.md))
are historical.

The current wet-road roughness prototype is enabled only by the benchmark; the
product keeps the baseline map. A short paired
visual smoke did not show a clear gain. Full visual/performance acceptance has
not run; do not describe the candidate as an accepted optimization.

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

## 4. Stage 0 — Profiling and fixtures

- [x] 0.1–0.4 Versioned, bounded telemetry: fetch/parse/queue/pack/worker/assembly,
  frame percentiles, pass-inclusive renderer counters and asynchronous GPU timers.
  Schema v4 retains 4,096 events and reports wrapping/unavailable measurements.
- [x] 0.5–0.7 Attributed recorded OSM and synthetic density/geometry fixtures;
  seeded population, fixed pose/time/weather, visible hardware-browser controls,
  timestamped Windows telemetry, movement and boundary validation.
- [ ] 0.8 Finish matched production baselines:
  - Repeat hardware runs with foreground state, OS load and power state controlled.
  - Complete dense live-city cold/warm walking and driving boundary measurements.
    Manhattan retries returned HTTP 502/aborts and produced no valid baseline.
  - Keep recorded-city cache/boundary results separate from live Overpass latency.
  - Repeat resource/thermal soak on real mobile hardware; direct thermal readings
    were unavailable on the tested Windows desktop.

Retained results: four day/night × clear/rain conditions have five valid runs each,
with median frame p95 17.0–33.5 ms and tails into 33–34 ms. Five recorded cold/warm
walks had median spawn readiness 5.36/2.25 s after warm preflight; boundary walk/
drive runs retained 10/10 cells. These do not close the live or mobile gates.
See [four-condition results](benchmarks/results/stage0/),
[recorded cache/boundary report](benchmarks/results/stage0/recorded-city-cache-smoke.md)
and the archived checkpoint for excluded software-renderer runs.

## 5. Stage 1 — Scheduling and streaming

- [x] 1.1 Budget assembly; five-pair desktop comparison: median chunk p95 8.1 ms,
  paired readiness delta +3 ms. [Decision](benchmarks/results/stage1/assembly-budget-decision-2026-10-28.md).
- [x] 1.2 Bound geometry/cell queues, cancel obsolete jobs, fence stale workers,
  roll back objects/footprints/IDs. [Checkpoint](benchmarks/results/stage1/stream-lifecycle-checkpoint-2026-10-28.md).
- [ ] 1.3 Test one/two workers on physical low-core hardware with attributable
  process memory and KTX2 decoder contention. Five constrained-desktop pairs
  reduced queue delay without reliable readiness/frame benefit; retain two workers.
  [Comparison](benchmarks/results/stage1/geometry-worker-affinity-four-logical-five-pair.md).
- [x] 1.4 Remove measured defensive clones through read-only/copy-on-write data;
  road segment index reduced query plus index time by paired median 9 ms.
  Startup/frame p95 did not improve from clone removal.
  [Report](benchmarks/results/stage1/city-data-and-road-query-checkpoint-2026-10-28.md).
- [x] 1.5 Verify terrain revisit, repaint, material ownership, late imagery and
  stationary retry. [Lifecycle checks](benchmarks/results/stage1/stage1-lifecycle-verification-2026-10-28.md).
  [Desktop soak](benchmarks/results/stage1/resource-soak-2026-10-28.md):
  15 minutes, 4.48 km, 887 samples, settled 10/10 cells and stable counted resources.

Exit remains open for mobile assembly/input latency, physical low-core contention
and mobile thermal/resource checks. R2/R3 add ownership checks beyond the earlier
counted-resource soak; that soak is not proof that framebuffer cleanup is correct.

## 6. Stage 2 — Materials and shaders

- [x] 2.1–2.2 Census all tiers and normalize OSM material families.
  [Census](benchmarks/results/stage2/material-inventory-three-tier.md),
  [mapping](benchmarks/results/stage2/material-family-mapping-smoke.md).
- [x] 2.3 Family batching retained for the synthetic workload: mean draws -3.9%,
  unchanged frame p95, GPU ranges overlap.
  [A/B](benchmarks/results/stage2/material-family-batching-smoke.md).
- [x] 2.4 Audit sRGB color/emissive and linear normal/roughness/AO roles.
  [Audit](benchmarks/results/stage2/material-color-space-audit.md).
- [x] 2.5 Far-material prototype rejected after no frame/GPU benefit.
- [x] 2.6 Walk deformation shares uniforms across color/depth/distance passes;
  stable shader keys and production browser smoke verified.
  [2.5/2.6 report](benchmarks/results/stage2/rendering-follow-up-2026-10-28.md).

Earlier combined prop-cache/spatial batching was rejected: draws -43%, GPU p95
+32%, triangles +50%, frame p95 unchanged. [Evidence](benchmarks/results/stage2/prop-material-cache-ab.json).
Preserve visual/editor parity; real-city/mobile acceptance remains open.

## 7. Stage 3 — Assets and compressed textures

- [x] 3.1–3.3 Curated six ambientCG surfaces and four Kenney props; source/license/
  hash/scale metadata, normalized pivots and aligned atlases with 16px gutters.
  [Manifest](assets/manifest.json), [rebuild instructions](assets/README.md).
- [x] 3.4 Compared all nine maps with pinned KTX tools; ETC1S 3.1 MB versus
  UASTC 21.5 MB offline outputs. UASTC retained facade detail better.
  [Comparison](assets/processed/ktx2/comparison.md).
- [x] 3.5 Shared support-detected KTX2 loader, bounded decoders, procedural fallback
  and explicit transfer/combined-decode/upload-submit accounting.
  [Runtime smoke](benchmarks/results/stage3/ktx2-runtime-gpu-smoke.md).
- [x] 3.6 Shared 512×1024 maps with 11 mips; High adds four 1600×2096 maps.
  RTX 4060 smoke: shared transfer 194,691 bytes; High adds about 6.27 MB;
  estimated total compressed mip residency 19,287,520 bytes.
  [Near-atlas report](benchmarks/results/stage3/ktx2-near-atlas-gpu-smoke.md).
- [x] 3.7 Props use measured decoder-free prune/dedup/weld; Meshopt/Draco and
  simplification rejected. [Report](benchmarks/results/stage3/glb-optimization.md).
- [x] 3.8 Content-addressed maps/layout/decoders, revisioned service-worker cache,
  and deferred texture loading after input-ready.
  [Asset index](benchmarks/results/stage3/runtime-asset-index.md).

Exit remains open: R4 schema-error browser fallback and disposal validation,
uncached offline-miss recovery, lower-memory/mobile residency, and far mip seams
(gutters fall below one pixel after mip 4). A production browser check verified
offline service-worker responses for shared/high facade KTX2, the atlas layout,
the Basis WASM decoder, and the cached street route. Its local loopback server
remained reachable with Chromium offline mode enabled, so uncached network-failure
fallback remains unverified. Three.js exposes combined worker/WASM/transcode
timing and upload submission, not separate compile or GPU-upload completion.
Publication is separate release work.

## 8. Stage 4 — Roads, lighting and regional appearance

- [x] 4.1 Fixed reference poses and day/dusk/night/rain lighting controls.
- [x] 4.2 Refined existing road ribbons, markings, scale and terrain fit.
  [Review](benchmarks/results/stage4/road-ribbons.md).
- [ ] 4.3 Finish wet-road tuning and close-up acceptance. New materials inherit
  weather; procedural textures are seeded and diffuse darkening is reversible.
  Five clear/rain runs had frame-p95 medians 33.9/33.6 ms; a matched seeded pair
  had 33.5 ms for both. Captures still show little road-specific change.
  Complete R1 validation, then evaluate the benchmark wet-map draft/R5 with matched
  captures, first-upload/memory accounting and repeated frame/GPU measurements.
  [Current-code report](benchmarks/results/stage4/current-main-local-fallback-rome-night.md).
  Roughness/PMREM approximates wetness; SSR/planar reflection remains deferred.
- [x] 4.4 Desktop four-light pool, quality/time transitions and streamed/evicted
  markers verified. Five static runs per policy: hiding inactive lights reduced
  median GPU p95 13.18 → 10.68 ms, with overlapping ranges. Two transition pairs
  reproduced 2.72–2.87 s first-night stalls and +18 programs when hidden; visible
  lights stayed at 87 programs. Retain visible inactive lights.
  [Policy report](benchmarks/results/stage4/inactive-light-policy-checkpoint.md),
  [stream lifecycle](benchmarks/results/stage4/lamp-stream-lifecycle.md).
  Device labels are reconciled in R6; mobile portability remains open.
- [ ] 4.5 Finish bloom halo/daytime washout review and compare cheaper contact
  shading before changing High defaults. Quality/time pass states are corrected.
  Five same-tier runs: High SSAO+bloom median GPU p95 33.81 ms versus 15.65 ms
  bloom-only; ranges did not overlap. Matched views show subtle contact darkening.
  Keep defaults until close-up/mobile acceptance; validate R3 teardown.
  [SSAO report](benchmarks/results/stage4/postfx-ssao-checkpoint.md).
- [ ] 4.6 Retain quantized PMREM/shadow updates; validate R2 ownership. Measure
  small-object shadow pruning and contact approximations without losing important
  silhouettes. Do not regenerate environments every frame.
- [ ] 4.7 Improve facade/storefront variation and baked trim/dirt/reveals.
  Use geometry for near entrances, roofs and silhouettes; avoid default parallax,
  displacement or fragment noise. Triplanar needs a measured steep-slope use case.

Exit: approved visuals at matched DPR/population/view distance and measured tier
GPU budgets, including visible real-GPU night/bloom and mobile review.

## 9. Stage 5 — Spatial detail, vegetation and analytic weather

Section 0b takes priority. 5.1 overlaps C2 (HLOD); keep 5.2–5.5 as later work.

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

Superseded by section 0b B1 (prebuilt cell format). Kept for its design notes.

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

For real-city startup and boundary measurements, use a visible hardware-backed
Chrome session and skip the separate globe pass. Cold starts use a fresh browser
context; warm starts first load the origin cell and verify its IndexedDB entry.
The measured request summary covers browser-visible traffic only, not the
server's upstream Overpass requests:

    npm run bench -- --base-url http://127.0.0.1:3456 --data-mode live --cache-mode cold --browser-channel chrome --renderer-mode browser-default --headed --skip-globe --cross-cell --out benchmarks/results/stage0/live-cold-walk.json
    npm run bench -- --base-url http://127.0.0.1:3456 --data-mode live --cache-mode warm --browser-channel chrome --renderer-mode browser-default --headed --skip-globe --cross-cell --out benchmarks/results/stage0/live-warm-walk.json
    npm run bench -- --base-url http://127.0.0.1:3456 --data-mode live --cache-mode cold --browser-channel chrome --renderer-mode browser-default --headed --skip-globe --drive --cross-cell --out benchmarks/results/stage0/live-cold-drive.json
    npm run bench -- --base-url http://127.0.0.1:3456 --data-mode live --cache-mode warm --browser-channel chrome --renderer-mode browser-default --headed --skip-globe --drive --cross-cell --out benchmarks/results/stage0/live-warm-drive.json

If the upstream city API is unavailable, replay the recorded OSM city through
the normal browser city API and IndexedDB path to check client startup/cache
behavior. Replay uses the same recorded city body for requested cells, so it
does not measure live network latency or stand in for the live boundary matrix.
Use the Rome showcase fixture explicitly:

    npm run bench -- --base-url http://127.0.0.1:3456 --data-mode recorded --cache-mode cold --fixture benchmarks/fixtures/rome-showcase-osm.json --browser-channel chrome --renderer-mode browser-default --headed --skip-globe --cross-cell --out benchmarks/results/stage0/recorded-cold-walk.json
    npm run bench -- --base-url http://127.0.0.1:3456 --data-mode recorded --cache-mode warm --fixture benchmarks/fixtures/rome-showcase-osm.json --browser-channel chrome --renderer-mode browser-default --headed --skip-globe --cross-cell --out benchmarks/results/stage0/recorded-warm-walk.json

For a per-cell fixture that has at least one lamp in the origin and a later
cell, add `--stream-lifecycle` alongside `--cross-cell`. It checks the settled
origin count, the streamed marker count and removal after the source cell is
evicted. This lifecycle run is not a performance comparison:

    npm run bench -- --base-url http://127.0.0.1:3456 --data-mode recorded --cache-mode cold --fixture benchmarks/fixtures/rome-lamp-stream.json --browser-channel chrome --renderer-mode browser-default --headed --skip-globe --skip-host-telemetry --cross-cell --stream-lifecycle --walk-ms 1000 --hour 21 --weather 0 --out benchmarks/results/stage4/lamp-stream-lifecycle-v3.json

The default commands use a small fixture; they do not satisfy Stage 0's full
matrix. The runner accepts
`--hour` (0–24), `--weather` (0–100; precipitation starts at 85), `--pose-x`,
`--pose-z`, `--heading` and `--browser-channel chrome`. On Windows it records
one-second CPU, memory and GPU-engine samples plus power/battery/thermal
availability. For visible hardware measurements, start the production server
and run a fixed scenario with `--headed --browser-channel chrome
--renderer-mode browser-default`; verify the actual WebGL renderer in the saved
report. `--renderer-mode software` is integration-only and never hardware
performance evidence. Complete five repetitions per scenario; a short smoke
does not replace the full matrix.

For same-tier post-FX diagnostics, `--ssao-mode on|off` requires `--preset high`
and keeps bloom active while toggling only SSAO. Saved metadata and the run fail
if the requested pass state did not persist through the measurement.

Proposed evidence locations:

    benchmarks/fixtures/<city-or-stress-case>.json
    benchmarks/results/<stage>/<revision>-<device>-<scenario>.json
    benchmarks/results/<stage>/decision.md
    screenshots/performance-visuals/<stage>/<matched-pose>.png

Keep personal/large raw traces out of routine commits. Each decision describes
matched settings, tested hardware, thresholds and remaining gates.

## 15. Next action and deferred choices

1. Demo track D1–D8 is complete; rerun `npm run rehearse` after each deploy.
2. Section 0b: A1 and A2 first, then A3–A5, then B1 and B2.
3. Then the remaining R1–R4 browser and device checks.
4. Deprioritized: R5 and 4.3 wet-road tuning (captures show little visible
   gain), the 0.8 Manhattan live baseline, and the conditional Stage 6–8
   experiments. Revisit them only when a demo viewer would notice the result.

Rust/Wasm/SIMD remains deferred: an earlier synthetic trace measured worker
compute at 25.9 ms median versus 729.4 ms roundtrip. That trace does not establish
a geometry bottleneck or predict full application gains. WebGPU/TSL requires
migration of shader patches/post-processing. Wasm threads require an identified
use case and verified cross-origin isolation. SSR, volumetrics, displacement,
dense skeletal crowds and per-lamp shadow arrays need separate budgets.

Detailed historical runs, exclusions and earlier validation counts are in the
[archived checkpoint](docs/PLAN-CHECKPOINT-2026-10-28-BEFORE-REVIEW.md). Use the
current plan's open gates and the source-linked decision reports for next work.
