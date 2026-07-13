# Walk the World — Portfolio-Grade 10/10 Plan

## Implementation checkpoint — 2026-07-13

The first portfolio transformation pass is implemented and documented in
[`BEFORE-AFTER.md`](BEFORE-AFTER.md). It includes the brand/icon system, guided demo
entry, responsive HUD cleanup, explicit streaming states, hidden developer controls,
improved instanced vegetation, PWA metadata, local tests, portfolio README/case study,
performance and release criteria, and the evidence-bound AI World Repair audit with
a deterministic fallback.

The unchecked roadmap items below are intentionally preserved. They include external
release work and deeper multi-week engineering that cannot be honestly marked complete
from one local pass: production credentials/deployment, real-device and user research,
the 30-cell AI evaluation, controlled performance profiling, full engine decomposition,
and the remaining global art-direction/LOD pipeline.

## Goal

Turn Walk the World from an impressive engineering sandbox into a polished,
memorable portfolio product that proves four things within 60 seconds:

1. The idea is original: a walkable planet reconstructed from open geospatial data.
2. The engineering is serious: streaming, caching, workers, adaptive rendering, and measured trade-offs.
3. AI materially improves the product and development workflow.
4. The experience is visually coherent, fast, reliable, and easy to demonstrate.

The central product promise should be:

> Pick any place on Earth and explore an AI-enhanced, living 3D interpretation of its real streets.

Do not add more unrelated features until the existing experience tells this story clearly.

---

## Current scorecard

| Area | Current | Why it is not 10/10 yet | 10/10 target |
|---|---:|---|---|
| Innovation | 8.5/10 | The open-data world engine, dual-renderer history, R2 cell cache, editor, and living-city systems are unusual. AI is not yet a visible or essential part of the product. | A focused, defensible AI layer that changes what users see or how missing world data is repaired. |
| Creation / execution | 8/10 | Large amount of real functionality, a production build, 27 passing tests, cache pipeline, workers, mobile controls, and editor tooling. The main street engine is still about 2,000 lines and some roadmap claims are stale. | Modular engine, reliable demo cities, broader critical-path tests, observability, and no known console or asset errors. |
| Presentation | 5.5/10 | The menu is clean, but the street view is visually uneven. HUD density, mobile overlap, terrain seams, generic emoji/icon branding, and loading-state ambiguity weaken the first impression. | A coherent visual identity, cinematic onboarding, clean responsive HUD, curated demo route, strong screenshots/video, and a portfolio-ready case study. |
| Vision | 8.5/10 | The plan contains many ambitious ideas, but it reads as a long changelog and feature backlog rather than a sharp product thesis. | One clear north star, three product pillars, measurable quality bars, and a deliberately limited flagship demo. |
| Performance readiness | 6.5/10 | The production build succeeds and the app shell is small, but the current benchmark compares development and production runs, the live street view was around 20 FPS on desktop review, and background streaming still looks unfinished. | Repeatable same-environment benchmarks, p95 load budgets, stable frame pacing, no long tasks during movement, and automatic quality that protects 30/60 FPS targets. |

These scores are based on the current source, `plan.md`, the successful production
build, 27 passing tests, and live desktop/mobile inspection on 2026-07-13.

---

## Product strategy: reduce breadth, increase proof

### The three pillars

1. **Real place, instantly recognizable**
   Roads, water, bridges, landmark massing, signs, materials, terrain, and lighting
   must make a curated location readable within five seconds.

2. **A living world**
   Weather, time, pedestrians, traffic, audio, and small interactions should create
   atmosphere without fighting for attention or frame time.

3. **AI-assisted reconstruction**
   AI should solve visible gaps in open data, explain its confidence, and allow the
   user to compare raw data with the enhanced result.

### The flagship demo

Build one deliberate 60-second journey instead of asking visitors to discover the
best parts themselves:

1. Start on a cinematic globe.
2. Select “Experience the demo.”
3. Fly into one curated city cell.
4. Walk through a visually strong street.
5. Change weather and time with one gesture.
6. Show the AI-enhanced layer with a before/after toggle.
7. Enter a car or use photo mode.
8. End with a generated walk card and an engineering-results panel.

Keep free exploration, but make the curated journey the primary portfolio path.

---

## Phase 1 — Trust and demo reliability

**Priority: immediate. Nothing else is portfolio-ready until this phase is complete.**

