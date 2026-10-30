# S8 far-building detail fade — 30 October 2026

## Candidate

Tested a shader LOD that faded facade texture detail and normal mapping between
45 m and 60 m, leaving vertex-tinted walls and geometric normals beyond 60 m.
Roughness maps and emissive window maps remained enabled. The current `87d26dc`
shader (the interior-window cutoff) was the baseline. The candidate was built
locally and has been removed after measurement.

Visible Chrome 156, 1280×720, browser-default renderer, medium quality, clear
weather, 21:00 local solar time, 8-second walks, and the same recorded 3×3 city
fixture were used on an Intel Core i7-13650HX with Intel UHD Graphics (0xA78B).
This is not the target i5-1035G1 laptop.

## Results

| City | Frame p95 baseline → candidate | GPU-timer p95 baseline → candidate |
| --- | ---: | ---: |
| Tokyo | 34.8 → 34.8 ms | 17.66 → 18.21 ms |
| Pune | 20.9 → 20.9 ms | 10.17 → 10.25 ms |
| Edinburgh | 34.7 → 34.7 ms | 16.73 → 17.99 ms |
| New York | 27.6 → 21.1 ms | 12.70 → 13.32 ms |
| Mean | 29.50 → 27.88 ms | 14.31 → 14.94 ms |

All eight captures had valid 8-second windows, valid movement, and zero console,
runtime, or local asset errors. Frame p95 was unchanged in three cities; the
4-city mean fell 5.5%, below the 10% S8 target. GPU-timer p95 rose 4.4% on
average and was higher in every city. The New York frame-p95 reduction did not
correspond to a GPU-time reduction.

The Tokyo screenshots mostly show a close facade, so they do not establish the
appearance of far buildings across the 45–60 m transition. No useful visual
acceptance result offsets the missing GPU gain.

## Decision

Reject and remove this shader candidate. The measurement does not show a broad
GPU improvement. Continue S8 with the lower default render-scale candidate for
integrated GPUs, then capture the matched result on the target i5-1035G1 laptop.
