# Walk the World — Performance and Visuals Implementation Plan

Updated: 28 October 2026. Status: Stage 0 instrumentation, synthetic fixtures,
an attributed/sanitized real-city fixture, and bounded cell streaming are
implemented. A controlled five-run-per-build prop-batching A/B is complete; the
candidate was rejected because GPU p95 and triangle submission increased while
frame p95 did not improve. Family batching reduced mean draws by 3.9% at
unchanged frame p95 on the synthetic fixture. The separate five-run far-material
comparison showed no frame/GPU benefit and its prototype was reverted. The
pedestrian walk shader now deforms its color and shadow passes from shared
uniforms; a production build and recorded-city browser smoke passed. Real-city
and mobile acceptance remain open. The performance timeline now uses schema v4,
retains 4,096 bounded events and reports wrap state. A same-device interleaved
five-pair Rome A/B completed Stage 1.1's desktop implementation: spawn chunk
p95 was 8.1 ms median and paired spawn readiness differed by 3 ms. Mobile,
input latency during assembly, low-core/KTX2 contention, and live-city acceptance
remain open. A 15-minute recorded Rome desktop walk now passes resource-sample,
movement, and cell-stream checks on an RTX 4060 laptop; thermal readings were
unavailable. Deterministic
time/weather scenarios,
time-aligned Windows host telemetry and capture-validity checks are implemented.
Five visible-Chrome Intel UHD repetitions are recorded for each of day/clear,
night/clear, day/rain and night/rain. These short synthetic runs are diagnostic,
not release acceptance; cold/warm starts, real-city stress, dynamic cell
crossing, mobile, long-walk thermal and release gates remain open. Work is
consolidated on `main`.

## 1. Verified baseline and scope

Fetched origin on 27 October 2026; at that fetch, `origin/main` was
`adf6d073a56f1dd8e2937aeb9147e4fc4645eca0`. Both the performance/setup branch
and the Cursor setup branch are ancestors of local `main`. The redundant local
performance branch was removed after verifying its tip is in `main`; the
remote topic refs were retained. The fixture and profiling checkpoint is
commit `664b55f`; bounded cell streaming and boundary tests are commit `3235dd9`.
The consolidated implementation and evidence are maintained on `main`.
At the 28 October sync, `git pull --ff-only origin main` reported no incoming
changes; local `main` was eight commits ahead of `origin/main`.

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
  - [x] Raise the performance timeline from 2,000 to 4,096 entries, bump the
    schema to v3, and report sample count/capacity/wrap state so startup events
    remain available after a 12-second high-frame-rate capture.
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
  preset, renderer mode/channel, duration, seed, fixed time/weather and output.
  Fail nonzero on failed checks/console/asset errors. Document switches only
  after they exist.
  - [x] Add explicit `--pose-x`, `--pose-z` and `--heading` overrides so A/B
    runs can use the same local position and view direction.
  - [x] Wait for population initialization, hold population motion until the
    measured interval, and skip optional local Overture enrichment in synthetic
    fixture mode so build-only data cannot change the compared scene.
  - [x] Add `--hour` and `--weather` controls; apply them before city assembly
    and skip live-weather synchronization in fixture mode.
  - [x] Allow `--browser-channel chrome` with `--headed` to launch installed
    Chrome for visible hardware measurements; verify the reported WebGL renderer.
  - [x] Sample Windows system CPU, available memory, GPU-engine counters, power
    mode, battery power status and ACPI thermal-zone availability during the
    measured interval. Hostname, battery identity and GPU-process IDs are omitted.
  - [x] Use one continuous counter query, retain actual sample timestamps and
    intervals, and wait for its first sample before starting movement.
  - [x] Snapshot frame/GPU/renderer counters at key release; reject incomplete,
    saturated, hidden or unfocused windows. Record in-window host coverage and
    offer `--skip-host-telemetry` as a sampler-overhead control.
- [x] 0.7 Prove street movement via player displacement. The runner focuses the
  Street page and requires measurable displacement.
  - [x] Require displacement for walking and add a seeded driving run that
    enters a nearby traffic car through the normal control handler.
  - [x] Add deterministic walk and drive routes that cross a cell boundary and
    validate neighbor streaming and resource limits.