- [ ] Fix the current GLTF texture failure for `Textures/colormap.png`; add an asset-loading test so the regression cannot return.
- [ ] Replace the persistent “Loading neighborhood…” message with explicit states:
  `Ready`, `Streaming nearby streets`, `Offline cache`, `Retrying`, and `Limited detail`.
- [ ] Guarantee three showcase locations are fully warmed, versioned, and verified before every deployment.
- [ ] Add a one-command portfolio smoke test covering menu → demo → street ready → movement → photo mode.
- [ ] Keep build and unit verification as explicit local release commands; do not add a hosted workflow.
- [ ] Add a lightweight diagnostics overlay or exported JSON containing load stages, cache source, cell build time, draw calls, triangles, FPS, and GPU tier.
- [ ] Add graceful recovery actions: retry city, use cached demo, reduce quality, or return to globe.
- [ ] Remove contradictions from `plan.md`; move completed history into `CHANGELOG.md` and keep the active roadmap short.

### Exit criteria

- Zero console errors in the flagship path.
- Ten consecutive cold/warm demo runs complete without manual recovery.
- Every loading state tells the user what is happening and whether they can move.
- Production build and automated checks pass from a clean checkout.

---

## Phase 2 — Presentation and visual identity

### 2.1 Brand system

- [ ] Replace the emoji globe with a custom, ownable mark and a consistent icon set.
- [ ] Define a compact design system: color tokens, typography scale, spacing, radii,
  elevation, focus styles, animation durations, and icon rules.
- [ ] Keep the dark cartographic mood, but add one distinctive accent inspired by
  navigation, trails, or latitude/longitude rather than a generic blue game UI.
- [ ] Create a proper app icon, social preview image, favicon set, and PWA splash assets.
- [ ] Add one sentence on the title screen that explains the technical magic:
  “Real streets rebuilt from open map data, streamed as a living 3D world.”

### 2.2 Cinematic first minute

- [ ] Use a short camera attract loop behind the menu: globe → landmark → street.
- [ ] Replace the generic progress bar with a staged visual transition that reveals
  terrain, roads, buildings, and life as they become available.
- [ ] Add a “60-second guided demo” CTA above free exploration.
- [ ] Add tasteful transitions between globe, fly-down, street, and photo mode.
- [ ] Respect `prefers-reduced-motion` and offer a skip option.

### 2.3 HUD redesign

- [ ] Define three HUD modes:
  - **Explore:** location, minimap, one action strip.
  - **Drive:** speed, route cues, vehicle actions.
  - **Photo:** no chrome except an optional composition guide.
- [ ] Move technical metrics behind a developer toggle; FPS should not compete with
  the product during a normal portfolio demo.
- [ ] Collapse secondary tools into a single contextual drawer.
- [ ] Use SVG icons with tooltips instead of mixed emoji and symbolic characters.
- [ ] Reduce the minimap on mobile and allow it to collapse to a compass pill.
- [ ] Resolve mobile collisions between the title, search, top actions, minimap,
  joystick, status strip, run button, editor controls, and streaming toast.
- [ ] Hide editor/debug controls by default unless developer mode is enabled.

### 2.4 Visual world quality

- [ ] Fix visible cell/terrain/road seams before adding higher-end effects.
- [ ] Establish a material hierarchy: ground, road, curb, facade, glass, roof,
  vegetation, water, and props must remain distinguishable in all weather.
- [ ] Improve facade scale and repetition; add controlled variation by neighborhood,
  land use, building age heuristic, and OSM material tags.
- [ ] Add believable curbs, sidewalks, intersections, crossings, and road markings to
  the curated cells. These sell street-level scale more than extra post-processing.
- [ ] Improve vegetation silhouettes and placement; current simple cone trees should
  be replaced with a small instanced LOD library.
- [ ] Tune sky, fog, exposure, and shadows as one art-directed lighting stack.
- [ ] Use post-processing only where it improves hierarchy; avoid bloom/SSAO hiding
  geometry and data problems.
- [ ] Art-direct three showcase locations individually while keeping the global
  procedural system intact.

### Visual exit criteria

- A screenshot is recognizable as Walk the World without the title or HUD.
- No overlapping controls at 390×844, 768×1024, 1440×900, and ultrawide layouts.
- The flagship street has no obvious ground holes, white patches, road tears, or
  missing textures within the first 60 seconds.
