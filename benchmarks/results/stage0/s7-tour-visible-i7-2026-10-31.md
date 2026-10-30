# S7 visible tour on the i7 host — 31 Oct 2026

Ran the full tour against the production deployment in a visible browser on the available 13th Gen Intel Core i7-13650HX laptop. The run is useful for checking the tour and harness, but the renderer selected the NVIDIA GeForce RTX 4060 Laptop GPU, so it is not Intel UHD or target i5-1035G1 evidence.

## Results

| Segment | Max frame | p95 | Frames |
| --- | ---: | ---: | ---: |
| Globe startup | 16.9 ms | 16.9 ms | 24 |
| Globe flight to Tokyo | 299.8 ms | 17.0 ms | 167 |
| Tokyo arrival to engine ready | 2,716.2 ms | 100.1 ms | 199 |
| Tokyo nearby-cell settling | 66.8 ms | 50.1 ms | 80 |
| Walk | 17.1 ms | 16.8 ms | 301 |
| Night switch | 17.0 ms | 16.8 ms | 151 |
| Street flight to Edinburgh | 49.9 ms | 17.0 ms | 59 |
| Edinburgh arrival to engine ready | 250.0 ms | 50.2 ms | 172 |
| Edinburgh nearby-cell settling | 150.0 ms | 49.8 ms | 112 |

The four S7 acceptance segments (globe travel, walking, night switch, and street travel) stayed below 500 ms on this NVIDIA-rendered run. Both city streams reached 9/9 resident cells. Console errors, page errors and HTTP responses at or above 400 were all zero. Tokyo arrival still contained a 2.7-second frame, so arrival behavior is recorded separately from the four acceptance segments.

The runner correctly reported `visible-run-needs-review`: this machine was not the target i5, and its WebGL renderer was NVIDIA. The S7 gate remains open until the target i5-1035G1 visible run and ground/terrain visual review. The [machine-readable capture](s7-tour-visible-i7-2026-10-31.json) and [Edinburgh capture](../../../screenshots/performance-visuals/stage0/s7-tour-visible-i7-2026-10-31/edinburgh-arrival.jpg) are retained with this report.