- [ ] 0.8 Capture matched production warm/cold/day/night/rain/crossing baselines
  and rank CPU, GPU, network and memory bottlenecks.
  - [x] Collect five 12-second warm, stationary, fixed-medium samples on Intel
    UHD 630; retain as a provisional repeatability check, not a release baseline.
  - [x] Collect five 12-second fixed-path moving samples in visible Chrome on
    Intel UHD 630 at medium/DPR 1.25; p95 repeats, but tail outliers remain.
  - [x] Smoke the fixed 21:00/weather-90 fixture after the deterministic
    controls landed. It applied night and rain, moved 1.00 m and recorded no
    browser/asset errors. The build selected SwiftShader, requested a 1-second
    interval but accumulated 32.3 seconds of frame intervals, and sampled 96.4%
    system CPU with 1,241 MB minimum available memory. Windows exposed no ACPI
    thermal zone. This validates scenario wiring only; exclude its frame timings.
  - [x] Capture five valid 12-second warm, fixed-pose medium night/rain runs on
    Intel UHD 630 in visible Chrome. Median frame p95 was 33.5 ms (range
    17.1–34.3 ms); median GPU timer p95 was 10.55 ms. Four newer runs confirmed
    focus and visibility; host-window coverage ranged from 83% to 92%, and all
    five host windows passed the validator.
    A single telemetry-free control recorded 33.5 ms frame p95. See the
    [five-run decision](benchmarks/results/stage0/night-rain-five-run-decision.md)
    and [compact JSON summary](benchmarks/results/stage0/night-rain-five-run-summary.json).
  - [x] Capture five matched 12-second visible-Chrome runs for all four
    day/night and clear/rain combinations on the same Intel UHD system. All 20
    frame windows and host windows passed validation; all pages stayed visible,
    no focus/visibility losses were recorded where event monitoring was active,
    and no browser/runtime/asset errors were reported. Medians are shown below;
    retain each range because intermittent 33 ms frame tails remain:

    | Condition | Frame p95 median (range) | GPU timer p95 median | Median FPS | Median host CPU | Median GPU 3D | Min free memory |
    |---|---:|---:|---:|---:|---:|---:|
    | Day / clear | 17.0 ms (16.8–33.4) | 8.98 ms | 58 | 44.12% | 69.29% | 1,805 MB |
    | Night / clear | 17.1 ms (17.1–33.3) | 10.15 ms | 59 | 40.58% | 81.93% | 2,239 MB |
    | Day / rain | 33.2 ms (16.9–33.8) | 8.14 ms | 56 | 48.37% | 67.86% | 2,758 MB |
    | Night / rain | 33.5 ms (17.1–34.3) | 10.55 ms | 50 | 64.51% | 72.72% | 1,747 MB |

    See the [four-condition summary](benchmarks/results/stage0/four-scenario-summary.json)
    and the [day-rain scene capture](benchmarks/results/stage0/main-local-day-rain-chrome-12s-rep1.png).
    Day-rain and night-rain show the weakest median frame p95 despite lower GPU
    timer p95, so this evidence does not identify a GPU shader as the sole cause.
    One laptop, synthetic content and 12-second windows do not establish a
    production-device performance guarantee.
  - [ ] Repeat after checking Chromium foreground state, OS load and integrated-
    GPU thermal/power conditions; control host load and alternate
    baseline/candidate runs for A/B. Foreground visibility is now checked, but
    host load still varied and Windows exposes no ACPI thermal reading.
  - [ ] Compare explicit cold and warm starts; test dense real-city content and
    walking/driving across cell boundaries with network and resource telemetry.
  - [x] Extend the runner with live city loading, cold browser contexts, and a
    verified warm IndexedDB preflight. Record browser-visible request counts,
    encoded response bytes, HTTP/transport failures, per-cell status codes, and
    latency percentiles by request family. This enables the remaining runs; the
    upstream server/CDN cache is not reset, and browser telemetry cannot see
    server-side Overpass traffic.
  - [x] Add recorded OSM replay through the browser's normal city API and
    IndexedDB path. Smoke cold, warm and cross-cell setup with the Rome showcase
    fixture; the [summary](benchmarks/results/stage0/recorded-city-cache-smoke.md)
    confirms the warm origin-cell request is skipped and the 10-cell bound holds.
  - [x] Capture five interleaved 12-second cold/warm recorded walks. Median
    spawn-cell readiness was 5.36 s cold and 2.25 s warm after a separate 5.43 s
    median preflight; frame p95 medians were both 14.1 ms. Warm city response
    sizes were unavailable, so traffic totals cannot be compared.
  - [x] Capture five 12-second recorded boundary walks and five drives. All ten
    reached the expected east neighbor, settled with no failed cells, validated
    host/frame windows, and retained 10/10 resident cells. The [run summary](benchmarks/results/stage0/recorded-city-cache-smoke.md)
    reports frame/GPU timings, system load, resources and browser-visible cell
    traffic. Replayed payloads remain client/streaming evidence, not live
    Overpass measurements.
  - [x] Raise renderer/GPU history capacity to 4,096 after a 12-second crossing
    reached 1,259 samples and hit the old 1,200-sample limit. Rebuilt and reran
    the crossing walk and drive successfully.
  - [x] Capture five current-main cold recorded Rome boundary walks with the
    v3 timing timeline. All windows validated, retained 10/10 cells, and kept
    2,626–2,657 timing events without wrapping. The 4,524-element spawn cell's
    assembly median was 2,612.7 ms (2,450.3–2,630.3); spawn geometry was 219.8 ms
    (205.6–235.7). Neighbor assembly was 38.8 ms median per cell. See the
    [profile report](benchmarks/results/stage1/assembly-profile-2026-10-28.md)
    and [five-run summary](benchmarks/results/stage1/recorded-rome-assembly-profile-five-run.json).
  - [x] Retry a cold live boundary walk in Manhattan on 28 October. The runner
    timed out after 180 seconds: the spawn cell had two `net::ERR_ABORTED`
    requests and one HTTP 502, the east neighbor did not complete, and no valid
    load/movement measurement was produced. This is an upstream/API failure,
    not baseline evidence. See the [raw result](benchmarks/results/stage0/main-727d46e-live-manhattan-cold-walk-smoke.json).
  - A first live cold smoke timed out while the local city API returned an
    upstream error, so it is not baseline evidence. A second live boundary retry
    recorded one `/api/city` 502, two transport failures and no measured cell;
    the recorded-fixture status smoke returned 12 cell keys with HTTP 200 and
    zero failures.
  - The default injected-fixture smoke confirmed request accounting but also
    hit the optional asset endpoint's expected 501 response; its four-second
    window is diagnostic only.
  - [x] Run a 15-minute recorded Rome desktop walk with resource sampling and
    cell streaming. The [soak report](benchmarks/results/stage1/resource-soak-2026-10-28.md)
    records 4.48 km of movement, 887 resource samples (98.6% coverage), a
    10/10 resident-cell bound, and stable geometry/texture/program counts after
    initial streaming. This closes the desktop resource-stability check only;
    the run exposed no ACPI thermal readings.
  - [ ] Repeat the resource/thermal soak on real mobile hardware before closing
    the hardware matrix.

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
seed are in place. Walking and driving require displacement, use the normal
controls, and now verify a real cell-boundary crossing and settled neighbor
stream. The fixture README distinguishes synthetic CC0 data from the old Rome
smoke fixture, whose provenance is unverified.

