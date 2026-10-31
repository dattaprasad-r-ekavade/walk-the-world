# Walk the World — Performance and Visuals Implementation Plan

Updated: 31 October 2026. Reviewed base: `2342c0a` on `origin/main`.
Demo gates D1–D8 are closed. The smoothness track (section 0a) closed S1–S6 from
live-deploy profiling; S7–S8 stay open. S9's real-input check did not reproduce
the hang on 30 October. S7 has two changes awaiting target-laptop confirmation:
`be2ff98` decodes terrain images off the main thread, and surrounding terrain
visuals now start one per animation frame to spread canvas uploads. The `87d26dc`
interior-window cutoff was reverted: its gain was not repeatable and it shortened
the interior view. A separate far-facade detail fade was rejected after GPU-timer
p95 increased in all four cities. S8's 0.85 integrated-Intel render-scale
candidate passed the four-city host comparison; target-laptop measurement
remains. The dependency audit is clean, but SEC1's live-data browser acceptance
is still open. B3's multipolygon relation query and full Edinburgh cell builder
check now pass against the Britain and Ireland Overpass instance; demo-cell R2
reseed remains open (see B3 below). Public R2 reads are available through the
deployment proxy, so local staging no longer needs private R2 credentials.
The B3 terrain paint now survives asynchronous imagery completion, and a
recorded Edinburgh browser replay shows streamed land-use paint. The demo-cell
R2 reseed remains open pending separate write approval.
B4's Overture-to-OSM merge now has offline field/precedence coverage; live cell
coverage still awaits R2 configuration. B3 now has a local-only cache staging
and verification workflow. The HPI mirror supplied all 36 Demo candidates;
the full verifier and a four-city browser replay passed. Separate R2 upload
approval and post-refresh live visual/performance acceptance remain open (see
B3 below).
B4 also has a hash-gated manifest uploader; its local dry run validates the
reviewed 512-file index and all 36 Demo-cell bounds without contacting R2.
Production upload and API acceptance remain open.
This is the active plan. The [previous detailed checkpoint](docs/PLAN-CHECKPOINT-2026-10-28-BEFORE-REVIEW.md)
preserves the full experiment history; its status is historical.

## Release gate — supported framework and dependency audit

