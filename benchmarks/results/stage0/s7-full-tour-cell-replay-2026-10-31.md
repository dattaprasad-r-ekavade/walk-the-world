# S7 full-tour city-cell replay — 31 Oct 2026

The S7 tour runner now accepts `--fixture=FILE` to replay city API responses
while following the actual globe-to-Tokyo, walk, night-switch, and Edinburgh
route. It can profile either arrival with `--cpu-profile-arrival` or
`--cpu-profile-edinburgh`. This allowed a visible local production build to use
the public production OSM cells without depending on local Overpass or R2
configuration.

## Result

The replay used the production center cell for each city: Tokyo
`wtw_city6_35.660_139.701` (3,665 elements) and Edinburgh
`wtw_city6_55.950_-3.188` (3,343 elements). Neighbor requests received an
empty fallback payload, so each city had one loaded and eight failed cells.
After adding Edinburgh's payload, the baseline and candidate full tours reached
both cities with zero console, page, and HTTP errors. This is useful for
reproducing the arrival path, but it is not a complete-city or acceptance run.

| Visible run on RTX 4060 / Chrome 156 | Tokyo arrival max frame | Edinburgh arrival max frame |
| --- | ---: | ---: |
| Baseline | 816.3 ms | 2,816.0 ms |
| Frame-sliced `renderer.compile` candidate | 883.2 ms | 2,715.9 ms |
| Candidate with Edinburgh CPU profile | 816.4 ms | 2,816.0 ms |

Each row is a single run. The candidate did not demonstrate a reduction in the
arrival stall; both runtime prototypes were reverted. The frame-sliced Rome
results remain in the [warmup comparison](s7-frame-budgeted-warmup-2026-10-31.md).

## Edinburgh CPU profile

The profiled run captured a 2,825 ms Long Task beginning immediately after the
`streaming-complete` mark. `getProgramInfoLog` accounted for 2,887.6 sampled ms,
with the stack passing through Three.js `PMREMGenerator.fromEquirectangular`,
`_textureToCubeUV`, and the renderer's first-use uniform setup. This does not
match the earlier production-deploy profile's apparent city-cell warmup
overlap; it shows that `getProgramInfoLog` alone is not enough to attribute the
stall to city shaders.

The `environment.pmrem-build` timing event in this run measured 41.8 ms and
ended about 758 ms before the Long Task. A baseline replay recorded the same
pattern: a 134 ms PMREM event followed by a 2,810 ms Long Task after the spawn
cell completed. The delayed PMREM first-use work remains unexplained and needs
better instrumentation. A separate Tokyo profile in the first full replay also
sampled PMREM work during its 829 ms task.

## Next

Replay the full 3×3 Tokyo and Edinburgh cell neighborhoods, add timing around
PMREM's internal render passes or confirm the later invocation in a profile,
then repeat the visible tour on the target i5-1035G1. The target-device run and
ground/terrain visual review are still required to close S7.