Validation on this checkpoint: `npm test -- --reporter=dot` passed (10 files,
91 tests); the earlier consolidated tree passed all 92 tests. Fresh validation
after benchmark hardening passed `npm test` (12 files, 99 tests) and
`npm run build`; `npm run start -- --port 3456` served `/street` locally with
HTTP 200. The app was
run locally from the production build. A separate visible Chromium run
confirmed WebGL2 on Intel UHD 630
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

Five fixed-path, 12-second warm live-city walk repetitions were then captured in
the visible local Chrome session on Intel UHD 630 at 1046x654 CSS pixels, DPR
1.25, fixed medium quality, shadows on and post-FX off. The [five-run summary](benchmarks/results/stage0/main-adf6d07-local-intel-walk-five-run-summary.json)
and individual reports are saved in `benchmarks/results/stage0/`. Each run moved
about 49.9 m through the warm spawn area:

- Frame p95 median was 33.4 ms (range 33.3–33.6 ms), which misses the 16.7 ms
  desktop p95 budget. Frame p99 median was 33.6 ms (range 33.4–66.9 ms).
- The 1% low median was 27.8 FPS (range 8.3–29.8). One repetition had 12 frames
  above 50 ms and two above 100 ms; the other four had at most one above 50 ms
  and none above 100 ms. p95 repeatability is good, but the long tail is not.
