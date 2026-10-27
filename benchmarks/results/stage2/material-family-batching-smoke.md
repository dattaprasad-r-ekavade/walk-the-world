# Family batching prototype smoke

Compared baseline and candidate production builds on
`synthetic-material-families.json`, visible Chrome 156 using Intel UHD through
ANGLE D3D11. Both runs used the medium preset, browser-default renderer, seed
1337, the same Rome-area start and a 12-second walk. Each measurement window
passed, movement was about 60 m, and there were no browser or local asset errors.
The source commit was `76c562c`; the candidate contained the working-tree
batching change.

| Measure | Baseline | Candidate |
| --- | ---: | ---: |
| Scene meshes / unique geometries | 53 / 53 | 51 / 51 |
| Unique scene materials | 50 | 48 |
| Building factory keys | 10 | 8 |
| Shader programs | 18 | 18 |
| Mean draw calls/frame | 22.2 | 21.3 |
| Max draw calls/frame | 42 | 39 |
| Mean triangles/frame | 39,816 | 39,818 |
| GPU timer p95 | 9.10 ms | 9.35 ms |

The candidate groups walls by normalized material family and moves each
building's sRGB hex tint into linear vertex color. The shared building
material is white, so the tint is applied once; the existing per-vertex AO and
seeded color jitter remain multiplicative. Footprints, building rings,
collision data, and feature tags are not changed by the render batching.

The [baseline capture](material-family-batching-baseline.png) and
[candidate capture](material-family-batching-candidate.png) look visually
equivalent at this view. This one-run comparison shows a small draw-call
reduction and a 0.25 ms higher GPU p95. It does not establish a performance
gain or a no-regression result; repeat an interleaved A/B before promoting the
prototype based on performance.
