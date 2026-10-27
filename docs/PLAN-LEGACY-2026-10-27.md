# Walk the World — Active Roadmap

Archived on 27 October 2026. The active implementation sequence is in
[`plan.md`](../plan.md); the statements below preserve the previous roadmap.

The portfolio transformation is defined in [`plan2.md`](../plan2.md). Historical
feature work is summarized in [`CHANGELOG.md`](../CHANGELOG.md) and preserved in git.

The detailed performance and visual-quality proposal is in
[`PERFORMANCE-VISUALS-PLAN.md`](../PERFORMANCE-VISUALS-PLAN.md), researched on
27 October 2026. It covers profiling, shaders, compressed assets, LOD, and
conditional Rust/WebAssembly/SIMD adoption. Its stages remain unimplemented.

## North star

> **Every real city on Earth, rebuilt as a living open world you can walk and
> drive through.** — full mission and ordered roadmap in [`MISSION.md`](../MISSION.md)

Pick any place on Earth and explore a living 3D interpretation of its real
streets: dense traffic, pedestrians with somewhere to be, a drivable car,
day/night and weather, on real OpenStreetMap geography.

## Product pillars

1. A real place should be recognizable within five seconds.
2. Time, weather, movement, sound, and population should make it feel alive.
3. Reconstruction assistance must be evidence-bound, reversible, and transparent.

## Current release gate

- [x] Preserve desktop/mobile baseline screenshots.
- [x] Replace generic branding and expose a guided portfolio route.
- [x] Separate normal exploration from developer/editor controls.
- [x] Add an evidence-bound AI World Repair audit with safe fallback.
- [x] Add PWA metadata, world-repair tests, and clear streaming states.
- [x] Pass the production build and unit-test workflow.
- [x] Capture matched after screenshots and publish the comparison.
- [x] Remove paid-model dependencies and GitHub workflow automation.
- [x] Keep the free-tier R2 and Overture caching pipeline for Vercel.
- [ ] Deploy and validate the public URL on real mobile devices.

## Performance budgets

- Menu usable in under 2 seconds on a mid-range phone over fast 4G.
- Warm showcase terrain visible in under 2 seconds and interactive in under 4.
- Cold terrain navigable in under 5 seconds while buildings stream.
- 60 FPS target on mid-tier desktop; protected 30 FPS tier on mobile.
- No cell-streaming main-thread hitch over 100 ms.
- No unbounded memory growth during a 15-minute continuous walk.

## External release work

Deployment, production credentials, real-device thermal testing, user interviews,
and third-party monitoring account setup require the owner's accounts or hardware.
See [`RELEASE-CHECKLIST.md`](../RELEASE-CHECKLIST.md).


## Phase 21 — The night-drive look (Hop.Earth-grade visuals)

**Why theirs looks better — an honest teardown of the screenshot.** Hop.Earth
runs the same stack we do (three.js + OSM + satellite elevation, dev confirms
night mode + auto streetlights are their newest work). The screenshot's magic
is FOUR tricks stacked, none exotic:

1. **Night-first art direction.** 90% of the frame is black. Darkness hides
   low-poly geometry; contrast does the work that texture detail would.
2. **Real lights hitting a real road surface.** Their road is a lit PBR mesh:
   streetlights produce specular streaks on asphalt. OUR roads are PAINTED
   into the terrain canvas — unlit pixels that can never reflect a light.
   This is the one architectural gap; everything else we already own.
3. **Bloom on emissives only.** Lamp heads and taillights glow past their
   geometry. We HAVE bloom (16.2) but only on the "high" tier.
4. **Corridor focus.** A driving game only needs the 20 m around the road to
   look good: guardrails, posts, clean markings. Their buildings are dark
   nothings. We spend our polygon budget evenly; they spend it on the road.

We already have: postFX bloom/SSAO, IBL, GPU tiering, worker streaming,
lamp glows + light pools, emissive windows, drivable car, live clock.
The plan closes the gap in order of visual leverage:

- [x] **21.0 Diagnose why night lighting "isn't there" (done — measured).**
      Findings, with screenshots taken at the same pose in the seeded London
      cell (51.5101,-0.1344) at hour 22:
      * The night layer DOES render: emissive windows, lamp bulbs, ground
        light pools, trees, silhouetted skyline all appear. An earlier
        "before" shot that showed an empty void was taken with
        `benchmarks/fixtures/rome-minimal.json` — **8 elements, 1 lamp** —
        i.e. a benchmark fixture, not a real cell. Never judge visuals on it.
      * Real gap #1: **bloom never ran.** postFx gated `setEnabled` on
        `quality === "high"`; GPU auto-detect (16.3) picks medium/low on most
        machines, so lamp/window glow never bloomed for anyone below high.
        Now: bloom enables at night for medium+ (SSAO stays high-only).
      * Real gap #2: **lamp bulbs were clamped LDR** (0xffe9a8) — below any
        sane bloom threshold, so even with bloom on they would not glow.
        Now HDR: `setRGB(3.2, 2.7, 1.9)` at night.
      * Real gap #3: night sky was 0x0c1428 (blue-grey wash) → now 0x05080f
        near-black, plus extra night fog density, so unlit distance falls to
        black and lamps carry the frame.
      * NOT a bug: HUD clock reading "12:00 PM" in test shots — the debug
        hook `__streetDebug.setTime()` drives the engine only; the settings
        store (which the HUD reads) is updated on the real UI path.
      * **Unverified here:** the bloom result itself. This sandbox renders
        with SwiftShader, which auto-detects as tier "low" → postFX skipped
        by design. Bloom must be eyeballed on a real GPU at medium/high.

- [ ] **21.1 Lit PBR road corridor (the unlock).** Promote the decal road
      ribbons from painted-texture strips to MeshStandardMaterial with low
      roughness (~0.35), subtle normal detail and env reflections; markings
      as a second emissive-capable strip texture. Keep the painted canvas for
      the far field — the mesh corridor only needs to exist ~300 m around
      the player. Headlights and streetlights start producing specular
      streaks on asphalt the moment this lands.
- [ ] **21.2 Recycled real streetlights.** A pool of 8-12 THREE.PointLight/
      SpotLights bound to the NEAREST lamp posts (re-assigned as the player
      moves, distance-culled; gpu-tier caps the count). Warm 2700 K, hitting
      the 21.1 road + nearby walls. Existing glow sprites + pools stay as
      the far-field fake.
- [ ] **21.3 Bloom at night on medium tier.** Selective bloom (threshold ~1)
      whenever the sun is below the horizon — emissives only, so cost stays
      modest. High tier keeps SSAO too. Boost taillight/headlight emissive
      quads on cars so they read like the reference.
- [ ] **21.4 Night grade.** Sky gradient to true black at horizon, fog to
      black, night exposure curve (drop ~0.75), non-emissive materials dimmed
      — commit to darkness instead of a blue-grey wash. Soft gradient cone
      billboards under lamp heads (fake volumetrics, additive, ~free).
- [ ] **21.5 Corridor furniture.** Instanced guardrails + reflector posts
      along trunk/primary/motorway edges (the thing that sells speed in
      their shot), delineator posts on curves, chevron boards on sharp bends
      — all from data we already parse.
- [ ] **21.6 Wet nights.** Rain drops road roughness to ~0.12 → mirror
      streaks under every lamp. Rain + night + streetlights is the money
      screenshot.
- [ ] **21.7 Drive-cam feel.** Lower boom, speed-based FOV (70→82),
      1-frame camera lag, subtle shake above 15 m/s. Free perceived speed.
- [ ] **21.8 Corridor-priority streaming.** While driving, prefetch the
      2-3 cells along the current heading (not the 4-neighbor ring) so the
      world "generates ahead of you" like theirs — extends 10.1 using the
      worker builder.

Order: 21.1 → 21.2+21.3 together (one lighting PR) → 21.4 → 21.7 → 21.5 →
21.6 → 21.8. After 21.4 the night screenshot should stand next to theirs.