- [ ] **SEC1 — P1 before public release: Upgrade the unsupported Next.js 14 tree.**
  **30 Oct, branch `sec1-next16`: code done; four-city browser acceptance
  passed; live Overture check open.** Next 16.4.3 (Turbopack build), React/React DOM
  19.3.1, ESLint 9 flat config
  (`eslint.config.mjs`; `next lint` is gone), `@duckdb/node-api` 1.4.5-r.1
  replacing the deprecated `duckdb` package and its node-gyp/tar chain, plus
  non-forced `npm audit fix`. Next 15.5.28 was skipped: its bundled postcss
  still audits high. Route handlers await `params`; `serverExternalPackages`
  replaces the experimental key. On 30 Oct at `021f55b`, both full and
  production-only `npm audit` reported 0 findings, all 234 tests passed, lint
  had 0 errors (15 warnings), and the production build passed. Earlier local
  `next start` checks served `/`, `/street`, `/editor` and city/edit/asset API
  routes with expected status codes.
  **31 Oct audit refresh:** `npm audit --json` now reports 19 moderate findings
  in development tools; `npm audit --omit=dev --json` still reports zero.
  A read-only `npm audit fix --dry-run` changes no packages and leaves the
  findings; its available fixes require major changes or downgrades. ESLint 10
  is not currently a supported pairing with the locked React ESLint plugin.
  No forced override or downgrade was applied. See the [current audit report](benchmarks/results/stage0/sec1-next-dependency-audit-2026-10-31.md).
  A private-window dev browser pass on 30 Oct, with `reactStrictMode: true`,
  exercised globe → Pune street → globe navigation. The route mounted and
  returned without a Next.js issue badge, but city data stayed at “Streaming
  city”: the Pune API request returned 502 after 85 s, then 200 after a 16.9 s
  retry, without rendering nearby streets. Local R2 and the public cell base
  were both unconfigured, so no cache write was possible. A separate regular
  Brave run showed a hydration mismatch caused by extension-injected `<html>`
  and `<body>` attributes; it did not appear in the private window. See [the
  browser acceptance check](benchmarks/results/stage0/sec1-next16-browser-acceptance-2026-10-30.md).
  A subsequent visible-Chrome rehearsal against the live deployment completed
  Pune, Edinburgh, Tokyo and New York with 36/36 warm R2 cells. Each city reached
  engine-ready and settled with nine resident cells, zero failed cells, nine
  HTTP 200 city responses, and its expected preset heading. The deployed
  service-worker revision matched the current `main` build hash (`293eee6`).
  See the
  [four-city Next 16 acceptance report](benchmarks/results/stage0/sec1-next16-four-city-2026-10-30.md)
  and its [screenshots](screenshots/demo-track/rehearsal-2026-10-30-sec1-next16/).
  A read-only DuckDB footer scan against the official current release,
  `2026-10-21.0`, found all 512 building Parquet files and validated their
  manifest bounds. The previous `2026-06-17.0` default listed no files. The
  manifest was saved locally; no R2 request was made. The index builder,
  manifest builder and API runtime defaults now use the verified release.
  The current reviewed upload body is 114,192 bytes with SHA-256
  `556fce03a2bba85bf3ed963b12b2b96302ca89597f7e1d0ab1e261aa813f4570`;
  the formatted review file is 133,652 bytes. See the manifest report for both
  file and upload-body hashes.
  Still open: separately authorize and upload the exact manifest to R2, confirm
  the deployed `OVERTURE_RELEASE` matches, then complete the live Overture API
  check. Keep SEC1 open until these release-data checks pass. See the
  [read-only Overture manifest report](benchmarks/results/stage0/sec1-overture-manifest-readonly-2026-10-31.md)
  and [reviewed manifest](benchmarks/results/stage0/sec1-overture-index-2026-10-31.json).
  A 31 Oct read-only production check returned `{"indexed":false,"files":0}`
  from `GET /api/overture-index`; the public proxy returned 404 for the reviewed
  release manifest and the New York Overture cell. Local `.env.local` has no
  R2 credentials or public cache base. The cold `/api/overture/<key>` path can
  upload its derived cell, so it was not called without write approval. SEC1
  remains open for the exact manifest upload, deployed release confirmation,
  and a safe live API acceptance check.
  The one-time `POST /api/overture-index` route is now production-disabled
  (404), and in local development it requires a dedicated `OVERTURE_INDEX_SECRET`
  bearer token; an unset secret returns 503. The 300-second production route
  limit is shorter than the 1,968-second metadata scan, so release indexing
  uses the reviewed CLI manifest instead. A local production-route smoke
  returned 404; the auth tests cover 503 when disabled and 401 for an invalid
  token. No indexing or R2 write ran. Three focused auth cases pass.
  The full suite passes (237 tests), the production build passes, and focused
  lint is clean. An outdated post-FX test now waits for its intended shader
  warmup before expecting bloom to enable.
  On `6c79a3d`, `npm ci` installed Next.js 14.2.35, React/React DOM 18.3.1,
  DuckDB 1.4.4 and Sharp 0.35.5. `npm audit --omit=dev` reported 11 production
  dependency findings (10 high, 1 critical); the full install audit reported 19
  including development dependencies. Next.js is a direct dependency with an
  aggregated critical severity, and npm reports 16.4.3 as its available fix,
  which is a major upgrade. DuckDB is also a direct high-severity finding with
  no automated fix reported. See the [vendor support policy](https://nextjs.org/support-policy),
  the [SVG image-optimizer advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw),
  and the [Windows-hosted advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36).
  Next 14 is unsupported; Next 15 maintenance security support currently ends
  31 January 2027. The current source has no `next/image`, AVIF image config,
  Server Actions or Cache Components, and Sharp 0.35.5 meets the vendor's stated
  workaround for the SVG advisory. These facts narrow some advisory paths; they
  do not clear the full audit or prove every Next finding unreachable. The
  Windows-only advisory also needs the real deployment host checked. Select a
  supported Next/React pair, resolve the DuckDB dependency chain, then rerun the
  full audit, tests, build, API-route and four-city acceptance before closing.
  Do not use a forced blanket audit fix or suppress findings to pass this gate.

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

- [x] **D1 — Ground and sidewalks near the player.** Fixed the downward road
  ribbon winding that culled asphalt and lane markings from above. The initial
  street now adds 70 m of sidewalk and 15 cm kerb geometry on local vehicular
  roads, honoring explicit OSM sidewalk tags. Pedestrian-only ways keep their
  paved path surface. Matched four-city captures and the settled visible-Chrome
  smoke are in [the local production rehearsal](screenshots/demo-track/rehearsal-2026-10-28-d1-d3-local-production/).
  The settled 300-frame Pune p95 was 14 ms, matching its 14 ms pre-change smoke;
  the broader open ground beyond mapped roads remains terrain imagery and is a
  B3 landuse-ground follow-up.
- [x] **D2 — Per-city demo presets.** Each demo place now has a fixed start
  coordinate, time, weather and explicit heading. Pune's 270° heading replaces
  the empty-lot view; other headings match the captured street-framing angles.
  `StreetEngine` applies the preset heading after safe street placement. The
  [post-deploy visible-Chrome captures](screenshots/demo-track/rehearsal-2026-10-28-post-heading/)
  confirm the expected heading at each city start. Pune is framed down the
  street rather than across the open lot. Unit tests and the production build
  pass; live smoke p95 was 14.0 ms in Pune.
- [x] **D3 — Facade textures visible on demo hardware.** The home menu prefetches
  the two shared KTX2 maps and Basis decoder while idle; it does not prefetch the
  larger near set. A visible-Chrome production preview on Intel UHD loaded the
  near facade maps at medium tier with compressed texture support; the factory
  reports `highFacadeAtlases: true`. The 5.98 MiB transfer decoded to an estimated
  17.1 MiB of GPU mip payloads, with 9.5 ms upload submission. Low-tier and
  mobile eligibility remains disabled by policy and covered by unit checks.
  See the [four-city production rehearsal](screenshots/demo-track/rehearsal-2026-10-28-d1-d3-local-production/report.json).
- [x] **D4 — Benchmark mode cannot reach live visitors.** A normal production
  build opened at `/street?bench=1` with `window.__BENCH_MODE` false; only
  `NEXT_PUBLIC_ENABLE_BENCH=1` builds and development enable it.
- [x] **D5 — Remove dead deploy weight.** `public/` contains only content-hashed
  KTX2 maps and revisioned Basis decoder files. The runtime asset builder writes
  those hashed paths, and `.gitignore` excludes raw benchmark JSON/PNG results.
- [x] **D6 — Service-worker revision on every build.** `npm run build` invoked
  `prebuild` and stamped `CACHE_REVISION` from package, commit and texture
  revisions before Next.js built.
- [x] **D7 — Demo rehearsal checklist.** The post-deploy 28 October
  [visible-Chrome report and captures](screenshots/demo-track/rehearsal-2026-10-28-post-heading/)
  confirm 36/36 cells warm, all four cities ready, zero console errors and
  matching preset headings. Time-to-ready was Pune 6.1 s, Edinburgh 5.3 s,
  Tokyo 6.4 s and New York 4.2 s. Frame-time p95 was 14.0, 20.8, 14.1 and
  20.8 ms respectively. Timings represent this host.
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

## 0a. Smoothness track — priority 0 (live-deploy profiling, 29 Oct)

Goal: no visible freeze or stutter anywhere in the demo path (menu, globe,
fly-to-city, street boot, walk, time switch, travel). Measured with a scripted
visible-Chrome tour of the Vercel deploy on the Intel UHD laptop (i5-1035G1,
ANGLE D3D11). The tour and profiling scripts live outside the repo; numbers
below compare production before the fixes with the new build on the same host.

Root cause of most stalls: three.js links shader programs synchronously on
first draw. Any change to a program key (composer on or off, shadow state,
per-family cache keys) recompiled hundreds of programs on the main thread.

Done:

- [x] **S1 — Fly-to-city transition (`e401e9d`).** The globe hides Cesium
  buildings and skips the render-scale governor during the flight, reuses the
  cached ground height, and navigates on arrival with client routing. The street
  engine, city data and spawn terrain start loading on departure (`warmStreet`).
  Demo cities keep their preset time, weather and heading on arrival.
- [x] **S2 — Street shader stalls (`1ba4246`).** Building materials share one
  program key instead of 23. The scene draws through the composer on medium even
  with no effect on, so dusk only toggles bloom. The automatic quality step no
  longer flips shadows or the composer. New city roots and streamed cells stay
  hidden until `renderer.compileAsync` has compiled them against the composer
  target. Result: walk 21 to 43 fps (2.9 s freeze gone), travel main-thread
  blocking 5.3 s to 1.2 s, Tokyo boot 4.7 s to 3.4 s, first night switch 3.2 s
  freeze to 0.2 s.
- [x] **S3 — Prop materials (`ba834b7`).** Traffic lights, bus stops, cranes and
  chimneys share cached materials, so prop baking merges them. Draw calls went
  from 448 to 384 and materials from 921 to 257 at the Tokyo start.
- [x] **S4 — Globe cost on medium (`ba834b7`, `71e66a0`).** The ocean water
  effect and Cesium OSM Buildings run only on the high tier. Buildings load
  lazily below 20 km and on walk entry. Globe load blocking went from 4.7–6.7 s
  to 2.5–3.4 s; zoom-in blocking from 3.5–6.8 s to 0.65–1.4 s at 39 fps.
- [x] **S5 — Sign boards (`5de5606`).** Shop and name signs mount on the
  road-facing wall of their own building, clamp to the wall length and skip
  overlaps, with the old outside placement as fallback.
- [x] **S6 — Build and repo hygiene.** Vercel build fixed (`.vercelignore` keeps
  the build-time scripts). Node 22 pinned (`.nvmrc`, engines, Dockerfile),
  non-interactive ESLint config, `npm run check` and a CI workflow. In-range
  dependencies refreshed; React Query removed; major upgrades assessed in
  [docs/UPGRADE-ASSESSMENT.md](docs/UPGRADE-ASSESSMENT.md) (feeds SEC1).
  Localhost reads public R2 through the `/r2-public` rewrite, so local previews
  no longer hit the bucket's missing CORS headers.

Open:

- [ ] **S7 — Confirm the fixes on the live deploy.** Run the tour once against
  production after `71450de`. Acceptance: no frame over 500 ms in the walk,
  night-switch and travel segments, and zero console errors. A visible Chrome
  tour on 29 Oct completed globe travel to Tokyo, walking, the night switch and
  street travel to Edinburgh. On this Intel Core i7-13650HX host using ANGLE
  Intel UHD Graphics (0xA78B), frame maxima were 881.9 ms for globe travel,
  90.3 ms for walking, 41.6 ms for the night switch and 243 ms for street
  travel. The globe segment therefore misses the threshold. The browser had no
  console errors or HTTP responses >=400. A production-origin GET of the live
  R2 Tokyo cell returned 200 and was CORS-readable. This is not the target
  Intel UHD i5-1035G1 demo laptop, so it does not close S7. The Edinburgh
  screenshot also showed the Travel panel and prior Shibuya label after arrival;
  commit `23a34cc` closes the panel and clears the old label. Its post-deploy
  verification confirmed the Edinburgh label and recorded a separate five-
  second window at p95 20.9 ms, max 152.8 ms, with no console or HTTP errors.
  S7 still fails the globe-travel threshold and needs the target laptop. See
  [the live-deploy report](benchmarks/results/stage0/s7-live-deploy-2026-10-29.md).
  Candidate fix `be2ff98`: the long frame was attributed to the elevation
  tile's image `onload` handler, where an `<img>` decodes lazily inside the
  first `drawImage`. Elevation and street map tiles now load with `fetch` and
  decode with `createImageBitmap` off the main thread (no colour conversion,
  so encoded heights stay exact). Next: one tour on the target laptop; check
  that ground imagery and hills still appear. The 620 ms Cesium-loading frame
  at globe start is not addressed.
  Profiled on the target i5-1035G1 laptop (30 Oct, local production build,
  Long Animation Frames plus CPU samples, one run per variant). Worst arrival
  frames: 1,470 ms at boot, from synchronous shader linking
  (`getProgramInfoLog`) in the first PMREM environment build that `setTime`
  triggers; 803 ms in a later render with 168 ms of program linking plus a
  220 ms response handler; 720 ms of render-phase time with almost no script
  (GPU or texture upload, likely the 1–2k terrain canvases); 422 ms of Cesium
  shader linking on the globe. Two fixes were tried and reverted: (a)
  pre-compiling PMREM's blur and GGX materials with `compileAsync` before the
  first `setTime` left a 2.1 s frame in the continuation (no gain on this
  ANGLE/D3D11 driver); (b) warming the whole scene instead of the city group
  produced a 2.9 s frame inside the `compileAsync` poll. Source order confirms
  the first PMREM build runs before input-ready while the loading screen is up.
  The startup canvas is now hidden until input-ready, masking the visible scene
  freeze; it does not reduce the PMREM stall or time to interaction. A local
  three-run PMREM input-size comparison found no speedup at 256×128 versus
  512×256 on the RTX 4060, so the smaller input was reverted. PMREM shader and
  build durations are now available in diagnostics for a target-laptop profile.
  Surrounding terrain visuals are started one per
  animation frame, cardinal neighbours first, to spread canvas texture uploads;
  this change still needs a target-laptop profile and a visual check of ground
  imagery and hills. A 31 Oct headless production smoke confirmed `26cb647` was
  deployed: Edinburgh loaded all 9/9 cells (HTTP 200), settled with nine resident
  cells, and logged zero console errors. The 120 stationary frame samples had
  p95 16.9 ms; this is not hardware evidence and does not cover walking, travel,
  night switch, or visible terrain relief. See the [smoke report](benchmarks/results/stage0/s7-live-terrain-stagger-2026-10-31.md)
  and [capture](screenshots/performance-visuals/stage0/s7-terrain-stagger/edinburgh-live-headless-2026-10-31.jpg).
  The local production-build capture also confirmed that the canvas remains
  hidden while the loading screen is visible and appears when input-ready; see
  the [loader capture](benchmarks/results/stage0/s7-loader-canvas-2026-10-31.md).
  The [PMREM size comparison](benchmarks/results/stage0/s7-pmrem-resolution-ab-2026-10-31.md)
  is not target-device evidence. A full-tour runner is now available as
  `npm run bench:s7`; it follows the actual globe flight to Tokyo, walk, night
  switch, and street flight to Edinburgh, recording frame intervals and
  readiness/renderer diagnostics. Its 31 Oct headless control-flow run reached
  both cities, moved 3.5 m, observed 17 city-cell HTTP 200 responses, and had
  zero console/page/HTTP errors. SwiftShader and headless RAF throttling make
  its frame times invalid for the 500 ms gate; Tokyo (7 resident, 2 pending)
  and Edinburgh (5 resident, 4 pending) also had unfinished neighboring-cell
  streams after 45 seconds. Terrain diagnostics saw one elevation tile in each
  city with no flat fallback, but this does not prove visible relief or imagery.
  The frame-budgeted shader-warmup experiment is summarized below. See the
  [control-flow report](benchmarks/results/stage0/s7-tour-control-2026-10-31.md)
  and [JSON capture](benchmarks/results/stage0/s7-tour-control-2026-10-31.json).
  A 31 Oct visible run on the available i7-13650HX host recorded under-500 ms
  frames in the four travel/walk/night acceptance segments, zero errors, and
  9/9 resident cells in both cities. Chrome selected the RTX 4060, not Intel
  UHD; Tokyo arrival separately reached 2,716 ms. This validates the visible
  tour path but does not close S7. See the [i7-host report](benchmarks/results/stage0/s7-tour-visible-i7-2026-10-31.md).
  A diagnostic repeat recorded a 2,715.8 ms Tokyo arrival frame overlapping a
  2,682 ms Long Task. The preceding measured neighbor assembly (95.4 ms) and
  cell shader warmup (105 ms) do not explain it; browser attribution was
  unknown. Console, page and HTTP errors were zero; one OSM tile request was
  cancelled during navigation. The available host again used the RTX 4060, so
  this does not close S7. See the [stall diagnostic report](benchmarks/results/stage0/s7-tour-visible-stall-2026-10-31.md).
  A 31 Oct CDP profile on the production deploy found 2,592.8 ms in
  `getProgramInfoLog` during a 2,661 ms task that overlapped a 2,679.5 ms
  city-cell shader warmup. That initially pointed to synchronous city shader
  linking. Two Rome fixture prototypes and a later frame-sliced exact-renderable
  prototype did not demonstrate a fix, so all runtime changes were reverted.
  Three.js 0.186.1 source confirms `compileAsync` calls `compile` synchronously,
  then polls readiness; custom signatures also omit some renderer-derived key
  inputs. The first local full-tour replay used only the center cell per city.
  A complete production Tokyo and Edinburgh 3×3 replay now loaded all nine cells
  per city without errors. Its first visible Tokyo arrival reached 2,582.9 ms;
  three later runs reached 832.8–850.1 ms, so a cold or cache-sensitive stall is
  plausible but not established. Edinburgh stayed below 500 ms in all four
  recordings. The first profile summary merged native WebGL samples by function
  name and its PMREM stack attribution was unreliable. The runner now filters
  Long Tasks to the profile window and separates native samples by full call
  stack. In the corrected Edinburgh capture, a 299 ms Long Task included
  212.2 ms in renderer `getProgramInfoLog`; PMREM `getProgramInfoLog` accounted
  for 31.6 ms elsewhere in the arrival, and its 42.3 ms build event ended about
  799 ms before the task. Five additional tours with Chrome's GPU program
  cache disabled reproduced 2.47–2.57 s Tokyo arrival frames. The corrected
  profiles sampled 2.39–2.49 s in `getProgramInfoLog` on the regular renderer
  path, with no PMREM or `compileAsync` caller visible. A program-owner trace
  tied the new variants to terrain and building materials and one adjacent
  cell. Comparing the earlier and newly created `ground-detail-v1` keys showed
  the only difference was Three.js `numSpotLights` changing from 2 to 6.
  Three.js derives this field from `lights.spot.length`; the engine starts with
  two headlights, then creates four streetlamp pool lights after the spawn
  city shader warmup. A conditional prewarm found no lamp markers in the spawn
  cell: the initial warmup still saw two spotlights, and a later six-spot
  neighbor warmup followed the 2.45 s render stall. The pool is now reserved
  during engine setup before the first terrain render. Two full-city visible
  replays confirmed the first `ground-detail-v1` program used six spotlights
  and no later two-spot variant appeared, but Tokyo still reached 883.1 ms
  with the GPU cache disabled and 882.8 ms with it enabled. These are separate
  Tokyo-arrival diagnostics; all four S7 gate segments (globe travel, walk,
  night switch, and street travel) stayed below 500 ms in both runs, with zero
  console or HTTP errors. Chrome used the RTX 4060, not the target i5. Fully
  sampled 889–895 ms startup tasks overlapped the first PMREM build (470–479
  ms) and first renderer program event (371–374 ms); PMREM and image-size
  variants were already tested without a fix. A requestAnimationFrame yield
  separated a 524 ms Long Task containing 486.4 ms of PMREM work from a second
  393 ms Long Task containing the 387.9 ms first-render link, but Tokyo arrival
  rose to 899.8 ms and Edinburgh to 749.7 ms, so that timing change was
  reverted. A follow-up PMREM quality experiment temporarily lowers Three.js
  0.186.1's private GGX sample define to 32 only during environment generation.
  Two normal-cache full-city visible replays measured 155–157 ms for the initial
  PMREM and 583 ms for Tokyo arrival, versus 469.8 ms and 882.8 ms in the
  256-sample baseline. All four named S7 gate segments remained below 184 ms,
  both cities settled 9/9 cells, and errors stayed at zero. The RTX 4060
  screenshots show no obvious visual change; pixel differences are small but
  the captures are not a matched target-device image-quality review. Tokyo
  arrival still has one frame over 500 ms, and these results do not establish
  behavior on the target i5-1035G1. The profiled candidate's remaining 591 ms
  Long Task included a 386.6 ms first-render event linking 16 ordinary renderer
  programs; `getProgramInfoLog` accounted for 251.7 ms on that path. This points
  to first-city-render shader linking as the residual startup cost. The S7
  runner now supports `--quality=medium` and records the actual tier. Three
  medium-quality runs on the RTX 4060 measured 450.0–450.1 ms Tokyo arrival
  with the normal cache and 499.9 ms with the GPU program cache disabled; the
  first renderer event added 12 programs in 267–286 ms. All named gate segments
  stayed below 200 ms, but a 499.9 ms frame gives no useful margin and the RTX
  is not the target i5. See the [PMREM sample
  report](benchmarks/results/stage0/s7-pmrem-ggx32-2026-10-31.md) and its
  [machine-readable results](benchmarks/results/stage0/s7-pmrem-ggx32-2026-10-31.json).
  These RTX 4060 / i7 results do not close S7. See the [full 3×3 report](benchmarks/results/stage0/s7-full-city-3x3-profile-2026-10-31.md),
  [initial CPU profile](benchmarks/results/stage0/s7-tour-cpu-profile-2026-10-31.md),
  [warmup comparison](benchmarks/results/stage0/s7-frame-budgeted-warmup-2026-10-31.md),
  and [center-cell replay report](benchmarks/results/stage0/s7-full-tour-cell-replay-2026-10-31.md).
  A follow-up staged post-FX shader warmup compiled ten output, grade, optional
  FXAA, and bloom programs over 318 ms before input-ready in a local medium-tier
  replay. On the RTX 4060, the initial-night first-render event fell from
  258.8 ms with 12 new programs to 186.5 ms with two; a separate daytime
  night-switch replay fell from a 111.3 ms post-FX link event to no new
  programs. The city shader warmup took 472–513 ms across two direct
  center-cell captures and compiled 21 programs (15 standard, four basic, two
  Lambert). A targeted follow-up prewarmed two generic city shadow-depth
  variants and the population color, car-depth, and custom pedestrian-depth
  variants while those objects stayed hidden. The first visible city renderer
  event fell from six new programs in 309.8 ms to zero new programs in 119.0
  ms. The warmup also added 11.4 ms for the two city depth variants; overall
  startup max was 399.8 ms in this single run, so this does not prove a lower
  startup maximum. This was a coordinate-shifted Rome center-cell diagnostic,
  not a full 3×3 tour or target i5 run; the full globe harness also could not
  resolve `unpkg.com` on this host. Keep S7 open pending the target i5-1035G1
  tour and ground/terrain review. See the [staged post-FX warmup report](benchmarks/results/stage0/s7-postfx-staged-warmup-2026-10-31.md),
  the [city shader attribution report](benchmarks/results/stage0/s7-city-shader-attribution-2026-10-31.md),
  and the [shadow-depth warmup report](benchmarks/results/stage0/s7-shadow-depth-staged-warmup-2026-10-31.md).
  A follow-up visible local production replay loaded all nine Tokyo 3×3 fixture
  cells (31,064 elements; zero pending) with no console/page errors or failed
  requests. Settled p95/max were 16.9/17.1 ms on the RTX 4060. The new renderer
  diagnostic records newly added shader programs even on frames below 50 ms;
  the replay found no such additions. Its screenshot shows the street ground,
  roadway and buildings, but the flat urban view cannot establish terrain
  relief. A second Edinburgh review loaded nine elevation and 36 ground-imagery
  tiles with HTTP 200; a 5×5 height sample ranged 37.8 m across 600 m. This
  confirms local data presence, but not target-device behavior or reference
  terrain accuracy. Neither capture covers the full globe tour or the target
  i5. Keep S7 open.
  See the [full-city shader diagnostic report](benchmarks/results/stage0/s7-full-city-shadowdiag-2026-10-31.md),
  [JSON capture](benchmarks/results/stage0/s7-full-city-shadowdiag-2026-10-31.json),
  [Tokyo screenshot](screenshots/performance-visuals/stage0/s7-full-3x3-shadowdiag/tokyo-three-by-three-2026-10-31.png),
  and [Edinburgh terrain screenshot](screenshots/performance-visuals/stage0/s7-full-3x3-shadowdiag/edinburgh-elevated-2026-10-31.png).
- [ ] **S8 — Walking cost on weak GPUs.** Walking is GPU-bound on Intel UHD
  (fill rate, not draw calls). Candidates, in order: cheaper interior-window
  shader at distance (drop the ray-box sample beyond about 40 m instead of
  fading it), simpler distant buildings (feeds C2), then a lower default render
  scale on integrated GPUs. Acceptance: matched four-city captures and walk p95
  improvement of at least 10% on the Intel laptop. Decision (30 Oct): the
  `87d26dc` interior-window cutoff was reverted to the 40–60 m fade because its
  frame-p95 gain was not repeatable and it shortened interior visibility. The
  earlier 12:00 live-data baseline (Tokyo 27.9 ms, Pune 14.1 ms, Edinburgh
  20.9 ms, New York 20.9 ms) had zero interior-window glow and is not evidence
  for the shader change. A follow-up facade/normal detail fade from 45–60 m
  changed frame p95 by -5.5% on average, but GPU-timer p95 increased 4.4% in
  all four cities; that candidate was rejected and is not retained. The 0.85
  Intel auto-scale candidate reduced median frame p95 by 20.4–33.0% across five
  matched captures in each of four cities on a Lenovo 83DV using its Intel UHD
  renderer. Keep the candidate for target confirmation; S8 remains open until
  it is measured on the target i5-1035G1 laptop. See the [cutoff comparison
  report](benchmarks/results/stage0/s8-interior-distance-cutoff-2026-10-30.md),
  [far-detail report](benchmarks/results/stage0/s8-far-building-detail-2026-10-30.md),
  and [render-scale report](benchmarks/results/stage0/s8-intel-render-scale-2026-10-30.md).
  To make that target comparison repeatable from one source revision,
  `bench-perf.mjs` now accepts a benchmark-only fixed `--render-scale 1` or
  `--render-scale 0.85` with auto quality, verifies the applied scale, and
  records it beside the frame/GPU metrics. A local Rome headless smoke applied
  both scales successfully; its SwiftShader timings are not S8 evidence. Next:
  run five alternating pairs per city with the same recorded 3×3 cells on the
  target laptop. See the [fixed-scale probe](benchmarks/results/stage0/s8-fixed-scale-probe-2026-10-31.md).
- [x] **S9 — Intermittent globe hang after orbit plus zoom.** Seen only under
  scripted input; the browser trace showed no long page or GPU task. A real
  drag orbit followed by wheel zoom on the 30 Oct local production build did not
  reproduce it: camera coordinates and map view updated, and the page remained
  responsive through a two-second follow-up. See the [real-input check
  report](benchmarks/results/stage0/s9-real-input-check-2026-10-30.md).

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
- [x] **A3 — Interior-mapping windows (M).** Facade windows now ray-box sample
  a shared eight-room, six-face atlas. The shader fades interiors from full
  strength at 40 m to zero at 60 m, and follows the existing dusk/night window
  glow. Four-city matched captures and a visible-Chrome smoke are in [the A3
  rehearsal](screenshots/demo-track/rehearsal-2026-10-28-a3-after/). The 300-frame
  p95 matched the A4 baseline in Pune, Edinburgh and Tokyo, and improved 0.5%
  in New York. Details are in the [A3 acceptance note](screenshots/demo-track/rehearsal-2026-10-28-a3-after/a3-acceptance.md).
- [x] **A4 — Sidewalks, kerbs and lane markings (M).** The initial 70 m and
  streamed cells now add sidewalk polygons from `sidewalk=*` tags (with local
  street defaults), 15 cm kerbs and deterministic 1 m paving slabs. Road atlas
  markings use `lanes`, `width`, and `oneway` profiles. Four-city captures and
  a settled visible-Chrome smoke are in [the A4 rehearsal](screenshots/demo-track/rehearsal-2026-10-28-a4-after/).
  Against the D1 baseline, 300-frame p95 changed 0% in Pune, Edinburgh and
  Tokyo, and +0.5% in New York. The local preview used a server-side R2 CORS
  shim because the public bucket omits browser CORS headers; `/api/assets`
  returned its expected 501 without local R2 credentials. Details are in the
  [A4 acceptance note](screenshots/demo-track/rehearsal-2026-10-28-a4-after/a4-acceptance.md).
- [x] **A5 — Full roof shapes and building parts (M).** Runtime meshes now cover
  gabled, hipped, skillion, pyramidal and dome roof tags. Overpass includes
  `building:part`; parts use `min_height`, `height` and `roof:height`, and an
  identical outline yields to its part. This stays dependency-free. If B1 later
  uses `straight-skeleton` in the baker, review the CGAL licence before shipping.
  Roof-shape and elevated-part geometry checks pass with the full unit suite and
  production build.
- [x] **A6 — Streamed cells rise in (S).** Done (street/cell-rise.js;
  shadows rebake when the last rise ends). New cells grow from the ground over
  ~0.6 s instead of popping in; transform-only so shared materials stay
  untouched.
- [x] **A7 — Three.js r170 → r186 (M).** Verified low risk for this stack:
  WebGL EffectComposer passes unchanged; PCFSoftShadowMap deprecated (PCF is
  now soft); rough PBR materials brighter (r181); PMREM moved to cube render
  targets (r187); KTX2Loader.detectSupportAsync deprecated (r181). Re-test
  every onBeforeCompile chunk replacement and compare matched screenshots. The
  package and lockfile now target Three.js 0.186.0. Matched visible-Chrome
  captures use the same frozen city-cell data in [the r170 baseline](screenshots/demo-track/rehearsal-2026-10-28-a7-r170-matched/)
  and [the r186 build](screenshots/demo-track/rehearsal-2026-10-28-a7-r186-matched/).
  The first 300-frame city smoke measured p95 at 14.0/34.9/36.0/20.9 ms on r170
  and 14.0/34.9/41.6/20.8 ms on r186 (Pune/Edinburgh/Tokyo/New York); its Tokyo
  result was a noisy +15.6%. Three matched 900-frame Tokyo repetitions per
  version then measured medians of 16.9 ms on both r170 and r186 (0% change;
  all six reached ready/settled). The same single neighbor cell failed in each
  version. No shader compilation errors appeared; the same geometry-merge
  warning and unconfigured local `/api/assets` 501 appeared in both. The matched
  captures and repeat reports are in [the A7 progress evidence](screenshots/demo-track/a7-progress-2026-10-28.md).
  All 180 tests and the r186 production build pass.

### Phase B — data foundation

- [ ] **B1 — Prebuilt cell format (M). Infrastructure done; not shipped.**
  Baker (`scripts/build-prebuilt-cells.mjs`) reuses city-builder-core and writes
  quantized per-cell artifacts plus an index with bounded overlap hints.
  Runtime (`lib/engine/prebuilt-cell-runtime.js`) loads them only when builder,
  material, terrain and editor revisions match; otherwise it rebuilds from raw
  JSON. `compileAsync` and the frame-budgeted assembly are in the path. A
  Tokyo cell bakes to 0.40× raw JSON size.
  - Result (29 Oct, matched Tokyo 3×3, RTX 4060 visible Chrome): 4.2% slower
    cold, 8.3% faster warm, 7.3% fewer bytes than raw. Steady frame p95 is the
    same in both modes (16.8–16.9 ms).
  - Why cold is not faster: the terrain-match check must download and decode
    four elevation tiles first (1.6–2.2 s cold). Hashing costs under 10 ms.
  - Decision (29 Oct): do not publish artifacts to production R2 for the
    demo. The gain does not pay for the extra release step. Keep the code; it
    falls back to raw cells cleanly.
  - Reopen only with **B1b**: cache sampled elevation grids per terrain
    revision (or ship them inside the artifact) so cold loads skip the image
    decode, while keeping the mismatch fallback. Still open after that:
    integrated/mobile GPU parity, editor Hide/save/reload acceptance, upload
    cost, and an R2 release task.
  - Full numbers: [B1 decision](benchmarks/results/stage8/b1-matched-2026-10-29/decision.md)
    and [B1 smoke](screenshots/demo-track/rehearsal-2026-10-29-b1-prebuilt-smoke/).
- [ ] **B2 — Overpass independence (M).** Self-hosted Overpass on a small VPS
  for target regions behind a Cloudflare Worker, or a custom Planetiler
  profile (Protomaps' basemap schema drops roof, lane and colour tags).
  `npm run seed:direct` remains the stopgap. **31 Oct:** server fetches can now
  prefer an `OVERPASS_ENDPOINT` deployment while retaining the public mirrors
  as fallbacks; no self-hosted endpoint is configured or acceptance-tested yet.
  - 31 Oct offline check: tests verify the configured endpoint is trimmed and
    tried first, and that a 503 falls back to the public Overpass mirrors. The
    focused lint and full suite (243 tests) pass. This does not validate a live
    Worker/VPS; endpoint configuration and deployment acceptance remain open.
  - 31 Oct deployment scaffold: `workers/overpass-proxy/` now contains a
    token-gated Worker for form-encoded interpreter POSTs, an optional separate
    origin credential, bounded request size, and no-store forwarding. The app
    sends `OVERPASS_ENDPOINT_TOKEN` only to a configured custom endpoint, never
    to the built-in public mirrors. Deployment instructions are in the Worker
    README. No VPS or Worker has been provisioned, so live acceptance remains
    open.
  - 31 Oct mirror audit: the official OSM instance list identifies
    `overpass.private.coffee` as the former `overpass.kumi.systems`; the
    current mirror list may therefore have only two independent global
    operators. A fresh tiny Pune query to Maps Mail returned HTTP 504; a query
    to Private.coffee timed out after 25 seconds. The primary global hostname
    and its two official individual servers also timed out on tiny queries.
    These are availability observations, not durable outage claims. See the
    [refresh-scope report](benchmarks/results/stage0/b3-demo-refresh-scope-2026-10-31.md).
  - 31 Oct follow-up: removed the old Kumi hostname from the runtime list so
    failed requests no longer spend two mirror slots on Private.coffee. Further
    tiny probes timed out at the primary and its direct `lz4` host, while the
    Taiwan global endpoint did not resolve from this host. The Britain and
    Ireland endpoint returned 200 for a small Edinburgh query but cannot serve
    the other Demo regions. At that point no replacement global endpoint had
    been verified; self-hosted/paid endpoint acceptance remains open. The 31 Oct
    review of the official OSM instance list found no regional public service
    for New York, Pune or Tokyo; Japan's community endpoint is discontinued.
    See the endpoint coverage review in the
    [refresh-scope report](benchmarks/results/stage0/b3-demo-refresh-scope-2026-10-31.md).
  - 31 Oct HPI endpoint observation: a read-only B3 stage selected
    `https://osm.hpi.de/overpass/api/interpreter` through `OVERPASS_ENDPOINT`.
    A 120-second full pass staged 32/36 cells, a 120-second resume reached
    34/36, and a 240-second resume reached 36/36; the offline verifier passed
    all candidates. This confirms full-cell reachability for these four Demo
    neighborhoods on that run, not a latency or uptime target. The HPI endpoint
    was not added to the runtime mirror list. See the
    [regional feasibility report](benchmarks/results/stage0/b2-regional-extract-feasibility-2026-10-31.md)
    and [B3 review](benchmarks/results/stage0/b3-demo-refresh-review-2026-10-31.md).
  - The official [Overpass installation guide](https://overpass-api.de/full_installation.html)
    recommends at least 4 GB RAM and at least 100 GB disk for a full-planet
    database without metadata or minutely diffs (250 GB with minutely updates).
    A low-cost VPS assumption is therefore not established. A regional
    alternative now has a concrete candidate: Geofabrik's New York, western
    India, Kantō and Scotland PBFs total about 1.5 GB compressed. Overpass needs
    PBF-to-XML conversion before import; the imported database size is unknown.
    `scripts/build-regional-overpass-source.sh` now downloads those extracts,
    validates checksums, and builds the merged no-metadata import file. Direct
    PBF-host probes timed out from this host, including a fresh 12-second HEAD
    request to the New York checksum sidecar (HTTP 000, no bytes), so the script
    remains unrun. A 31 Oct robustness follow-up bounds connection and transfer
    time and publishes the merged file plus manifest from temporary paths,
    cleaning partial output on failure. Git Bash syntax validation passes;
    curl, checksum tools, awk and
    realpath are available, but Osmium is not. WSL has only its Docker Desktop
    distro and the Docker engine is unavailable, so the import still needs a
    Linux host with Osmium. Measure the imported database before choosing
    infrastructure. See the
    [regional extract feasibility report](benchmarks/results/stage0/b2-regional-extract-feasibility-2026-10-31.md).
- [ ] **B3 — Procedural landuse ground (S–M).** Asphalt, grass, paving and
  water materials from landuse polygons instead of the near-white Carto
  raster; extends D1.
  - 30 Oct, branch `b3-landuse`, first step: `lib/engine/ground-surfaces.js`
    classifies areas into surface kinds. Parks, gardens, grass and pitches get
    a tiling grass texture; car parks get asphalt grain; pedestrian areas and
    squares get the sidewalk paving (pedestrian areas stay walkable roads).
    Surfaces use world-space UVs and merge into one mesh per kind per cell,
    which also cuts draw calls (previously one mesh per area). This uses tags
    already in cached cells (Tokyo start cell: 44 car parks, 17 pedestrian
    areas, 28 park/grass; Edinburgh: 79, 16, 63; Pune: few), so no reseed is
    needed. Unit tests cover classification, UVs and merging.
  - 30 Oct, second step: surfaces follow the terrain. Each area is meshed
    with edge points and an interior grid about 10 m apart (capped at 3,000
    triangles) and every vertex sits on the rendered terrain triangles plus
    its lift; triangles over terrain that is not loaded are left out instead
    of being buried at height 0 or floating. Multi-storey car parks tagged
    `building` now build as buildings (they were drawn as flat ground), and
    underground, rooftop and raised (`layer` ≠ 0) areas are no longer ground.
    Browser audit on the local build: Edinburgh grass, car parks, plazas,
    playgrounds and water all within 0.3 m of the terrain (car parks
    previously floated up to 12 m); zero console errors.
  - 30 Oct, third step (code only): urban land use (residential, commercial,
    retail, industrial, railway, construction, brownfield, wasteland,
    cemetery, allotments, recreation grounds) is fetched by the Overpass query
    and painted into the terrain ground canvas under roads and building
    shadows, replacing the pale map raster there. Painting instead of meshing
    adds no draw calls or overdraw, and rides on the existing canvas upload.
  - 30 Oct, fourth step: tagged urban land-use multipolygon relations are now
    requested from Overpass and their way members are stitched into closed
    outer/inner rings. Incomplete chains are dropped, and ring winding is
    normalized so inner holes remain empty in the shared nonzero-fill canvas
    path. Focused tests cover reversed/out-of-order members, holes and broken
    chains. A read-only OSM API sample from Edinburgh relation `2344206`
    (cemetery; 10 outer member ways) stitched into one closed 32-point ring.
    The OSM API sample validated real member geometry. At that time the
    Overpass query remained unverified: the primary endpoint returned 406
    without the app User-Agent and timed out with it; both configured mirrors
    timed out. The later live result is recorded below.
    See [the live-data check](benchmarks/results/stage0/b3-multipolygon-live-check-2026-10-30.md).
  - 31 Oct follow-up: the full Edinburgh request exhausted the three-mirror
    budget; the focused relation query got HTTP 502 at the primary (queue full)
    and timed out on both backups. A real OSM API relation passed through
    `buildCityGeometry` and produced one closed 32-point ring. At that point,
    this confirmed builder integration but not Overpass query delivery or a
    full-city build; the later live result is recorded below.
    See the [updated live-data check](benchmarks/results/stage0/b3-multipolygon-live-check-2026-10-30.md).
  - 31 Oct live check: the Britain and Ireland Overpass endpoint returned the
    cemetery relation and a full 650 m Edinburgh cell. The full query exposed
    an unquoted `building:part` key; it is now quoted and covered by a query
    test. One unrelated coastline way had null geometry vertices and is dropped
    individually so it cannot invalidate an otherwise complete cell. The
    validated 3,370-element cell passed the city builder with a closed cemetery
    ring. The full suite (238 tests) and production build pass. See the
    [updated live-data check](benchmarks/results/stage0/b3-multipolygon-live-check-2026-10-30.md).
  - 31 Oct canvas-order follow-up: asynchronous terrain imagery and B3/road
    paint shared a canvas, so a late image response could erase already-painted
    surfaces. Per-cell paint now batches into a retained per-tile overlay and
    is composited again after imagery finishes. The road-paint diagnostic
    records land-use ring and painted-tile counts. A visible Chrome replay of
    recorded Edinburgh data, after streamed cells loaded, showed the cemetery
    tint with 18 rings across 12 tile-paint events, zero browser or HTTP errors,
    and 16.9 ms frame p95 on the RTX 4060 host. This is not target-laptop or
    live-cache acceptance. See the [ground-overlay follow-up](benchmarks/results/stage0/b3-ground-overlay-2026-10-31.md)
    and [capture](screenshots/performance-visuals/stage0/b3-landuse/edinburgh-recorded-overlay-after-stream-2026-10-31.png).
  - 31 Oct staging safeguard: `scripts/stage-city-refresh.mjs` prepares local
    originals, candidate payloads and per-cell SHA-256 manifest entries. It
    reads existing cells through configured private R2 credentials or the
    deployment's public read proxy, checks complete-cell validity and the 90%
    building-retention threshold, carries forward enrichment, and never
    uploads. `--place` can stage one city's nine-cell neighborhood at a time,
    and `--key` isolates a single cell for retry. The explicit
    `--allow-out-of-group-key` permits a one-off key outside the selected
    group; add `--stage-new-cell` when the public cache has no original object.
    The new-cell mode writes a local candidate and manifest only.
    SIGINT and SIGTERM now save an `incomplete` manifest with the interruption
    signal and timestamp before stopping the process.
    A batch is `ready` only when every requested cell passes. The
    direct `seed-direct --refresh` path now refuses to run so a later cell
    failure cannot silently leave a mixed cache group. Run with
    `npm run seed:stage-refresh`; no private R2 credentials are required when
    `NEXT_PUBLIC_R2_PUBLIC_BASE` points at a public city-cache endpoint. All
    nine New York demo cells returned read-only HEAD 200 through the deployment
    proxy. A full Demo staging attempt with 45-second request budgets timed out
    twice on its first two Pune cells; it was stopped before R2 writes (which
    this script cannot perform). A later Pune-only stage used 120-second
    budgets and concurrency 2; four cells failed after both attempts (one final
    HTTP 502 and three timeouts), while five remained pending. That local batch
    is marked incomplete and was stopped after repeated mirror failures. No R2
    writes occurred. The initial Edinburgh stage reported 7/9: its
    two rejected candidates used `building:part` ways that the renderer already
    draws, but the old gate counted only `building` ways. Staging and verification
    now share a renderable-way count covering both tags. Offline re-evaluation of
    the nine saved Edinburgh cells passes 9/9; same-ID building retention ranges
    from 98.2% to 99.8%. The two formerly rejected cells retain 1,880/1,891
    (99.4%) and 1,964/2,000 (98.2%) original building-way IDs. The review set
    combines seven cells from the city stage and two preserved single-cell runs.
    No R2 write occurred; the full 36-cell batch remains open.
  - 31 Oct retry: the three outer New York cells used by the failed 0.8
    boundary run still return public-cache HEAD 404. The primary global
    Overpass endpoint and its direct `lz4` host timed out on tiny queries, and
    the Taiwan endpoint did not resolve here. A small query succeeded on the
    Britain and Ireland server, which is outside the New York/Tokyo regions;
    no new candidates were staged. See the endpoint checks in the
    [refresh-scope report](benchmarks/results/stage0/b3-demo-refresh-scope-2026-10-31.md).
    A standard OSM map-API probe for one missing New York cell returned 13.3 MB
    (28,064 nodes, 6,748 ways, 686 relations). OSM guidance says the main API is
    for editing rather than data downloads and recommends Overpass for area
    extraction, so this was not used as a staging fallback. No payload was
    saved and no candidate was staged; see the linked report.
  - 31 Oct 0.8 follow-up: the three missing New York east-strip cells were
    staged locally from HPI and passed the cell verifier. The city-cache
    uploader now supports one-cell `create` manifests with a live absence
    preflight and atomic R2 `If-None-Match: *` writes; refresh uploads retain
    their original-hash checks and rollback behavior. Local dry runs passed for
    all three creates and the existing 36-cell refresh. No R2 writes occurred.
    See the [boundary candidate replay report](benchmarks/results/stage0/0.8-new-york-boundary-candidate-replay-2026-10-31.md).
  - Local review command: `npm run seed:verify-refresh -- --stage-dir=<path>`
    checks manifest completeness, payload hashes, city validity, the 90%
    building threshold and retained enrichment without contacting R2.
  - An incomplete batch can resume with `--resume --stage-dir=<path>`. Resume
    requires the same group, filters and cell set, validates every ready
    original/candidate pair against its saved hashes and refresh rules, then
    retries only pending or failed cells. It accepts earlier refresh manifests
    with implicit refresh actions or omitted null filters, verifies legacy
    building-only counts, and normalizes them to the current rule before
    retrying. A missing or altered ready payload stops the run instead of
    silently accepting a partial review set.
  - 31 Oct resumed the saved Edinburgh batch: the regional Britain and Ireland
    endpoint supplied its two failed cells, the seven saved cells passed resume
    validation, and the local stage verifier passed 9/9. This is one completed
    Demo city group; the other three groups and all R2/live acceptance gates
    remain open. See the [refresh-scope report](benchmarks/results/stage0/b3-demo-refresh-scope-2026-10-31.md).
  - 31 Oct staged-candidate replay: the verifier passed 9/9, and visible Chrome
    replayed the local candidates through the deployed street app with 9/9 cells
    resident, zero console errors, and all queues settled. Enabled diagnostics
    counted 29 landuse rings across 8 painted tiles. The 60-frame p95 was 16.9 ms
    on this non-target host and is diagnostic only. No R2 writes occurred. See
    the [replay report](benchmarks/results/stage0/b3-edinburgh-staged-replay-2026-10-31.md)
    and [capture](screenshots/performance-visuals/stage0/b3-landuse/edinburgh-staged-candidate-replay-2026-10-31.jpg).
  - 31 Oct pre-refresh baseline: a read-only snapshot of all 36 currently cached
    Demo cells loaded and settled 9/9 in Pune, Edinburgh, Tokyo and New York,
    with zero console errors. Diagnostics recorded zero landuse rings and zero
    landuse-painted tiles in each current cache; the staged Edinburgh candidate
    replay, by comparison, painted 29 rings across 8 tiles. This is a before-
    refresh baseline, not post-refresh acceptance; no R2 writes occurred. See
    the [baseline report](benchmarks/results/stage0/b3-pre-refresh-cache-baseline-2026-10-31.md)
    and [cell hash manifest](benchmarks/results/stage0/b3-pre-refresh-cache-cells-2026-10-31.json).
  - 31 Oct source recheck: the public cache still returns HTTP 200, but all
    three listed global no-key Overpass services timed out on a small Pune
    query; all four Geofabrik regional PBF HEAD requests also timed out. No
    candidates or R2 writes resulted. See the source checks in the
    [refresh-scope report](benchmarks/results/stage0/b3-demo-refresh-scope-2026-10-31.md)
    and [B2 feasibility report](benchmarks/results/stage0/b2-regional-extract-feasibility-2026-10-31.md).
  - 31 Oct HPI mirror follow-up: the public HPI Overpass endpoint supplied all
    nine Tokyo cache-version-6 candidates. The offline refresh verifier passed
    9/9, retaining at least 100% of each cell's renderable building ways. At
    the captured full-batch snapshot, 27/36 cells were ready, one Pune cell had
    failed after retries, and eight New York cells were pending. The run remains
    local-only; no R2 writes occurred. See the
    [Tokyo stage report](benchmarks/results/stage0/b3-tokyo-refresh-stage-2026-10-31.md).
  - 31 Oct full refresh review: the HPI mirror supplied all 36 unique
    cache-version-6 cells. The offline verifier passed 36/36; the lowest
    same-way-ID retention in a cell was 94.0%. A visible-Chrome replay of the
    local candidates settled 9/9 cells in each city with zero console errors
    and 212 painted landuse rings across 47 tiles. Its 60-frame diagnostic
    p95 is not target-hardware acceptance. See the
    [full refresh review](benchmarks/results/stage0/b3-demo-refresh-review-2026-10-31.md),
    [refresh scope](benchmarks/results/stage0/b3-demo-refresh-scope-2026-10-31.md)
    and [candidate screenshots](screenshots/performance-visuals/stage0/b3-demo-candidate-replay-2026-10-31/).
    No R2 writes occurred. Open: get separate approval before uploading these
    candidates with `npm run seed:upload-refresh -- --stage-dir=<path> --apply
    --manifest-sha256=<approved hash>`, then verify the deployed cache and
    capture live four-city visual and performance acceptance. The upload script
    preflights all originals and records rollback status. `.env.local` has no
    `R2_*` credentials in this checkout.
- [ ] **B4 — Overture gap fill (S).** The Overture footprint fallback already
  exists for sparse cells. Remaining: merge Overture height, num_floors,
  roof_shape, roof_color, facade_color and facade_material into OSM buildings
  that lack them, in the baker (coverage is sparse). **31 Oct implementation:**
  Overture query rows now carry those fields and their OpenStreetMap source way
  IDs; the baker matches IDs such as `w…@version` and patches only missing OSM
  tags. Existing OSM values take precedence, and facade/roof color spelling
  plus Overture material enums reach the current renderer. Production build
  passes; lint passes with 15 existing warnings. The R2-backed Edinburgh
  enrichment dry run could not start because `.env.local` has no R2
  configuration. A direct public-data coverage dry run is recorded below;
  production-cell acceptance and upload remain open. See the
  [Overture Building schema](https://docs.overturemaps.org/schema/reference/buildings/building/).
  - 31 Oct offline follow-up: focused tests cover all six fields, value
    normalization, existing OSM/enrichment precedence, invalid values and
    applying the generated patch. They exposed `building=no` ways being treated
    as matchable buildings; the matcher now excludes them. Focused lint, all
    241 tests and the production build pass. This validates the local merge;
    R2-backed dry-run and upload acceptance remain open.
  - 31 Oct direct live-data coverage: all 36 complete Demo cache cells were
    read through the public proxy and matched against the reviewed
    `2026-10-21.0` manifest via public Overture S3. The production patch
    function found OSM-linked rows in all four cities: Pune had no missing
    fields; Edinburgh filled 56–107 heights per cell; Tokyo filled up to 823
    buildings per cell with height/level tags; New York filled 61–139 per cell
    with height/level tags plus three `building:material` patches in total.
    Eight cells hit the old 3,000-row query cap. A 10,000-row diagnostic found
    a maximum of 4,770 rows and 585 additional patchable Tokyo buildings across
    those cells. The local runtime cap is now 5,000. The largest measured
    response was 1.47 MB raw (215 KB gzipped). No R2 writes occurred; the
    deployment index remains absent, so runtime API acceptance and upload
    remain open. See the
    [live coverage report](benchmarks/results/stage0/b4-overture-live-coverage-2026-10-31.md).
    `node --check lib/overtureServer.js` and `npm run build` pass on
    `ae4bb84`; the build stamped service-worker revision
    `7c4d59020935177c`.
  - 31 Oct local index recheck: the CLI rebuilt 512 entries for
    `2026-10-21.0`; all 512 filename/bounds tuples match the reviewed manifest
    (ordering differs). Using the production route's bounding-box predicates,
    every cell in the recorded 36-cell Demo baseline intersects one or two
    indexed Parquet bounds. The output is local-only; no R2 request or write
    occurred. See the
    [local index recheck](benchmarks/results/stage0/b4-overture-local-index-recheck-2026-10-31.md).
  - A guarded uploader is available as `npm run overture:upload-index`. Its
    local dry run validated the reviewed 512-file manifest, coverage for all
    36 Demo cells, and upload-body SHA-256
    `556fce03a2bba85bf3ed963b12b2b96302ca89597f7e1d0ab1e261aa813f4570`.
    It made no R2 request or write. Production upload still requires separate
    approval and R2 credentials, then deployed API acceptance.
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
| 6–8 Alternatives | B1 infrastructure measured and parked (not shipped); Stage 6/7 deferred | Reopen B1 only through B1b cached elevation grids; other B1 acceptance remains outside the active track |
| 9 Integration | Open | Full regression, hardware/visual acceptance and release records |

Latest local validation: all 217 tests and the production build pass on
`23a34cc`, including the R7 opt-in loader and street-travel UI fix.
Earlier review run: all 207 tests across 33 files and the production build passed,
including the B1 codec, frame transform, terrain revision and streamed-cell
overlap-index fallback checks. Raw and prebuilt production builds both pass.
The four-city production rehearsal loaded all 36 nearby
cells and had zero console errors. The B1 local production-preview smoke loaded
the baked Tokyo spawn cell and settled its neighbor stream. This review does not
rerun the full device performance matrix or prove release readiness. The new
regression covers the reproduced streamed prebuilt ownership conflict; device,
editor and lifecycle acceptance remain open.

The earlier 29 October recorded-Rome smoke reached movement but failed its
browser diagnostic gate with four app-origin HTTP 404 responses. A follow-up
identified a missing local `/prebuilt-cells/index.json`; the R7 change makes
prebuilt lookup opt-in because B1 artifacts are not published. That recorded run
sampled only 14 frames over 1.067 seconds while startup and cell loading were
active, so its 13 FPS and 216.8 ms p95 are not performance acceptance data. A
separate local check had also seen the configured public-R2 city fetch blocked
by CORS. The post-deploy `71450de` tour now accounts for that path and returned no
HTTP errors; the `23a34cc` settled five-second smoke closes R7. See R7 and the
[S7 live-deploy report](benchmarks/results/stage0/s7-live-deploy-2026-10-29.md).

### Priority issues found in this review

R1–R3 closed on 30 October after current-main browser and WebGL audits. R4 is
closed with browser and WebGL object-count evidence. R6's evidence labels are
reconciled. Preserve gameplay and fallbacks.

- [x] **R1 — P1: Validate the road-specific environment intensity fix.**
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
  Roads explicitly bind the current PMREM texture, including newly streamed
  materials; the shared-resource list protects it during cell eviction. A unit
  check covers replacement and inheritance. On 30 October, visible Chrome
  recorded-Rome close-ups showed a restrained wet sheen against the matched
  matte clear road. Five valid runs per condition had identical 41.70 ms frame
  p95 medians; GPU timer p95 medians were 26.67 ms clear and 27.15 ms rain, with
  overlapping ranges. The current-main WebGL audit observed the expected 2.71
  road intensity and stable 22 framebuffer / 2 renderbuffer counts over seven
  snapshots. See the [close-up and performance report](benchmarks/results/stage4/r1-closeup-environment-check-2026-10-30.md)
  and [environment audit](benchmarks/results/stage4/environment-resource-audit.md).
  The 3D engine ran near 93% utilization on this Intel UHD host; target-device
  behavior is not established. Stage 4.3's wider wet-road tuning and acceptance
  remains open.

- [x] **R2 — P1: Validate PMREM output target ownership.**
  Previously [env-map.js](lib/engine/env-map.js) kept only
  `pmrem.fromEquirectangular(tex).texture` and disposed that texture on updates.
  The returned render target owns framebuffer/depth attachments; the installed
  renderer releases those through the render target's dispose event
  (`WebGLTextures.js:320–323,380+`). Repeated quantized time/weather updates
  bypassed that teardown. The whole output target is now disposed on replacement
  and shutdown, with scene references cleared safely. Verify repeated time/weather
  cycles on one renderer with framebuffer/renderbuffer accounting, since stable
  `renderer.info.memory.textures` alone cannot establish this.
  Implementation retains and disposes each PMREM target, clears only its own
  scene reference, and preserves the previous environment if generation fails.
  On 30 October, 24 day/night cycles produced 25 snapshots with stable counts
  of 22 framebuffers and 2 renderbuffers; `envMapIntensity` included 2.71. A
  real Globe-view navigation unmounted StreetEngine and released all active
  WebGL objects: counts fell from 22/2 to 0/0 after the detached context was
  lost, with 19 framebuffer and 2 renderbuffer deletions observed. The teardown
  audit also found and fixed a missing directional-light shadow-target dispose.
  See the [PMREM and engine teardown report](benchmarks/results/stage4/r2-pmrem-target-teardown-2026-10-30.md).
  This is one Intel UHD/Chrome run; other GPUs and multi-hour soak behavior are
  not established.

- [x] **R3 — P2: Validate post-processing pass disposal.**
  Previously [post-fx.js](lib/engine/post-fx.js) called only `composer.dispose()`.
  Three.js 0.186.1's EffectComposer disposes its two buffers and copy pass, but
  does not dispose added SSAO, bloom or output passes. The owned passes are now
  disposed exactly once before releasing the composer. Check repeated
  engine entry/exit and their render-target/material cleanup; the existing
  quality-policy tests do not exercise teardown.
  The controller now disposes these passes once, including the SSAO material
  and noise texture omitted by Three.js's SSAO pass disposer. The lifecycle
  unit check covers repeated disposal. On 30 October, three full high-quality
  StreetEngine entries/exits in headed Chrome 156 on Intel UHD each started
  with 22 framebuffers and 2 renderbuffers. Teardown explicitly deleted 19
  framebuffers, both renderbuffers, 51–55 textures and 64–65 shader programs
  per cycle. The same 3 framebuffer, 6 texture and 5 program handles remained
  tracked before context loss in every cycle; creation stacks identify the
  framebuffers as Three.js renderer scratch targets, while the texture/program
  handles are not individually attributed. All three canvases detached and
  their contexts were lost with no browser or network errors. The separate
  six-cycle PMREM audit also held steady at 22/2. See the [post-processing
  teardown report](benchmarks/results/stage4/r3-postfx-teardown-2026-10-30.md).
  This is one device/browser run; it does not measure VRAM bytes or establish
  behavior on other GPUs.

- [x] **R4 — P2: Validate atlas-layout fallback and texture disposal.**
  Previously [ktx2-textures.js](lib/engine/ktx2-textures.js) parsed the layout
  after transcodes and outside the cleanup-protected callback block. Invalid JSON
  could bypass `disposeParsed()`. The loader now validates the layout before
  transcodes and guards payload construction. Verify malformed JSON and
  missing/invalid rectangle entries keep procedural/shared maps operational and
  release all successfully decoded textures once. The loader now validates
  required atlas rectangles and dimensions before high transcodes, and guards
  all subsequent payload construction and installation.
  Unit checks cover invalid JSON/rectangles, shared fallback and disposal after an
  installation error. A visible Chrome run with service workers blocked injected
  invalid JSON, observed the fallback, retained shared maps and moved 4.09 m;
  [browser evidence](benchmarks/results/stage3/invalid-layout-browser-check.md).
  A second visible Chrome run injected valid JSON with an out-of-bounds
  `Bricks060` rectangle; the schema fallback retained shared maps and the player
  moved 4.59 m. Both browser failure cases are recorded in
  [schema-invalid browser evidence](benchmarks/results/stage3/invalid-layout-schema-browser-check.md).
  Cached asset/route offline responses and an uncached network failure are now
  verified in Chrome. The follow-up run also confirmed the uncached request
  rejects with Chrome offline and no cache entry. A live GPU disposal audit
  recorded four high KTX2 texture allocations, followed by 21 WebGL texture
  deletions and a 21-handle live-count decrease during the low-quality transition
  on Intel UHD Graphics. This is renderer object-count evidence, not a direct
  VRAM-byte measurement. [GPU disposal report](benchmarks/results/stage3/ktx2-disposal-audit-2026-10-30.md).
  [Latest service-worker report](benchmarks/results/stage3/service-worker-offline-miss-check-2026-10-30.md);
  [earlier cache-only report](benchmarks/results/stage3/service-worker-offline-check.md).

- [x] **R5 — P2: Evaluate the benchmark-only wet-road map.**
  [materials.js](lib/engine/materials.js) switches to a shared 64×64
  roughness texture at `wetness >= 0.3`; the product continues to use the
  baseline map. A fixed-pose check confirmed no map/upload at weather 29 and
  one shared 64×64 canvas upload at weather 31. Five baseline/candidate runs
  per condition had identical frame-p95 medians (41.60 ms) and overlapping
  ranges; GPU-p95 medians were 26.278 and 26.291 ms, also with overlapping
  ranges. The first upload raised renderer texture count by one; its JS upload
  submission took 0.0–0.1 ms, with first residency 4.1–22.3 ms. Matched
  close-ups show the texture adds broken-up wet highlights at rain, while the
  0.3 threshold makes a patchy pattern appear abruptly just above the switch.
  No visual or performance gain justifies accepting it. Keep the baseline as
  the product default and leave broader road tuning open in 4.3. See the
  [matched capture and performance report](benchmarks/results/stage4/r5-wet-road-map-evaluation-2026-10-30.md).

- [x] **R7 — P2: Close the current production-smoke diagnostics and live-data gap.**
  The current-main recorded-Rome run reached valid movement, but its browser
  diagnostics failed on four app-origin 404 responses. A bounded follow-up found
  `/prebuilt-cells/index.json` missing in this checkout; the prebuilt loader
  returned `null` on that miss and continued through the raw-data path. Since
  B1 artifacts are intentionally not shipped, the loader now skips prebuilt
  lookup unless `NEXT_PUBLIC_PREBUILT_CELL_BASE` is explicitly configured. A
  regression check verifies that an unconfigured base causes no request; the
  full suite and production build pass. A direct production request confirms
  `/prebuilt-cells/index.json` returns 404, while the opt-in loader no longer
  requests it when no base is configured. The complete post-deploy S7 tour on
  `71450de` recorded no HTTP responses >=400 and no console errors. A GET of the
  live Tokyo R2 cell from the production origin returned 200 JSON with 3,665
  elements and was readable by page JavaScript, closing the earlier R2 CORS
  uncertainty. A separate settled five-second visible-browser smoke on
  `23a34cc` recorded 377 frames at p95 20.9 ms and max 152.8 ms, with the page
  visible/focused and no console or HTTP errors. It also confirmed that fast
  travel closes its panel and updates the destination label. The earlier
  startup-only 14-frame sample remains invalid for performance acceptance; this
  single settled window does not replace the matched repetitions required before
  accepting a default or quality-tier change.

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
  - Keep recorded-city cache/boundary results separate from live Overpass latency.
  - Repeat resource/thermal soak on real mobile hardware; direct thermal readings
    were unavailable on the tested Windows desktop.

  31 Oct exploratory probes: four single-run New York local-dev cold/warm
  origin-cell walk/drive captures used the public city-cache read path and made
  no `/api/city` cell requests; they did not cross a cell boundary. Two single-run
  Edinburgh local-dev captures crossed and validated a boundary through the
  regional Overpass-backed city API. A corrected New York cold walk on the
  production origin (build `58c8366`) passed its eight-second measurement with
  no city API requests, but reproduced ten >100 ms frame gaps (p95 466.5 ms,
  p99 516.6 ms). A later production cold-walk boundary attempt on this host
  crossed New York's expected east cell, but did not settle: its next eastern
  strip of three cells was absent from the public cache (HEAD 404), and two
  city API requests returned 502 while a third remained incomplete. The 12 s
  measurement window itself was valid, but the cell-stream gate failed, so its
  frame data is diagnostic only and is excluded from baseline captures. See the
  [probe report](benchmarks/results/stage0/0.8-live-cache-probes-2026-10-31.md).
  A production Chrome trace then found ten 486–600.5 ms gaps
  between `FireAnimationFrame` events; every gap overlapped a 485.3–528.3 ms
  `DXGISwapChainImageBacking::Present` call. One app animation callback also
  blocked 495.2 ms in a WebGL framebuffer-status/command-buffer wait. This
  localizes the current lead to DXGI presentation and one synchronous WebGL wait,
  but target i5-1035G1 confirmation is still required. The six local samples
  remain dirty and single-run; there is no production boundary matrix. They do
  not close 0.8. See [the probe report](benchmarks/results/stage0/0.8-live-cache-probes-2026-10-31.md).
  A local-only follow-up staged the three missing New York east-strip cells from
  HPI, verified each candidate, and replayed one recorded-fixture walk and drive
  across the boundary. Both settled at 10/10 resident cells with zero failed
  cells or browser errors. Chrome used the RTX 4060 on the i7 host; the runs do
  not count as production or target-i5 acceptance. See the
  [candidate replay report](benchmarks/results/stage0/0.8-new-york-boundary-candidate-replay-2026-10-31.md).

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

Exit remains open: lower-memory/mobile residency, and far mip seams (gutters
fall below one pixel after mip 4). Production browser checks verified
offline service-worker responses for shared/high facade KTX2, the atlas layout,
the Basis WASM decoder, and the cached street route. Its local loopback server
remained reachable with Chromium offline mode enabled, so that run could not
verify an uncached failure. A later Chrome run forced an uncached network reset
and separately checked an uncached fetch while offline; see
[the follow-up report](benchmarks/results/stage3/service-worker-offline-miss-check-2026-10-30.md).
This does not exercise an interactive scene with a missing runtime atlas.
The live disposal audit counts renderer texture objects and WebGL deletion calls;
it cannot report physical VRAM bytes. Three.js exposes combined worker/WASM/transcode
timing and upload submission, not separate compile or GPU-upload completion.
Publication is separate release work.

## 8. Stage 4 — Roads, lighting and regional appearance

- [x] 4.1 Fixed reference poses and day/dusk/night/rain lighting controls.
- [x] 4.2 Refined existing road ribbons, markings, scale and terrain fit.
  [Review](benchmarks/results/stage4/road-ribbons.md).
- [x] 4.3 Finish wet-road tuning and close-up acceptance. New materials inherit
  weather; procedural textures are seeded and diffuse
  darkening is reversible. Current-build fixed-pose captures at 21:00 show the
  baseline road matte in clear weather and a restrained blue sheen with a lamp
  reflection in rain. The five-run R1 frame p95 medians were both 41.70 ms;
  GPU p95 medians 26.67/27.15 ms had overlapping ranges. R5 rejected the
  thresholded texture for its abrupt patch pattern and lack of measured gain.
  Keep the baseline map. See the [Stage 4.3 acceptance report](benchmarks/results/stage4/stage4-wet-road-acceptance-2026-10-30.md),
  [R1 validation](benchmarks/results/stage4/r1-closeup-environment-check-2026-10-30.md),
  and [R5 evaluation](benchmarks/results/stage4/r5-wet-road-map-evaluation-2026-10-30.md).
  SSR/planar reflection and mobile portability remain deferred to stage-wide
  review.
- [x] 4.4 Desktop four-light pool, quality/time transitions and streamed/evicted
  markers verified. Five static runs per policy: hiding inactive lights reduced
  median GPU p95 13.18 → 10.68 ms, with overlapping ranges. Two transition pairs
  reproduced 2.72–2.87 s first-night stalls and +18 programs when hidden; visible
  lights stayed at 87 programs. Retain visible inactive lights.
  [Policy report](benchmarks/results/stage4/inactive-light-policy-checkpoint.md),
  [stream lifecycle](benchmarks/results/stage4/lamp-stream-lifecycle.md).
  Device labels are reconciled in R6; mobile portability remains open.
- [x] 4.5 Finish bloom halo/daytime washout review and compare cheaper contact
  shading before changing High defaults. Same-page High captures show a soft
  visible halo around lit windows and a broader wet-road lamp reflection with
  bloom on; noon bloom causes no material washout. At the close facade pose,
  SSAO adds no clearly visible contact contrast over the existing batched tile
  shadows. The five-run pass comparison still shows a large Intel UHD cost for
  SSAO (33.81 ms GPU p95 versus 15.65 ms bloom-only, non-overlapping ranges).
  Keep High defaults unchanged pending mobile review; R3 teardown is validated.
  See the [Stage 4.5 closeout](benchmarks/results/stage4/stage45-postfx-acceptance-2026-10-30.md),
  [SSAO comparison](benchmarks/results/stage4/postfx-ssao-checkpoint.md), and
  [R3 teardown audit](benchmarks/results/stage4/r3-postfx-teardown-2026-10-30.md).
- [x] 4.6 Retain quantized PMREM/shadow updates and validate R2 ownership. Two
  order-reversed rooftop comparisons removed 3 shadow draw calls and 2,228
  shadow triangles, but shadow-submit CPU cost was only 0–0.1 ms and full-frame
  GPU changes reversed with run order. Pruning also removed visible contact
  shadows under rooftop props. Keep their shadows enabled; retain the existing
  batched tile shadows as the contact baseline. See the [Stage 4.6 acceptance](benchmarks/results/stage4/stage46-shadow-acceptance-2026-10-30.md)
  and [R2 ownership audit](benchmarks/results/stage4/r2-pmrem-target-teardown-2026-10-30.md).
- [x] 4.7 Improve facade/storefront variation and baked trim/dirt/reveals.
  **Desktop accepted, 31 Oct:** the shared atlas bakes window recesses, frames,
  sills, grime and storefront details; deterministic facade variation and the
  D8 four-city captures confirm shopfronts and entrances in the demo starts.
  A controlled 60.3° Rome facade A/B confirms the tangent UV mapping restores
  the intended 8.3 m repeat versus 6.1 m before, without visible seams. No
  additional near-entrance geometry is warranted by these captures. Keep
  parallax, displacement, fragment noise and triplanar deferred; Stage 4 mobile
  visual/performance review remains an overall exit gate. See the [facade UV
  checkpoint](benchmarks/results/stage4/stage47-facade-uv-review-2026-10-31.md)
  and [four-city demo captures](screenshots/demo-track/rehearsal-2026-10-28-post-heading/).

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
and keeps bloom active while toggling only SSAO. `--bloom-mode on|off` isolates
bloom, and `--postfx-pair bloom|ssao` captures off/on screenshots sequentially
in one browser page at the same pose. Saved metadata and the run fail if the
requested pass state did not persist through the measurement.

Proposed evidence locations:

    benchmarks/fixtures/<city-or-stress-case>.json
    benchmarks/results/<stage>/<revision>-<device>-<scenario>.json
    benchmarks/results/<stage>/decision.md
    screenshots/performance-visuals/<stage>/<matched-pose>.png

Keep personal/large raw traces out of routine commits. Each decision describes
matched settings, tested hardware, thresholds and remaining gates.

## 15. Next action and deferred choices

0. Finish the smoothness track (section 0a): S7 live confirmation on the target
   laptop, then S8 render-scale confirmation on that laptop. S9's real-input
   check is closed. SEC1 (Next.js upgrade) must close before
   any public release; use [docs/UPGRADE-ASSESSMENT.md](docs/UPGRADE-ASSESSMENT.md).
1. B1 is parked (see its 29 Oct decision): artifacts stay local and are not
   published. Next data work is B3 (procedural landuse ground, most visible for
   the demo). The corrected Edinburgh review is complete. Resume the remaining
   per-city Demo staging when Overpass requests complete within budget, then seek
   separate approval before any R2 write. After B3, continue B2 (Overpass
   independence) and B4 (Overture attribute gap fill). Reopen B1 only through
   B1b (cached
   elevation grids for cold loads).
2. Consider C1–C3 only after the data foundation, and only when a measured
   viewer-visible benefit justifies their cost. The remaining release gates
   include 0.8 live dense-city baselines, 1.3 physical low-core validation,
    cross-device confirmation for R1–R3, Stage 4 mobile visual/performance
    review, and Stages 5 and 9 integration/hardware acceptance.
3. Keep R5 wet-road work and conditional Stages 6–8 deferred unless a demo
   viewer or measured profile makes them a priority.

Rust/Wasm/SIMD remains deferred: an earlier synthetic trace measured worker
compute at 25.9 ms median versus 729.4 ms roundtrip. That trace does not establish
a geometry bottleneck or predict full application gains. WebGPU/TSL requires
migration of shader patches/post-processing. Wasm threads require an identified
use case and verified cross-origin isolation. SSR, volumetrics, displacement,
dense skeletal crowds and per-lamp shadow arrays need separate budgets.

Detailed historical runs, exclusions and earlier validation counts are in the
[archived checkpoint](docs/PLAN-CHECKPOINT-2026-10-28-BEFORE-REVIEW.md). Use the
current plan's open gates and the source-linked decision reports for next work.