- CPU render-submission p95 median was 15.0 ms (range 13.9–24.4); GPU timer p95
  median was 13.01 ms (range 11.96–19.62). These overlap within the frame and
  must be analysed separately rather than summed. The scene averaged about 578
  draw calls and 360,000 triangles, with 590 geometries, 30 textures and 28
  shader programs.

This is a warm live-data baseline, not a candidate comparison. Chrome was
visible and GPU timing was available, but OS load and integrated-GPU thermal/power
state were not recorded; one repetition had a substantial tail spike. The
desktop p95 budget miss and high submission/draw-call load justify a render-cost
audit next, while the noisy tails still block a pass/fail visual A/B.

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

The first boundary-crossing walk report exposed a resource-cap defect: cells
with no new features skipped eviction, and the application was configured for
9 cells even though the active 3x3 ring can coexist with a pinned spawn cell.
The follow-up fix evicts empty cells and sets the cap to 10. A lifecycle test
advances three empty rings and verifies the bound. The [walk report](benchmarks/results/stage0/main-664b55f-osm-rome-walk-cross-cell-after-eviction-fix.json)
and [drive report](benchmarks/results/stage0/main-664b55f-osm-rome-drive-cross-cell-swiftshader.json)
both crossed from `wtw_city6_41.890_12.492` to the expected east neighbor,
finished neighbor streaming with zero failed cells, and retained exactly 10 of
10 allowed cells. Walk displacement was 6.50 m; drive displacement was 12.86 m.
These used headless SwiftShader, so their frame timings are excluded from GPU
performance comparisons. The earlier [failed report](benchmarks/results/stage0/main-664b55f-osm-rome-walk-cross-cell-swiftshader.json)
is retained to show the regression that the new checks caught.

Remaining Stage 0 gates: control OS load and integrated-GPU power/thermal state
for candidate A/B runs; compare cold and warm starts; exercise dense real-city
data and cell-crossing walk/drive paths; and include real mobile hardware. The
four visual-condition medians are useful diagnostic baselines, but are not
candidate pass/fail results or a substitute for a 15-minute thermal soak.
No shader, texture or visual rendering behavior changed in this checkpoint.

The earlier local integration check passed all 92 tests and the optimized
production build. After deterministic weather controls and the late-road wetness
fix, `npm test` passed all 96 tests and `npm run build` passed again. The
production server returned HTTP 200 for `/`,
`/street` and `/manifest.webmanifest`. A visible browser loaded the street view
with a 1046x654 WebGL canvas and no console errors or warnings. This confirms
local build and startup only; it does not close the performance or device matrix.

The clean-revision [night/rain fixture smoke](benchmarks/results/stage0/main-local-night-rain-swiftshader-smoke.json)
used commit `aea4e00`, medium quality, seed 1337, a fixed player pose, hour 21,
weather 90 and the synthetic prop-heavy fixture. The runner verified those exact
settings, 1.00 m movement and zero console/page/local-asset errors. Its selected
renderer was SwiftShader and its one-second requested walk accumulated 32.3 s of
frame intervals under 96.4% system CPU load. Do not interpret those timings as
integrated-GPU performance. Windows reported no supported ACPI thermal zone.
The [captured night/rain scene](benchmarks/results/stage0/main-local-night-rain-swiftshader-smoke.png)
shows the requested UI state; real-GPU road/wetness appearance remains open.

Exit: repeated JSON/captures and a measured bottleneck report, without
architecture changes. Once noise and network variability are understood, choose
the next rendering or streaming stage based on those results. Bring geometry
work forward only if complete measured geometry-stage time dominates.

## 5. Stage 1 — Scheduling, allocation and streaming stability

Files: city-builder.js, city-builder-core.js, street/assemble-city.js,
street/cell-stream.js, street/terrain.js and street/resources.js.

- [x] 1.1 Split measured assembly/paint/upload hotspots into time-budgeted work.
  Start individual chunk goals at 8 ms desktop / 12 ms mobile, then calibrate.
  Prioritise centre/visible data and stagger finished neighbour uploads. The
  [interleaved desktop decision](benchmarks/results/stage1/assembly-budget-decision-2026-10-28.md)
  records the five-pair result and remaining mobile gates. The
  candidate's chunk p95 was 8.1 ms median and paired readiness delta was +3 ms;
  the earlier [recorded profile](benchmarks/results/stage1/assembly-profile-2026-10-28.md)
  remains the pre-change baseline context.
