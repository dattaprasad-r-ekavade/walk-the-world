# Stage 3.7 — selected GLB optimization

## Decision

Adopt glTF Transform CLI 4.5.0's decoder-free `prune`, `dedup`, `weld` pipeline
for the four selected Kenney props. Keep the source PNG maps embedded. Do not
adopt Meshopt, Draco, or triangle simplification for these props: transfer
savings after gzip/Brotli are small, compression requires runtime decoder
integration, and the useful simplification candidate visibly damages the
traffic-light lenses.

The repeatable implementation is `npm run assets:build`; the focused optimizer
is `npm run assets:props`. Per-model hashes, geometry summaries, transform logs
and trial results are in [`glb-optimization.json`](glb-optimization.json).

## Aggregate results

| Measure | Normalized | Optimized | Change |
| --- | ---: | ---: | ---: |
| GLB bytes | 78,188 | 74,128 | −5.2% |
| gzip bytes | 50,448 | 50,308 | −0.28% |
| Brotli bytes | 47,302 | 46,991 | −0.66% |
| Vertices | 762 | 638 | −16.3% |
| Triangles | 442 | 442 | unchanged |

Meshopt trial output was 61,520 raw bytes, 48,795 gzip bytes and 46,967 Brotli
bytes. Draco was 54,624 raw, 46,613 gzip and 45,258 Brotli bytes. Their required
extensions are not configured in the current Three.js `GLTFLoader` prop path;
raw-size gains do not offset adding decoders for these map-dominated models.

## Correctness and visual checks

- Blender 5.2.0 normalization now exports embedded source images instead of
  external image URIs with a 1×1 white fallback. This keeps each GLB portable
  when copied without its source asset directory.
- The optimizer checks node/mesh/primitive/material/texture counts, texture
  slots and bytes, position bounds, attributes and triangle counts. The adopted
  output adds no glTF extensions; glTF Transform validation passed.
- Blender Eevee renders of four cardinal views for each of the four props were
  pixel-identical to freshly normalized baselines (16 views, zero changed
  pixels). Simplification at ratio 0.75/error 0.001 did not reduce triangles.
  At error 0.01, the traffic-light lens shapes became visibly square; rejected.
- A browser smoke with Three.js 0.170 `GLTFLoader` loaded all four files with
  their embedded 512×512 maps, merged the geometry, and created two
  `InstancedMesh` instances per prop. No model or loader errors occurred.

Review captures are in `glb-optimization-review/`; the runtime smoke capture is
`glb-three-runtime-smoke.png`.

`npm run assets:build` completed end to end, and a second `npm run assets:props`
validated all four already-optimized outputs without rewriting them.

## Scope

This validates asset integrity and compatibility with the existing merge and
instancing approach. The selected props remain offline and are not yet wired
into production street scenes. This is not production asset publication or a
cross-device performance acceptance test.
