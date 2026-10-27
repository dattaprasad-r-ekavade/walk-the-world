# Performance and Visual Quality Plan

Research date: 27 October 2026. Status: research complete; implementation
progress is tracked in [plan.md](plan.md).

The implementation sequence is in [plan.md](plan.md), reconciled against fetched
branch `perf/demo-optimizations` at `39459c3`. Use it for work ordering and current
feature status; this document supplies research and design alternatives.

## 1. Outcome and recommended approach

Make streets more convincing while preserving responsiveness, startup speed,
and bounded memory on desktop and mobile. Keep Next.js/React for the application,
Cesium for globe travel, and Three.js for street rendering. Improve the existing
pipeline first; introduce Rust compiled to WebAssembly only where measurements
justify it. Add SIMD to suitable numeric kernels after a scalar Wasm comparison.

The priority order is measurement, batching and scheduling, coherent materials
and lighting, compressed assets and distance detail, then conditional Rust/SIMD.
Static prebuilt geometry is an alternative to runtime computation, not an
additional mandatory layer. WebGPU is a separate later experiment.

Better visuals are not automatically free. Every accepted upgrade must replace
existing cost, fit measured headroom, or stay optional on a higher quality tier.
Do not fund a visual improvement by silently reducing render resolution,
population, viewing distance, or input responsiveness in the comparison.

This document extends [plan.md](plan.md) and the visual/performance work in
[plan2.md](plan2.md); it does not mark those roadmaps complete. Existing budgets
in [PERFORMANCE-BUDGETS.md](PERFORMANCE-BUDGETS.md) remain the release targets.
Implementation authority and progress are tracked in [plan.md](plan.md).
Deployment, asset purchases, cache promotion and production-service changes
remain separate release work.

## 2. What the code already does

These are source observations, not new runtime benchmark results.

| Area | Current implementation | Consequence for this plan |
|---|---|---|
| Geometry | `city-builder-core.js` creates Three.js extrusions per building, slices caps/walls, remaps UVs, colours vertices, then merges by colour/material | Test fewer allocations and direct buffer generation before or alongside Rust |
| Worker boundary | `city-builder.js` owns two reusable workers; geometry outputs transfer buffers; input OSM objects are cloned and terrain heights copied | Keep this boundary; measure packing, cloning and copying separately |
| Main-thread assembly | `street/assemble-city.js` reconstructs meshes, paints ground canvases, creates props and other structures, and yields between sections | Faster workers alone cannot eliminate assembly, canvas or GPU-upload hitches |
| Facades | Shared 512 × 1024 procedural facade/emissive atlases, small normal/roughness textures, cached PBR materials | Improve a shared material library rather than give each building unique textures |
| Batching | Building buckets include exact base colour and raw material tag; materials cache on these keys | Count material fragmentation; investigate family-level batching with vertex tint |
| Lighting | Explicit sun-shadow refresh, quantized PMREM updates, SSAO/bloom, and four pooled real streetlights created on high tier | Preserve these savings; verify pool lifecycle/quality transitions and remaining pass costs |
| Post-processing | `UnrealBloomPass` runs on scene brightness; high enables SSAO; medium can enable night bloom | Current bloom is not an explicit emissive-only selective-bloom pipeline |
| Population | Instanced pedestrians/cars/birds; limits 140/70/36; terrain cache; medium/low updates at 30/20 Hz | A population rewrite is conditional, not the first step |
| Animation | Pedestrian limb movement already uses a vertex shader | Extend this pattern only where it saves CPU without excessive GPU work |
| Collision | Footprint bounding boxes and a 60 m spatial hash grid | Preserve indexed queries; avoid replacing cheap single queries with costly Wasm crossings |
| Terrain | 65 × 65 height grids, streamed imagery, road/contact-shadow canvas painting | Optimise local work separately from remote imagery latency |
| Quality | GPU hints and FPS feedback select tiers, DPR caps and effect settings | Freeze quality during benchmarks; preserve manual overrides |