- [x] 1.2 Bound queues, cancel obsolete work and reject stale results. Preserve
  transactional rollback of scene objects, footprints and reserved IDs. The
  [lifecycle checkpoint](benchmarks/results/stage1/stream-lifecycle-checkpoint-2026-10-28.md)
  records bounded geometry/cell queues, per-cell cancellation, stale-worker
  fencing, rollback coverage, 112 passing tests, a production build, and a
  recorded Rome boundary smoke. The separate [15-minute soak report](benchmarks/results/stage1/resource-soak-2026-10-28.md)
  now verifies desktop resource stability during a 4.48 km walk.
- [ ] 1.3 Compare one/two geometry workers on low-core devices. Include KTX2
  decoder workers in contention/memory decisions; retain defaults unless measured.
  - [x] Add a benchmark-only one/two-worker control and a Windows CPU-affinity
    harness. The [five-pair constrained desktop comparison](benchmarks/results/stage1/geometry-worker-affinity-four-logical-five-pair.md)
    reduced worker queue delay with two workers but showed no reliable cold-ready
    or frame-time gain. Keep the existing two-worker default. A physical low-core
    device, attributable process memory, and Stage 3.5 KTX2 decoder contention
    remain unmeasured, so 1.3 stays open.
- [x] 1.4 Reduce measured clones and temporary allocations. The [city-data
  copy comparison](benchmarks/results/stage1/city-data-copy-on-write-five-pair.json)
  measured a 17.5 ms median defensive clone; the read-only path skips it and
  uses copy-on-write for editor changes. Startup and frame p95 did not improve.
  The [road-query comparison](benchmarks/results/stage1/road-query-index-five-pair.json)
  justified a local segment grid: query plus index-build time fell by a paired
  median 9 ms, with identical output-buffer size. Collision and height caches
  were left intact. The [checkpoint report](benchmarks/results/stage1/city-data-and-road-query-checkpoint-2026-10-28.md)
  records the five-pair results and limits.
- [x] 1.5 Verify terrain eviction/revisit, road repaint, shared material ownership,
  late imagery callbacks and stationary retries. The [lifecycle verification
  report](benchmarks/results/stage1/stage1-lifecycle-verification-2026-10-28.md)
  records the targeted regression coverage. The [15-minute resource soak](benchmarks/results/stage1/resource-soak-2026-10-28.md)
  passed on the Windows desktop: 887 samples, 4.48 km movement, a settled
  10/10 resident-cell bound, and stable resource counts after initial streaming.

Exit: reduced measured spikes, lifecycle regression checks pass, and resident
resources stabilise in a 15-minute walk. The desktop resource-stability gate is
checked on one RTX 4060 laptop. Keep geometry semantics unchanged.
The Stage 1.1 desktop candidate passed its matched recorded-city comparison;
mobile assembly and input latency during assembly remain open for the broader
Stage 1 exit. Stage 1.3 also needs a physical low-core test and KTX2 worker
contention/memory measurements.

## 6. Stage 2 — Material families, batching and shader discipline

Files: styles.js, materials.js, facade-uv.js, city-builder-core.js,
street/assemble-city.js, post-fx.js and StreetEngine.js.

- [x] 2.1 Inventory material keys, scene geometry, shader programs, draw calls
  and texture-role bindings per tier. The [three-tier census](benchmarks/results/stage2/material-inventory-three-tier.md)
  covers the recorded Rome fixture; factory caches stay fixed at 4 building,
  3 roof, 7 road and 20 simple keys. Its raw material values are empty, so named
  family coverage remains for 2.2.
- [x] 2.2 Map raw OSM material names to bounded families, retaining meaningful
  plaster/brick/stone/metal/glass differences and deterministic colour variation.
  The [tagged material smoke](benchmarks/results/stage2/material-family-mapping-smoke.md)
  reduced 16 canonical/alias/unknown names to 10 building factory keys; the Rome
  showcase itself has no `building:material` values.
- [x] 2.3 Prototype family batching with linear-space vertex tint. Preserve AO/
  jitter without multiplying base tint twice. Keep chunk-local culling bounds,
  feature metadata and independent collision/editor picking. The
  [five-run interleaved A/B](benchmarks/results/stage2/material-family-batching-smoke.md)
  kept the matched view visually equivalent and reduced mean draw calls by
  3.9% (22.20 to 21.33) at unchanged median frame p95 (20.7 ms). GPU p95 was
  0.09 ms higher with overlapping ranges, so keep this as a neutral-cost
  synthetic improvement; real-city and mobile acceptance remain open.