- UI contrast, focus order, keyboard access, touch target size, and reduced motion
  meet WCAG 2.2 AA expectations.

---

## Phase 3 — Performance engineering with honest metrics

### 3.1 Replace the current benchmark contract

The existing before/after report is useful evidence, but development-versus-production
load comparisons are not a fair baseline. Create a repeatable benchmark matrix:

| Scenario | Cache | Device tier | Required output |
|---|---|---|---|
| Menu first load | cold | low/mid/high | LCP, JS bytes, main-thread time |
| Curated street | warm | low/mid/high | ready time, FPS p50/p95, 1% low, draw calls |
| Unseen street | cold | mid | first terrain, first building, fully streamed |
| Continuous walk | warm neighbors | mid | frame pacing, memory growth, cell swap spikes |
| Mobile controls | warm | low/mid | input latency, FPS, thermal-quality downgrade |

Store the device/browser/build commit with every result. Compare production with
production using the same fixture and rendering settings.

### 3.2 Performance budgets

- [ ] Menu usable in under 2 seconds on a mid-range phone over fast 4G.
- [ ] Warm curated street: terrain visible under 2 seconds; interactive under 4 seconds.
- [ ] Cold street: navigable terrain under 5 seconds; buildings stream progressively.
- [ ] Maintain 60 FPS on desktop mid-tier and 30 FPS on supported mobile low-tier.
- [ ] Keep p95 frame time below 16.7 ms desktop / 33.3 ms mobile during normal walking.
- [ ] No cell-streaming hitch above 100 ms on the main thread.
- [ ] No unbounded memory growth during a 15-minute continuous walk.

### 3.3 Engine work, in order

- [ ] Profile before optimizing; record CPU, GPU, network, worker, and memory costs separately.
- [ ] Break the roughly 2,000-line `StreetEngine.js` into lifecycle, renderer, streaming,
  player, population, interaction, and presentation controllers with explicit ownership.
- [ ] Dispose geometry, materials, textures, audio nodes, and listeners deterministically
  when cells or modes unload.
- [ ] Add shader/material warm-up for the curated demo to avoid first-use stalls.
- [ ] Build true LOD and impostor paths for buildings, vegetation, props, and population.
- [ ] Add occlusion/frustum/distance culling measurements and enforce draw-call budgets.
- [ ] Prioritize pre-baked ground and compact cell geometry on the CDN; this reduces
  client CPU work and makes visual quality more deterministic.
- [ ] Move remaining heavy parsing/geometry work off the main thread only when profiling
  shows a meaningful stall.
- [ ] Make adaptive quality respond to sustained frame time, not only a boot-time GPU guess.
- [ ] Degrade in a clear order: population → shadows → post effects → far detail → resolution.
- [ ] Add a low-memory mobile mode and test recovery after tab backgrounding/context loss.

---

## Phase 4 — Make the AI contribution visible and credible

The current project demonstrates strong graphics and geospatial engineering, but a
viewer cannot yet identify what AI contributes. Add one deep AI capability rather
than several decorative chat features.

### Recommended flagship: AI World Repair

Build a constrained pipeline that detects incomplete or suspicious map cells and
proposes visual repairs:

- Compare OSM and Overture coverage, topology, height, material, and land-use signals.
- Score confidence and explain why a repair is proposed.
- Infer missing facade style, roof family, approximate height, street furniture density,
  or landmark category from available structured data and optional street imagery that
  is legally licensed for the use.
- Show **Raw open data / AI enhanced** as an instant visual toggle.
- Keep provenance for every generated decision and never silently edit upstream data.
- Allow the editor to accept, reject, or modify suggestions and store that feedback.

This demonstrates model integration, retrieval/context construction, structured output,
evaluation, human-in-the-loop design, provenance, and safe fallback behavior.

### AI evaluation requirements

- [ ] Create a fixed set of 30 diverse cells across regions and density levels.
- [ ] Define measurable tasks: missing-feature detection, height error, material plausibility,
  topology safety, and human visual preference.
- [ ] Record model/prompt/version, cost, latency, confidence, and acceptance rate.
- [ ] Reject suggestions that violate geometry, collision, road, water, or licensing rules.
- [ ] Publish failure cases and show how deterministic rules constrain the model.
- [ ] Cache approved results so runtime exploration remains deterministic and offline-friendly.

### Optional second AI feature