Relevant files: `components/StreetEngine.js`, `lib/engine/city-builder*.js`,
`lib/engine/materials.js`, `facade-uv.js`, `env-map.js`, `post-fx.js`,
`population.js`, `ped-walk.js`, and `lib/engine/street/`.

The historical benchmark uses SwiftShader and mixed development/production
runs. It cannot establish today's GPU bottleneck or predict a Rust speedup.
Some older roadmap prose also predates current road decals, streaming and night
bloom: current code and fresh captures take precedence over those descriptions.

## 3. Measurement contract and decision gates

### 3.1 Repeatable test matrix

- Build production once per candidate. Record commit, dependency versions,
  browser/OS, actual renderer/GPU, viewport, DPR, preset, weather, time, seed,
  population, asset revision and cache source. Separate local from deployed runs.
- Use representative recorded cells for Pune, Edinburgh, Tokyo and New York,
  plus a sparse area, dense footprint stress case and difficult polygons.
  The existing minimal Rome fixture remains a smoke test, not a capacity test.
- Keep benchmark data local and deterministic. Measure real network loading in
  separate scenarios; never let variable Overpass responses decide a CPU result.
- For each candidate run at least five measured repetitions after a warm-up;
  alternate baseline/candidate order. Report median and spread, not the best run.
- Cover warm walking, cold entry, neighbour crossings, driving, day, night,
  rain, editor changes and a 15-minute walk. Repeat a mobile thermal run after
  sustained use. Test an integrated GPU, a mid-tier desktop GPU and real mobile
  hardware; record unavailable hardware as an open gate.
- Lock quality while comparing. Test adaptive quality separately, including
  recovery, hysteresis and manual overrides. Software rendering tests correctness
  only and must be labelled as such.

### 3.2 Instrument the whole critical path

Collect fetch/cache time, JSON parsing, filtering/clipping, worker queue delay,
input packing, worker computation, output copying/transfer, scene assembly,
canvas painting, texture upload and first visible building. Measure first
terrain, input-ready time and streaming-complete separately.

Collect frame-time p50/p95/p99, frames over 50/100 ms, 1% low FPS with an explicit
calculation, population/collision/spawn CPU time, GC/long tasks, draw calls,
triangles, shader programs, resident cells and estimated asset memory. Keep a
bounded telemetry buffer; instrumentation must not become the bottleneck.

Use asynchronous GPU timer queries where available; ignore disjoint samples,
never block waiting for a result, and report unavailable timing as unavailable.
Time spent around `renderer.render()` is CPU submission time, not GPU time.
[Khronos timer-query specification](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/).