- [x] 2.4 Audit sRGB colour/emissive maps versus non-colour normal/ORM data and
  one final tone/output conversion in direct/post-processed rendering. The
  [audit](benchmarks/results/stage2/material-color-space-audit.md) records map
  roles, explicit sRGB fixes and direct/composer output paths.
- [x] 2.5 Compare simple low/far materials with near PBR using actual GPU timings.
  Preserve important road, glass and metal response. The five-run Rome replay A/B
  found unchanged frame p95, overlapping GPU p95, and no reduction in mean draws;
  the prototype was reverted. See the [comparison and decision report](benchmarks/results/stage2/rendering-follow-up-2026-10-28.md).
- [x] 2.6 Keep necessary shader patches version-matched, with stable cache keys
  and shared uniforms. Preserve fog/instancing/lighting/vertex colours/depth.
  Time/weather changes must not trigger per-object shader recompilation. The
  walk-cycle patch now matches color, directional-shadow depth and point-light
  distance deformation through shared uniforms and stable per-variant keys. The
  build and recorded-city browser smoke passed; see the [shader audit](benchmarks/results/stage2/rendering-follow-up-2026-10-28.md).

### Controlled checkpoint — Prop material cache and spatial batching

The combined experiment was tested on 27 October in production builds of the
same local revision. Both builds used the same synthetic fixture, fixed pose,
population seed, medium quality, visible Chrome session and 12-second walk.
Five runs per build alternated in the order baseline/candidate/candidate/
baseline/baseline/candidate/candidate/baseline/baseline/candidate. Population
and optional Overture data were held constant; the same 256 props, 96
pedestrians, 31 cars, 24 birds and nine settled cells were present in every run.
Each run moved about 60 m and recorded zero benchmark validation errors.

The [A/B result](benchmarks/results/stage2/prop-material-cache-ab.json) and
[matched baseline capture](benchmarks/results/stage2/matched-baseline-initial.png)
and [candidate capture](benchmarks/results/stage2/matched-candidate-initial.png)
are retained. On visible Chrome 155 with Intel UHD 630, the median frame p95
was 16.8 ms for both builds. The candidate cut mean draw calls from 47.2 to
26.9 (-43%), but increased median GPU p95 from 5.73 ms to 7.58 ms (+32%) and
mean submitted triangles from 65.1k to 97.6k (+50%). Median frame time changed
by less than 1%. One baseline run had a 53.2 ms frame p95 outlier; OS load and
GPU thermal/power state were not recorded, so the 1% low remains noisy.

**Decision: revert the combined material-cache/spatial-batch experiment.** The
lower draw-call count did not improve frame p95 on this workload and the GPU
cost rose consistently in all five candidate runs. The experiment does not
separate shared-material reuse from spatial batching. A later test may evaluate
each independently, but only with equal visible geometry and the same GPU/frame
no-regression gate. This synthetic result does not close the real-city, mobile,
weather or long-walk gates.

The Stage 2.1 medium-tier census and diagnostic hook are now extended to low,
medium and high quality in the recorded Rome fixture. See the
[three-tier census](benchmarks/results/stage2/material-inventory-three-tier.md).
The same 154 scene materials and 42 referenced textures appeared at all tiers;
program count rose from 26/28 to 64 at high quality, where mean draw calls also
rose from about 238 to 446 in this single run. The Rome fixture has no named
building-material tags, so Stage 2.2 used a separate CC0 material fixture and
smoke report. The family-batching prototype is recorded in
[its five-run A/B report](benchmarks/results/stage2/material-family-batching-smoke.md).
The interleaved comparison reduced mean draw calls by 3.9%, kept frame p95
unchanged, and showed a 0.09 ms higher GPU p95 with overlapping ranges. Stage
2.3 is retained for this synthetic workload; real-city and mobile gates remain
open. Stage 2.4's color-space audit is recorded in
[its audit report](benchmarks/results/stage2/material-color-space-audit.md).
The Stage 2.5 far-material A/B and Stage 2.6 walk/shadow shader audit are
recorded in the [rendering follow-up](benchmarks/results/stage2/rendering-follow-up-2026-10-28.md).

Exit: lower submission/program cost or approved visual gain at neutral cost;
no hue, silhouette, placement or editor-selection regression.

## 7. Stage 3 — Offline asset pipeline and compressed texture pilot

