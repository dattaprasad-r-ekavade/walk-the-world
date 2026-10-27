# Recorded city material inventory by quality tier

Captured 28 October 2026 from a production build at source revision `6236b47`
with the material inventory diagnostic in the working tree. The benchmark used
visible Chrome 156, browser-default WebGL on Intel UHD Graphics through ANGLE
D3D11, 1280×720 at DPR 1, noon and clear weather. Each run replayed
`rome-showcase-osm.json` through the app city API in a fresh cold browser
context, then walked for 12 seconds. All three measurement windows and movement
checks passed, with no browser or asset errors. This is recorded-fixture
evidence; the same Rome payload is replayed for requested city cells, so these
counts do not represent live Overpass traffic or a live city survey.

## Scene and renderer counts

| Tier | Scene meshes | Unique geometries | Unique materials | Unique textures | Instanced objects | Instances | Shader programs | Mean draw calls/frame | Max draw calls/frame |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Low | 474 | 474 | 154 | 42 | 13 | 392 | 26 | 237.7 | 259 |
| Medium | 474 | 474 | 154 | 42 | 13 | 472 | 28 | 238.2 | 276 |
| High | 474 | 474 | 154 | 42 | 13 | 550 | 64 | 446.2 | 487 |

The shared factory cache held 4 building, 3 roof, 7 road and 20 simple material
keys in each run. Texture roles were also unchanged across tiers:

| Texture role | Material bindings | Mesh bindings | Unique textures |
| --- | ---: | ---: | ---: |
| `map` | 42 | 58 | 35 |
| `normalMap` | 16 | 41 | 3 |
| `roughnessMap` | 15 | 40 | 3 |
| `emissiveMap` | 4 | 18 | 1 |

No `metalnessMap` or `aoMap` bindings appeared. Binding counts describe the
captured scene materials; they are not shader-level texture-fetch counts. The
unique texture count can exceed the renderer's resident texture counter because
the scene walk includes texture references that are not necessarily uploaded.

All four building cache keys ended in an empty material suffix (`color|`), so
this Rome fixture did not exercise named `building:material` families. The
scene had 154 unique materials despite the shared factory caches, which is a
candidate for a later constructor-by-constructor fragmentation audit. High tier
used more programs and draw calls in this single run; do not interpret the
single-run timings or counts as a performance comparison.

Raw per-run reports are kept in the local temp directory, not checked in. The
next planned implementation is Stage 2.2: normalize raw OSM material names into
bounded families. Add or select a tagged fixture first so brick, plaster,
stone, metal and glass paths are represented; the Rome showcase contains no
`building:material` values.