Count every pass in a frame: `renderer.info` normally resets each render call;
aggregate explicitly for post-processing. It provides object/resource counters,
not a portable VRAM-byte meter. [Three.js renderer documentation](https://threejs.org/docs/pages/WebGLRenderer.html).

### 3.3 Targets and acceptance policy

| Metric | Existing target / proposed experiment gate |
|---|---|
| Desktop | 60 FPS target; p95 frame time below 16.7 ms |
| Mobile low tier | 30 FPS minimum; p95 below 33.3 ms |
| Warm street input-ready | Desktop under 4 s; low mobile under 6 s |
| Streaming main-thread stall | Desktop under 100 ms; low mobile under 150 ms; aim to schedule individual chunks below 8/12 ms |
| Memory | Bounded during 15-minute walk; stable resident resources after repeated cell eviction |
| Visual-only change | No repeatable regression above 3% in p95 frame time or 5% in input-ready time; no new >100/150 ms stalls |
| Rust adoption | At least 25% lower full geometry-stage time on representative dense cells, including conversion/copies, plus a visible loading/stutter benefit |
| SIMD adoption | At least 10% additional geometry-stage saving over scalar Wasm on target hardware; kernel-only wins are insufficient |

The 3/5/25/10% gates are proposed engineering criteria, not measured results.
Recalibrate measurement noise before accepting them. A baseline already outside
the release budget remains a failure even if a candidate is faster. A visual
upgrade that misses a tier's budget stays disabled there. Record any deliberate
budget change explicitly; do not call it performance-neutral.

For each stage save a result JSON, comparable screenshot set and short decision
record with baseline, candidate, limitations, verdict and rollback mechanism.

## 4. Improve the current pipeline first

### 4.1 Scheduling and allocation

- Profile assembly sections rather than assume all geometry cost is in workers.
  Add a time-budgeted queue for mesh creation, canvas painting and first uploads.
  Prioritise the visible centre cell; avoid two finished neighbours uploading
  everything in the same frame.
- Reuse scratch arrays/objects where measured allocation is high. Prototype direct
  typed-array wall generation for simple rings in JavaScript as a control for
  Rust; changing the algorithm may matter more than changing language.
- Treat spatial indexes for nearest-road/POI work as candidates if those scans
  dominate. Preserve the existing collision grid and terrain caches.
- Start with current two workers; compare one versus two on low-core devices.
  Account for KTX2 decoder workers as well. More workers can worsen contention
  and memory, particularly while the main thread is uploading assets.
- Bound queues, cancel obsolete jobs and preserve cell rollback/retry semantics.

### 4.2 Reduce material fragmentation without losing identity

Measure buckets per cell and material/program counts across ten resident cells.
Normalise raw OSM materials to a small family list such as plaster, brick, stone,
concrete and metal. Move base tint into linear-space vertex colours where safe;
retain AO and existing tint jitter without multiplying the colour twice.

Keep genuinely different maps/shader features separate. Merge within spatial
chunks rather than one giant city mesh, so frustum culling remains useful.
Retain feature IDs and footprint metadata for editor selection. Compare saved
draw submission cost with any extra attribute bandwidth and chunk overhead.

Repeated props should stay instanced, grouped by material and spatial area.
Instancing reduces draw calls but still processes visible geometry; oversized
instance bounds can defeat useful culling. [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html).

## 5. Visual strategy: coherent streets at a fixed frame budget

Art direction: recognisable real geography with a consistent stylised PBR look.
Prioritise silhouette, real-world material scale, street-level readability,
colour balance and controlled lighting over maximum texture resolution.
Do not use darkness or fog to conceal broken geography or missing collisions.

### 5.1 Materials, facades and shaders

1. Audit colour handling: base/emissive colour textures use sRGB; normal,
   roughness, metallic and AO data use no colour-space conversion. Verify one
   output conversion/tone-mapping path in direct and post-processed modes.
   [Three.js colour-management guide](https://threejs.org/manual/pages/color-management.html).
2. Create 4–6 shared facade/trim families with deterministic building-ID
   variation, aligned day/night windows and region-informed palettes. Reuse
   the current atlas and UV work; variation should not create a material per
   building or a shader program per colour.
3. Bake window reveals, shallow trim and static dirt into atlases. Reserve real
   geometry for entrances, roofs and silhouettes that matter at walking distance.
   Bake subtle static occlusion; avoid baking directional sunlight into albedo.
4. Keep PBR for nearby roads, metal and glass; test simpler distant/low-tier
   materials. Compare actual shaders, not material names. The standard PBR
   material is more expensive than Lambert/Phong and benefits from environment
   lighting. [MeshStandardMaterial](https://threejs.org/docs/pages/MeshStandardMaterial.html).
5. Pack AO/roughness/metallic into a shared ORM asset where coordinates match.
   Stock materials may still sample the same texture separately for each map;
   fewer files do not prove fewer samples. A one-sample custom path is a separate
   measured experiment. Confirm AO UV compatibility with installed Three.js.
6. Prefer baked noise over expensive multi-octave fragment noise. Avoid default
   parallax mapping, displacement, subsurface effects and multi-layer glass.
   Test a cheap window reflection approximation before any interior-mapping shader.
7. On the current WebGL renderer, use bounded `onBeforeCompile` extensions only
   when needed, with stable program cache keys and pinned shader-chunk tests.
   Share uniforms; never trigger recompilation for each time/weather update.

### 5.2 Roads, ground and terrain

- Keep map imagery as a base; use the existing terrain-conforming road ribbons
  for road material response. Inspect current coverage before proposing another
  overlapping road layer. Eliminate z-fighting and duplicated drawing.
- Improve asphalt/sidewalk texture scale, roughness and lane edges with a small
  shared library. Bake markings into atlas/cell data where practical; constrain
  additional decals and fade tiny details by projected size.
- Refine existing `setRoadWetness` roughness/environment controls; add colour
  adjustment only if useful. It is an approximation; environment response does not reproduce
  local streetlight reflections. Defer screen-space reflections and planar mirrors.
- Test simple UV-based terrain blends first. Full triplanar sampling repeats
  texture work across axes; use it only on visible steep slopes if measured.
- Avoid regenerating large ground textures every frame. Investigate worker
  canvas rasterisation only if painting dominates, with feature checks and a
  main-thread fallback; do not bundle an OffscreenCanvas renderer migration.

### 5.3 Lighting, night and atmosphere

- Tune exposure, sun/sky balance, fog and material roughness using existing
  directional and environment lighting. Reuse quantized PMREM updates; do not
  regenerate environment convolution every frame.
- Keep selective shadow refresh. Test which static objects genuinely need to
  cast; small clutter can use baked/contact shading. Do not remove essential
  sun shadows from the comparison without reporting the quality tradeoff.
- Keep lamp heads/windows emissive, with pooled ground illumination. If needed,
  refine the existing four-light high-tier pool; never create a shadow-casting
  point light for every streetlamp. Ground pools are an approximation, not true
  physical local lighting.
- Tune existing half-resolution bloom before adding selective bloom. A separate
  selective pipeline may require extra rendering. Test actual bright-window,
  lamp, headlight and sky captures; bright daytime surfaces must not wash out.
- Compare high-tier SSAO against baked/vertex AO plus contact shading. Disable or
  lower the pass only through explicit tier rules. Watch screen-edge halos.
- Preserve night visibility, road markings and colour detail. Use distance fog
  to unify streamed geometry, not replace a reasonable visible horizon.

### 5.4 Population, vegetation and weather

- Curate low-poly prop silhouettes; atlas and instance them. Test vegetation
  cutouts versus geometry-based canopies on mobile: alpha cutouts still incur
  overdraw, especially when layered. Avoid dense transparent foliage sheets.
- Extend existing vertex animation for gentle tree sway/bird motion if useful.
  Match deformed normals, bounds and shadow-depth materials; animated visible
  meshes with static shadows are a regression. Alpha-to-coverage requires MSAA;
  it is not a universal low-tier fix. [Three.js material options](https://threejs.org/docs/pages/Material.html).
- Prototype analytic precipitation in the vertex shader using particle seed,
  initial position, time and wrap height. This can replace CPU position writes,
  but still pays particle rendering/overdraw. Preserve pause/time continuity,
  player-relative movement and bounded culling volumes.
- Preserve deterministic simulation and responsive driven vehicles. A worker or
  Wasm population experiment needs batched state and interpolation; do not add a
  synchronous round trip for each agent or collision query.

## 6. Where assets come from and how they reach the browser

### 6.1 Source shortlist

| Source | Intended use | Procurement decision |
|---|---|---|
| [Poly Haven](https://polyhaven.com/license) | Tileable plaster/stone/asphalt, selected environment references | Asset library is CC0; curate and downscale rather than download everything |
| [ambientCG](https://docs.ambientcg.com/license/) | Concrete, paving, roof and surface maps | CC0 assets; select a consistent scale and palette |
| [Kenney](https://kenney.nl/support) | Simple street furniture and low-poly props | Asset-page game assets are CC0; retain individual asset/license records |
| [Quaternius](https://quaternius.com/faq.html) | Low-poly vegetation, people and vehicles | FAQ identifies models as CC0; inspect each chosen pack's materials/rigs |
| Existing procedural generators | Facades, lane markings, emissive masks | Keep as deterministic, immediate fallback; bake selected outputs offline |
| Small authored kit | Regional trim, distinctive landmarks, road junction fixes | Make only the few models that materially improve a showcase route |

Asset licenses do not replace map/imagery/data attribution obligations. Preserve
existing credits. Do not hotlink asset-library downloads at runtime or assume
site/API access terms equal the asset license. No assets are downloaded by this plan.

### 6.2 Offline asset pipeline

1. Record source URL, author, license, downloaded version/hash, intended size in
   metres, texture colour-space roles and approved city/family in an asset manifest.
2. Normalise scale, +Z forward orientation and pivots. Prune hidden geometry,
   unused materials and oversized textures; create explicit near/mid/far models.
3. Build trim/facade atlases with mip-safe gutters and appropriate wrap behaviour.
   Test distant mip levels for tile bleed, seams and window-mask alignment.
4. Encode static textures as KTX2/Basis Universal with offline tools. Compare
   ETC1S for suitable colour maps against UASTC for normal maps or fine masks;
   choose by actual artefacts, transfer bytes, transcode time and device format.
   KTX tooling: [Khronos KTX-Software](https://github.com/KhronosGroup/KTX-Software).
5. Configure `KTX2Loader.detectSupport(renderer)` before loading. Self-host
   compatible decoder files, reuse one bounded loader and dispose it on teardown.
   The loader transcodes to a supported GPU format and uses a Wasm transcoder:
   this is a practical Wasm use without rewriting engine code.
   [Three.js KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html).
6. Use [glTF Transform](https://gltf-transform.dev/cli) to inspect, prune, deduplicate,
   resize and simplify selected GLBs. Compare Meshopt/Draco only for sufficiently
   large assets, including decoder bytes and first-use delay. Ensure the existing
   model-merging loader retains expected instancing/material behaviour.
7. Publish only derived, versioned assets during a separately authorised release.
   Keep source masters outside the runtime payload. Content-hash names allow
   immutable caching; update the service-worker strategy to avoid mixed revisions.
8. Keep procedural/fallback materials visible immediately; load shared materials
   once, then stream optional near detail. Failed decoders must not block walking.

PNG/JPEG/WebP download compression does not itself keep GPU textures compressed.
For illustration, uncompressed 1024² RGBA8 is 4 MiB before mipmaps, roughly
5.33 MiB with a full mip chain; a 4K version uses sixteen times that base memory.
KTX2 savings depend on the selected device format, channels and fallback path.
Use an asset inventory to estimate bytes; there is no portable exact browser VRAM
counter. Validate compression on target devices rather than assume a fixed ratio.

Initial experiments: 512–1024 px shared families for low/medium and a small number
of 2048 px near-detail atlases on high. These are starting caps, not permission
to increase every texture. Audit actual projected texel density and use mipmaps.

## 7. Distance detail and quality policy

Start with projected-size thresholds, then calibrate approximate distances:

| Tier of visible content | Starting range | Work retained |
|---|---|---|
| Near | 0–50 m | Full facade maps, selected entrances/props, essential shadows |
| Mid | 50–150 m | Simplified facades/props, reduced normal detail and animation |
| Far | Beyond 150 m within existing view | Building massing, palette and essential landmarks |

Use hysteresis and bounded updates; avoid sorting every object every frame.
Keep collision independent from visual LOD, including in drive/editor modes.
Preserve chunk boundaries and shared resources during eviction. Inspect popping
and city silhouettes. Do not use alpha crossfades by default: rendering both
LODs can increase cost precisely during transitions.

Quality presets should describe features, not only an opaque quality label:

| Feature | Low | Medium | High |
|---|---|---|---|
| Facades | Shared colour/emissive and simple shading | Selected PBR families | Near normal detail within budget |
| Shadows | Existing low baseline or cheap contact approximation | Limited sun shadows | Higher resolution only if GPU headroom permits |
| Post FX | None by default | Budgeted night bloom | Bloom and optional measured AO |
| Props | Essential silhouettes | Moderate distance density | Near decorative detail |
| Simulation | Existing 20 Hz population | Existing 30 Hz population | Profile before increasing update rate |

Keep current defaults until candidates pass; this is a proposed policy. Adapt
resolution and effect cost independently, gradually, with hysteresis. Hardware
names are initial hints, not proof of sustained performance. Preserve manual
quality selection and test mobile thermal behaviour.

## 8. Rust and WebAssembly experiment

### 8.1 Scope and interface

Implement a small pure geometry crate, tentatively `rust/city-geometry/`, compiled
for `wasm32-unknown-unknown` and loaded inside the existing worker. Browser I/O,
scene mutation, texture creation and Three.js stay in JavaScript. The Rust target
does not supply ordinary OS/thread facilities; do not assume native Rust threading
works in the browser. [Rust target documentation](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html).

Start with simple building walls, caps, normals, UVs and colour attributes. Flatten
coordinates into numeric arrays plus ring offsets/heights/style IDs; preserve
feature IDs in accompanying metadata. Use Float64 for geographic conversion where
needed and Float32 for local metre geometry. Explicitly define units, axes,
winding, ring closure, height rules and cap/wall separation.

The builder currently handles imperfect OSM shapes. Test repeated points,
degenerate/self-intersecting rings, concavity, negative coordinates and steep
terrain. Define support for holes/multipolygons explicitly; do not claim newly
correct topology from a speed rewrite. Unsupported features should use the existing
JS path with a count/reason, not disappear silently.

Compare four variants: current JS, improved direct-buffer JS, scalar Wasm and
SIMD Wasm. Keep inputs/output semantics and geometry fidelity matched. Separate
algorithmic savings from language savings. Add roads and roofs only after the
building experiment passes.

### 8.2 Memory, packaging and failure behaviour

- Use a few coarse calls per cell. Include all input packing and output conversion
  in the result; do not benchmark only the inner Rust loop.
- Reuse bounded Wasm allocations. Copy final outputs into transferable buffers
  before posting to the main thread; ordinary Wasm linear memory is not a
  drop-in detachable transfer buffer. Measure the copy, and release Rust outputs.
- Recreate JS views after memory growth; old views over non-shared memory can be
  detached. Do not retain views across allocations without a documented lifetime.
  [WebAssembly memory growth](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow).
- Keep cancellation, timeouts and worker recreation. Cancellation during a long
  synchronous Wasm call may require terminating the worker; promises alone do not
  preempt it. Limit cell complexity and handle allocation failures/panics.
- Load the module once per worker; measure cold fetch/compile/startup and two-worker
  memory separately. Use versioned artifacts, MIME `application/wasm`, compatible
  fallback loading and the existing Next.js production build path.
- Provide a JS fallback and internal backend selector. Fail closed to the working
  builder if Wasm loading/validation fails. Preserve late-result rejection and
  transactional cell assembly; avoid mixing results from outdated jobs.
- Pin Rust, bindings and optimisation tools. Record artifact hash, transfer size
  and toolchain in results. Avoid adding Rust to the server path unnecessarily.

Adopt Rust only if the end-to-end gate in section 3 passes. A faster worker with
unchanged perceived load, worse startup, or excessive memory is not an adoption win.

### 8.3 SIMD after scalar parity

Candidate kernels: packed vertex transforms, height/colour calculations, bounds,
normal accumulation where dependencies permit, and batched terrain sampling.
Polygon triangulation and branch-heavy tag parsing are weaker first candidates.

Build separate scalar-compatible and SIMD variants; validate feature availability
before selecting a SIMD binary. Explicitly control target features rather than
assume a compiler's changing defaults provide the desired browser baseline.
Use `simd128` where supported; do not require relaxed SIMD or shared memory.
Reference: [Rust Wasm intrinsics](https://doc.rust-lang.org/core/arch/wasm32/).

Handle tail elements, alignment assumptions, floating-point tolerances and output
determinism. Compare Chrome, Firefox and Safari where available, including ARM
mobile. SIMD is CPU vector work, not GPU shading and not an automatic fourfold
application speedup. Keep scalar/JS fallbacks if the incremental gate fails.

## 9. Alternative: avoid rebuilding showcase geometry

If repeated runtime geometry dominates, prototype prebuilt immutable cell blobs
for curated, already cached cities. This can remove more runtime work than a
faster builder, but adds payload, cache and editor complexity.

Define separate raw-data and derived-geometry revisions. Derived keys must include
builder version, relevant source hash, style/atlas schema, terrain revision and
editor changes. The current runtime uses a local frame: store cell-local geometry
with a transform, rather than bake one player's origin into globally reused data.

Retain raw feature metadata for picking and edits. Rebuild affected cells after
terrain/tag/hidden changes. Keep dynamic effects out of static blobs. Compare
compressed download plus decode/upload against current raw-data download plus
build. Never overwrite raw R2 cell JSON with an incompatible binary payload.
Use runtime JS/Wasm for unseen or edited areas. Initial experiments remain local;
R2 publishing and schema promotion require a release task.

## 10. Deferred options and reasons

| Option | Revisit only when |
|---|---|
| Whole engine rewrite in Rust | Product requirements justify a different engine/platform, beyond this performance task |
| Wasm threads / SharedArrayBuffer | A measured parallel kernel beats the current worker design and cross-origin isolation is verified for Cesium, imagery and model dependencies |
| WebGPU/TSL | WebGL work is measured and a separate prototype demonstrates end-to-end gain on target devices |
| Dense skeletal crowds / VAT | Current population is insufficient and a bounded near/far animation experiment passes |
| SSR, volumetrics, global illumination, shadowed lamp arrays | Explicit high-tier budget and real-device evidence support their cost |
| Universal 4K assets / displacement | A specific near-view requirement justifies memory, bandwidth and geometry cost |

WebGPU is not a renderer-name substitution: current custom shaders and
EffectComposer passes need migration work. Current Three.js documentation
describes node materials and a different post-processing stack.
[WebGPURenderer migration overview](https://threejs.org/manual/pages/webgpurenderer).
This project declares Three.js `^0.170.0`; research describes current APIs.
Confirm the installed/locked revision and inspect matching source before using
any API. Keep dependency upgrades separate from performance experiments.

## 11. Bounded implementation stages

All items are unchecked. Effort is relative (S: small, M: moderate, L: substantial),
not a delivery-date promise. Each stage ends in reviewable evidence and a decision.

| Stage | Tasks / likely files | Exit evidence | Dependency / effort |
|---|---|---|---|
| A | Instrument timings and frame counters in `lib/perf.js`, worker helper, assembly and benchmark scripts | Repeatable production baselines, dense fixtures, actual GPU and quality metadata | First; M |
| B | Profile allocations, queue priorities and assembly chunks; compare worker counts | Lower measured stalls; cancellation/retry/eviction still pass | A; M |
| C | Audit tint/material buckets, normalise families, prototype vertex-colour batching | Material/draw-call comparison, editor picking parity, day/night screenshots | A; M |
| D | Build one shared facade/road asset set, manifest, KTX2 loader and procedural fallback | Texture bytes, transcode/upload times, visual compression QA and failed-decoder recovery | A; M |
| E | Tune existing light/environment/bloom/AO; calibrate regional palettes and road scale | Matched visual review at fixed resolution and effects cost | C–D; M |
| F | Add spatial LOD, bounded decorative props and optional analytic weather | No popping/collision regressions; GPU and thermal gates pass | B–E; L |
| G | Compare improved JS geometry with scalar Rust/Wasm for buildings | Output parity, full-stage timing, startup and memory adoption decision | A–B; L |
| H | SIMD kernels and backend detection/fallback | Incremental end-to-end win across target devices | G passes; M |
| I | Evaluate prebuilt cell prototype if still warranted | Correct local frames/invalidation, payload-versus-build comparison | A/G evidence; L, optional |
| J | Consolidate accepted features, remove losing experiments from default paths | 15-minute runs, mobile review, production build/tests and rollback instructions | Accepted prior stages; M |

Run G after A/B if profiling shows geometry is the main problem; run C–F first
if GPU/material cost dominates. D can be evaluated independently once A exists.
Do not implement every option just because it appears in this plan.

### Required checks for relevant stages

- Existing unit suite and production build after implementation changes.
- Geometry: bounds, winding, cap coverage, UV alignment, finite attributes,
  index validity, terrain placement and retained feature IDs. Byte-identical
  triangle order is not required when surface equivalence is proven.
- Lifecycle: leave during fetch/build/transcode, abort active/queued work, inject
  worker/decoder failures, retry cells, evict and reload, then inspect resource counts.
- Editor: picking, hiding, tag overrides and terrain patch invalidation across
  backend/LOD changes. Vehicle and pedestrian collision remains independent of LOD.
- Visual: fixed poses for near/mid/far, sunlit/shaded, day/dusk/night/rain;
  inspect mip shimmer, atlas bleed, normals, shadows, seams and washed-out bloom.
- Compatibility: JS fallback, scalar-only Wasm, unavailable GPU timers, decoder
  failure, context loss/recovery where supported and slower/offline cache paths.
- Real hardware: input/control feel, mobile thermal stability and human visual
  acceptance. Headless screenshots and unit tests cannot close these gates.

## 12. First concrete checkpoint and final definition of done

The first implementation checkpoint is **A only**: trustworthy production
profiling and representative fixtures, with a bottleneck report ranking CPU,
GPU, network and memory costs. It should identify whether the next bounded task
is scheduling, batching/materials or geometry. No rewrite is assumed in advance.

The overall initiative is complete when accepted improvements show clearer,
more coherent streets in matched captures, meet the applicable performance
budgets on recorded hardware, preserve streaming/editor behaviour and have a
working fallback. Publish actual results and open hardware/release gates in
`PERFORMANCE-BUDGETS.md` and the release checklist. A completed plan, passing
build or fast microbenchmark alone does not establish that outcome.

## 13. Research index

Sources accessed 27 October 2026; recommendations and thresholds above are project
design decisions, not promises made by these sources.

- [WebGL best practices — MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices): additional guidance for batching, compressed textures, mipmaps and non-blocking GPU work.
- [WebGL GPU timer queries — Khronos](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/).
- [Three.js renderer](https://threejs.org/docs/pages/WebGLRenderer.html), [instancing](https://threejs.org/docs/pages/InstancedMesh.html), [materials](https://threejs.org/docs/pages/Material.html), [PBR](https://threejs.org/docs/pages/MeshStandardMaterial.html), [colour management](https://threejs.org/manual/pages/color-management.html), [KTX2](https://threejs.org/docs/pages/KTX2Loader.html), [WebGPU migration](https://threejs.org/manual/pages/webgpurenderer).
- [KTX offline tooling — Khronos](https://github.com/KhronosGroup/KTX-Software); [glTF Transform CLI](https://gltf-transform.dev/cli).
- [Rust Wasm target](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html), [Wasm SIMD intrinsics](https://doc.rust-lang.org/core/arch/wasm32/), [Wasm memory growth — MDN](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow).
- [Poly Haven license](https://polyhaven.com/license), [ambientCG license](https://docs.ambientcg.com/license/), [Kenney support/license](https://kenney.nl/support), [Quaternius FAQ/license](https://quaternius.com/faq.html).