Files: materials.js, facade-uv.js, textures.js, model loading in StreetEngine.js,
public/sw.js and CREDITS.md. Proposed: assets/manifest.json,
scripts/build-assets.mjs and public/textures/.

- [x] 3.1 Curate a coherent plaster/brick/stone/concrete/asphalt/paving set and
  small prop kit. Use the researched Poly Haven, ambientCG, Kenney and Quaternius
  sources; record actual asset URLs/licenses. Reuse existing credited assets.
  - The [source manifest](assets/manifest.json) selects six ambientCG surfaces
    and four Kenney City Kit Roads props. Poly Haven and Quaternius remain
    alternates for later additions; no library-wide import was made.
- [x] 3.2 Record author, license, source hash, metre scale, UV density, map roles
  and output revision. Preserve map/imagery attribution separately.
  - The manifest records source archive and model hashes, initial metre tiling,
    UV density, map roles, raw GLB bounds, target dimensions and a source-only
    revision. ambientCG's v3 API does not expose individual creator names, so
    those are marked as unavailable. Extracted source hashes and converted
    output metadata are recorded in the Stage 3.3 progress note; imagery credits
    stay in their separate section.
- [ ] 3.3 Normalise pivots/+Z direction; prune unused geometry/maps. Bake shallow
  facade detail into shared atlases, align emissive masks, add mip-safe gutters
  and avoid baking directional sunlight into albedo.
  - Progress, not exit: source snapshots are retained and hashed; four shared
    PBR atlases have 16px edge-dilated gutters; missing AO uses white; four
    Kenney GLBs have bottom-centred pivots, metre scaling and audited +Z-facing
    fronts. Details and output hashes are in [the manifest](assets/manifest.json).
    Blender 5.2.0 and Pillow 10.4.0 are pinned, with rebuild instructions in
    [the asset pipeline notes](assets/README.md). Facade-window/storefront detail
    is not yet baked into the PBR atlases, and browser integration/visual approval
    remains open; the existing procedural facade and emissive atlases still share
    their grid.
- [ ] 3.4 Pin offline conversion tools. Compare KTX2 ETC1S/UASTC per map type,
  inspecting normals, window detail and masks. ORM packing saves files; stock
  shaders may still sample each map separately. KTX2 encoder/transcoder versions
  and per-map comparisons remain open.
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
  - New materials now inherit the current wetness, with a unit test covering
    creation after the weather change. Real-GPU reflection and visual acceptance
    remain open.
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

**Next bounded work:** finish Stage 3.3 by baking the shallow facade/window
detail into the shared atlas layout, preserving exact alignment with the night
emissive mask, then inspect that integration in the browser. The offline PBR
atlases and normalised props now exist, but are not loaded at runtime. After this
content step, pin KTX2 tools and compare ETC1S/UASTC by map type before any loader
adoption. Stage 0.8 dense live-city cold/warm walk/drive, Stage 1 mobile assembly
and input latency, and Stage 1.3 low-core worker plus KTX2 contention/memory
checks remain release gates; runtime adoption must preserve the measured
fallback and resource budgets. Recorded Rome replay is client/streaming
evidence, not live Overpass evidence.

**Open acceptance gate:** Stage 0.8 still needs matched dense live-city cold/
warm and walk/drive boundary measurements. The 28 October Manhattan retries
failed before a valid measurement because the origin city API returned HTTP 502
and aborted requests; see the earlier [smoke result](benchmarks/results/stage0/main-727d46e-live-manhattan-cold-walk-smoke.json)
and the [latest cold-walk diagnostics](benchmarks/results/stage0/main-5250d01-live-manhattan-cold-walk.json).
Retry the live matrix when the API returns complete cells. The four-condition
summary reports median frame p95 values of 17.0–33.5 ms, with within-condition
ranges reaching 33–34 ms; host CPU and available memory varied, and Windows
exposes no ACPI thermal readings. The desktop resource soak passed, but mobile
thermal checks and direct thermal measurements remain open. Keep Rust/Wasm/SIMD deferred: worker compute was 25.9 ms median versus
729.4 ms roundtrip on the earlier synthetic trace, so kernel acceleration is
not yet the measured opportunity. The Stage 2.5 far-material experiment was
completed and rejected; Stage 2.6 shader/shadow parity is complete. Stage 3.1
and 3.2 curation are complete, and 3.3 offline conversion is in progress.
