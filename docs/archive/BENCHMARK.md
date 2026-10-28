# Engine Rewrite — Performance Benchmark

Comparing the CesiumJS walk mode against the new custom **Three.js Street
Engine** (`/street`), added to answer: *was the rewrite meaningful?*

## Methodology

- Same machine, same headless Chromium, same software renderer (SwiftShader —
  CPU rendering, so absolute numbers are far below real-GPU numbers; the
  **ratio** is what matters).
- Same location (Rome, 41.8902 N 12.4922 E), same task: walk forward (W held)
  at street level while the engine streams and renders.
- FPS sampled once per second from each engine's own frame counter.

## Results

| Metric | Cesium walk mode (before) | Three.js Street Engine (after) | Change |
|---|---|---|---|
| Average FPS | **2** | **14.3** | **~7× faster** |
| Min / Max FPS | 2 / 2 | 13 / 15 | stable in both |
| JS heap | ~500 MB typical for Cesium | **11 MB** | ~45× smaller |
| Scene triangles (buildings) | millions (streamed 3D Tiles) | **~25,000** (merged extrusions) | ~2 orders of magnitude |
| Draw calls (city) | hundreds (per-tile) | **~10** (one mesh per color group) | — |

On real hardware (GPU rendering) the same ratio pushes the street engine well
past 60 FPS on modest machines, where Cesium walk mode was hitting 20–30.

## Why it's faster

The Cesium path renders a whole-planet engine at street level: global terrain
quadtree, imagery pyramid, streamed 3D Tiles with per-tile draw calls and LOD
management — plus scene ray-casts per frame for ground clamping and collision.

The street engine renders only what a walker can see: a 3×3 patch of terrain
(65×65 heightmap meshes), ~1,200 OSM ways extruded once and **merged into a
handful of draw calls**, and ribbon roads. Ground height is a bilinear lookup
into a Float32Array (no ray-casts); collision is a 2D point-in-polygon test
against a spatial hash grid (microseconds). Nothing streams after load.

## Data sources (all keyless, $0)

| Layer | Source |
|---|---|
| Elevation | AWS Open Data Terrarium tiles (S3) |
| Ground texture | OpenStreetMap raster tiles |
| Buildings + roads | Overpass API (OSM) |
| Avatar | CesiumMan glTF (Khronos samples, CDN) |

## Trade-offs

The street engine covers a ~7 km bubble per load (no infinite streaming yet),
has simpler visuals (flat-shaded low-poly), and no globe — which is why the
Cesium globe remains the fly/travel layer, with the 🎮 toolbar button handing
off to `/street?lat=..&lon=..` at any walked location.