After World Repair works, add a narrated guide grounded in nearby OSM/Wikidata facts.
It should cite its sources, know the visible location, and avoid inventing history. Do
not add a generic chatbot to the home screen.

---

## Phase 5 — Portfolio presentation

### Repository front page

- [ ] Rewrite the README around the problem, solution, demo, architecture, measured
  results, and lessons—not an exhaustive control list.
- [ ] Put the live demo and a 45–60 second video/GIF above the fold.
- [ ] Add six carefully framed screenshots: globe, fly-down, daytime street, night/rain,
  AI before/after, and mobile.
- [ ] Add a simple architecture diagram covering browser, Next API, R2/CDN, open-data
  providers, worker builder, and AI enhancement pipeline.
- [ ] Publish a benchmark table with reproducible commands and fair methodology.
- [ ] Add a “What I personally built” section and clearly credit data, libraries, models,
  assets, and AI-assisted development.

### Case study

Write a concise engineering story:

1. Why walking the real world in a browser is hard.
2. Why the first Cesium approach was not enough at street level.
3. How the custom Three.js cell engine and cache evolved.
4. What profiling revealed and which optimizations mattered.
5. How AI repairs gaps without overriding real-world provenance.
6. What failed, what was cut, and what the data proved.

### Recruiter / reviewer mode

- [ ] Add an optional “How it works” overlay with five annotated stops.
- [ ] Surface verified numbers: supported cells, warm load time, FPS tier, cache hit,
  geometry build time, and data sources.
- [ ] Add direct links to architecture, benchmarks, AI evaluation, and source code.
- [ ] Provide a fallback recorded demo if WebGL, network, or browser restrictions fail.

---

## Phase 6 — Release quality

- [ ] Installable PWA with a useful offline experience for visited showcase cells.
- [ ] Error monitoring with privacy-safe release tags and performance traces.
- [ ] Accessibility audit and keyboard-only walkthrough.
- [ ] Cross-browser matrix: current Chrome, Edge, Firefox, and Safari where supported.
- [ ] Real-device testing on at least one low-tier Android, one modern iPhone, and one
  integrated-GPU Windows laptop.
- [ ] Security review for editor routes, R2 uploads, secrets, asset names, and user edits.
- [ ] Data-provider usage and attribution review, especially map tiles, imagery, audio,
  models, and any AI training/inference inputs.
- [ ] Versioned releases, rollback plan, cache-version migration, and demo uptime check.

---

## Twelve-week execution order

### Weeks 1–2: make the current demo trustworthy

- Fix the GLTF texture failure and visual seams in one flagship cell.
- Clarify loading/streaming states.
- Keep the local build/test gate and add a resource-bounded smoke check when needed.
- Clean `plan.md` and publish a short active roadmap.

### Weeks 3–4: presentation pass

- Create the identity/icon system.
- Redesign desktop and mobile HUD modes.
- Build the guided 60-second demo and record its first video.

### Weeks 5–6: measured performance

- Build the fair benchmark matrix and diagnostics capture.
- Profile the flagship flow and enforce budgets.
- Modularize the engine boundaries required for the measured bottlenecks.

### Weeks 7–9: flagship AI capability

- Build the World Repair dataset, structured pipeline, provenance, and editor review.
- Add the raw/enhanced comparison and evaluation report.
- Cache accepted enhancements for deterministic demos.

### Weeks 10–11: art direction and accessibility

- Finish three curated locations across day/night/weather.
- Complete responsive, keyboard, touch, reduced-motion, and contrast passes.
- Test real devices and tune adaptive quality.

### Week 12: portfolio launch

- Publish the live app, video, README, case study, architecture, and benchmark results.
- Run the release checklist from a clean machine.
- Ask five people unfamiliar with the project to try the 60-second path; fix every point
  where they cannot explain the idea, AI contribution, or engineering achievement.

---

## Definition of 10/10

The project is 10/10 when a first-time visitor can, without instructions:

- understand the product in five seconds;
- enter a reliable, beautiful demo in one click;
- recognize a real place and see a meaningful AI-enhanced difference;
- explore smoothly on desktop and acceptably on mobile;
- see credible evidence for the architecture and performance claims;
- understand exactly what the creator designed, implemented, measured, and learned;
- finish the experience remembering one sharp idea: **a living, AI-enhanced walkable
  world built from open data**.
