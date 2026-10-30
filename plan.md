# Walk the World — Performance and Visuals Implementation Plan

Updated: 30 October 2026. Reviewed base: `021f55b` on `origin/main`.
Demo gates D1–D8 are closed. The smoothness track (section 0a) closed S1–S6 from
live-deploy profiling; S7–S8 stay open. S9's real-input check did not reproduce
the hang on 30 October. S7 has a candidate fix (`be2ff98`,
off-thread tile decode) awaiting one target-laptop run. The `87d26dc`
interior-window cutoff was reverted: its gain was not repeatable and it shortened
the interior view. A separate far-facade detail fade was rejected after GPU-timer
p95 increased in all four cities. S8's 0.85 integrated-Intel render-scale
candidate passed the four-city host comparison; target-laptop measurement
remains. The dependency audit is clean, but SEC1's live-data browser acceptance
is still open. B3 now includes multipolygon relation support; the real OSM
member geometry stitched successfully, while the Overpass query and R2 reseed
remain open (see B3 below).
This is the active plan. The [previous detailed checkpoint](docs/PLAN-CHECKPOINT-2026-10-28-BEFORE-REVIEW.md)
preserves the full experiment history; its status is historical.

## Release gate — supported framework and dependency audit

- [ ] **SEC1 — P1 before public release: Upgrade the unsupported Next.js 14 tree.**
  **30 Oct, branch `sec1-next16`: code done, browser acceptance open.** Next
  16.4.3 (Turbopack build), React/React DOM 19.3.1, ESLint 9 flat config
  (`eslint.config.mjs`; `next lint` is gone), `@duckdb/node-api` 1.4.5-r.1
  replacing the deprecated `duckdb` package and its node-gyp/tar chain, plus
  non-forced `npm audit fix`. Next 15.5.28 was skipped: its bundled postcss
  still audits high. Route handlers await `params`; `serverExternalPackages`
  replaces the experimental key. On 30 Oct at `021f55b`, both full and
  production-only `npm audit` reported 0 findings, all 234 tests passed, lint
  had 0 errors (15 warnings), and the production build passed. Earlier local
  `next start` checks served `/`, `/street`, `/editor` and city/edit/asset API
  routes with expected status codes.
  A private-window dev browser pass on 30 Oct, with `reactStrictMode: true`,
  exercised globe → Pune street → globe navigation. The route mounted and
  returned without a Next.js issue badge, but city data stayed at “Streaming
  city”: the Pune API request returned 502 after 85 s, then 200 after a 16.9 s
  retry, without rendering nearby streets. Local R2 and the public cell base
  were both unconfigured, so no cache write was possible. A separate regular
  Brave run showed a hydration mismatch caused by extension-injected `<html>`
  and `<body>` attributes; it did not appear in the private window. See [the
  browser acceptance check](benchmarks/results/stage0/sec1-next16-browser-acceptance-2026-10-30.md).
  Still open: the live DuckDB Overture query against S3 (writes results to R2)
  and a full four-city run with usable city data. Do not close SEC1 on this
  partial local route check.
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
  produced a 2.9 s frame inside the `compileAsync` poll. Next candidates:
  build the boot environment while the loading screen is static (hide the
  canvas so a freeze is not visible), or replace the PMREM sky with a smaller
  prefiltered environment; split the terrain canvas upload.
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
  `npm run seed:direct` remains the stopgap.
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
    The OSM API sample validates real member geometry, but the Overpass query
    itself remains unverified: the primary endpoint returned 406 without the
    app User-Agent and timed out with it; both configured mirrors timed out.
    See [the live-data check](benchmarks/results/stage0/b3-multipolygon-live-check-2026-10-30.md).
  - Open: (1) verify the new relation query against a live Overpass response
    and a full city build when public Overpass is reachable. (2) Reseed the
    demo cells so cached data carries the new tags (writes to R2; ask first).
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

R1–R3 have implementation changes and unit checks; their remaining device and
browser validation gates are listed below. R4 is closed with browser and WebGL
object-count evidence. R6's evidence labels are reconciled. Preserve gameplay
and fallbacks.

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

0. Finish the smoothness track (section 0a): S7 live confirmation on the target
   laptop, then S8 render-scale confirmation on that laptop. S9's real-input
   check is closed. SEC1 (Next.js upgrade) must close before
   any public release; use [docs/UPGRADE-ASSESSMENT.md](docs/UPGRADE-ASSESSMENT.md).
1. B1 is parked (see its 29 Oct decision): artifacts stay local and are not
   published. Next data work is B3 (procedural landuse ground, most visible for
   the demo), then B2 (Overpass independence) and B4 (Overture attribute gap
   fill). Reopen B1 only through B1b (cached elevation grids for cold loads).
2. Consider C1–C3 only after the data foundation, and only when a measured
   viewer-visible benefit justifies their cost. The remaining release gates
   include 0.8 live dense-city baselines, 1.3 physical low-core validation,
   R1–R4 ownership/fallback checks, 4.3/4.5/4.6 visual and shadow checks, and
   Stages 5 and 9 integration/hardware acceptance.
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
