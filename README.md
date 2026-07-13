# Walk the World

> Pick any place on Earth and explore a living 3D interpretation
> of its real streets.

Walk the World is a browser-based planetary exploration engine. A Cesium globe
handles global travel; a custom Three.js engine reconstructs street-level cells
from open geospatial data, streams neighboring streets, and layers in time,
weather, traffic, pedestrians, audio, vehicles, photo mode, and editing tools.

The guided portfolio route demonstrates the product in about 60 seconds. Free
exploration remains available for any coordinate.

## Before and after

| Baseline | Portfolio pass |
|---|---|
| ![Baseline menu](screenshots/comparison/before/menu-desktop.png) | ![Portfolio menu](screenshots/comparison/after/menu-desktop.png) |
| ![Baseline street](screenshots/comparison/before/street-desktop.png) | ![Portfolio street](screenshots/comparison/after/street-desktop.png) |

See [`BEFORE-AFTER.md`](BEFORE-AFTER.md) for the measured comparison and mobile views.

## Why it is technically interesting

- A globe-to-street transition joins two different rendering approaches.
- World cells are fetched from OpenStreetMap/Overpass, cached in the browser and
  Cloudflare R2, and assembled into merged geometry in a Web Worker.
- Overture buildings can fill sparse cells through a DuckDB-over-S3 query path;
  generated cell results are cached back to R2.
- Neighbor cells stream and evict while the player walks.
- Adaptive quality, instancing, ref-driven HUD updates, indexed ground height,
  and progressive terrain-first rendering protect responsiveness.
- A living-city layer adds weather, time, traffic, pedestrians, birds, audio,
  drivable cars, photo mode, a walk passport, and touch controls.
- An editor can place GLB assets, sculpt terrain, hide broken features, and
  persist per-cell corrections.

## Local World Repair

World Repair is a constrained reconstruction audit, not a generic chatbot. It
summarizes observable map coverage and produces deterministic recommendations with:

- numerical evidence;
- confidence and risk;
- explicit provenance;
- no invented businesses, landmarks, history, or exact geometry;
- human review for topology-sensitive changes.

It runs entirely inside this application with no paid model, API key, or external
AI service. The rules are versionable, testable, fast, and honest about their
evidence. The architecture can later accept an open model without changing the
review contract.

Evaluation design is documented in [`AI-EVALUATION.md`](AI-EVALUATION.md).

## Architecture

```mermaid
flowchart LR
  U[Browser] --> G[Cesium globe]
  U --> S[Three.js street engine]
  S --> W[City builder worker]
  S --> L[Browser cache]
  S --> C[R2 city cache]
  S --> A[Next API]
  A --> O[OpenStreetMap / Overpass]
  A --> V[DuckDB / Overture]
  V --> C
  S --> R[World Repair summary]
  R --> X[Local deterministic audit]
  X --> H[Human review]
```

Detailed ownership and cell lifecycle are in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The base experience works without credentials.
For the free-tier shared cache and Overture fallback, copy `.env.local.example`
to `.env.local` and add your Cloudflare R2 credentials.

## Verify

```bash
npm test
npm run build
npm run start -- -p 3456
```

## Performance claims

The project includes historical benchmark fixtures and a new fair-comparison
contract. Production runs must use the same browser, GPU mode, fixture, quality,
viewport, and cache state. See [`PERFORMANCE-BUDGETS.md`](PERFORMANCE-BUDGETS.md)
and [`BENCHMARK-PERF.md`](BENCHMARK-PERF.md).

## What I built

- the product interaction model and guided portfolio journey;
- the custom cell-based Three.js street engine;
- globe-to-street routing and shared HUD;
- open-data ingestion, browser/R2 cache strategy, Overture fallback, and editor;
- worker geometry pipeline, streaming, collision, population, vehicles, ambience,
  materials, post-processing, adaptive quality, and performance harnesses;
- the evidence-bound World Repair contract, fallback, validation, and evaluation plan.

AI-assisted development is credited as a development method; shipped AI behavior
is separately identified by its runtime provenance.

## Documentation

- [`CASE-STUDY.md`](CASE-STUDY.md) — engineering narrative
- [`plan.md`](plan.md) — short active roadmap
- [`plan2.md`](plan2.md) — 10/10 transformation plan
- [`RELEASE-CHECKLIST.md`](RELEASE-CHECKLIST.md) — launch gate
- [`CREDITS.md`](CREDITS.md) — data, libraries, and assets

## License and data

This is a personal, non-commercial portfolio project. Map, imagery, terrain,
audio, and 3D assets retain their respective licenses and attribution requirements.
Review [`CREDITS.md`](CREDITS.md) before deployment or reuse.
