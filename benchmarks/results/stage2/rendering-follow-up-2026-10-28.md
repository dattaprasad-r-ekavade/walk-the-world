# Rendering follow-up — 28 October 2026

These checks used local revision `727d46e` of `main`. The controlled material
comparison replayed the recorded Rome OSM fixture in visible Chrome 156 on an
Intel UHD 630 at 1280×720, DPR 1, medium quality. The scene crossed one cell
boundary during each 12-second measurement. It is client/rendering evidence,
not a live-city or mobile result.

## 2.5 — Simple far materials versus near PBR

Five baseline and five candidate runs were interleaved in fresh browser contexts.
The candidate switched eligible far building meshes to simple Lambert materials
at 350 m, returning to PBR inside 270 m. Road, glass and metal materials were
unchanged. Every run had a valid measurement window, about 60 m of movement,
92% host-telemetry coverage, and zero validation, console, page or asset errors.

| Metric | PBR baseline | Far-material candidate |
|---|---:|---:|
| Frame p95, median (range) | 14.0 ms (14.0–14.1) | 14.0 ms (14.0–14.1) |
| GPU timer p95, median (range) | 7.56 ms (7.52–7.64) | 7.52 ms (7.50–7.60) |
| Mean draw calls, median (range) | 56.54 (56.52–56.55) | 56.58 (56.49–56.59) |
| Triangles per frame | about 114,026 | about 114,027 |
| Shader programs | 28 | 28–29 |

Each candidate run switched only four meshes across two cells. The GPU p95
ranges overlap, frame p95 is unchanged, and mean draw calls did not decrease.
An exploratory single run at 225 m / 170 m switched ten meshes across five
cells, but its 7.534 ms GPU p95 is not a repeated comparison.

**Decision: reject the far-material prototype.** It showed no useful frame or GPU
gain for this view, so the prototype and benchmark toggle were reverted. The
matched captures remain available: [PBR baseline](building-material-lod-off.png)
and [far-material candidate](building-material-lod-on.png).

## 2.6 — Walk-cycle shader and shadow parity

The audit found one custom `onBeforeCompile` patch in `lib/engine/ped-walk.js`.
Its built-in pedestrian material deformed visible vertices, but cast shadows used
the unmodified depth and point-light distance shaders. The pinned Three.js
version is 0.170.0; its color, depth and distance vertex shaders all contain the
`common` and `begin_vertex` chunks used by the patch.

The walk-cycle factory now creates color, depth and distance materials that use
the same position deformation and share `uTime` / `uAmp` uniform objects. Built-in
instanced pedestrians receive both custom shadow materials. Separate stable
program-cache keys identify the three shader variants, and time/weather updates
change shared uniform values without setting `needsUpdate`. Custom GLB pedestrians
keep their existing materials.

`npm run build` passed. A six-second visible-Chrome Rome replay then produced a
valid window, crossed into the expected neighbor, retained 10/10 cells, and
reported zero validation, console, page or asset errors. The [smoke JSON](walk-ped-shadow-shader-smoke.json)
and [capture](walk-ped-shadow-shader-smoke.png) are retained. This is a shader
compile/runtime check, not a shadow-quality or performance comparison. Existing
walk deformation still leaves vertex normals unchanged; Stage 5.3 retains that
separate visual-quality question.

## Next work

The next plan gate remains Stage 0.8: collect valid dense live-city cold/warm
walk/drive boundary measurements, then use the traces to rank assembly,
scheduling and GPU costs. The 28 October Manhattan cold retry failed at the
origin city API and is documented separately in the Stage 0 results; replayed
OSM remains the client-side fallback. Do not choose a Stage 1 optimization until
those traces identify the hotspot.
