# S8 Intel render-scale comparison — 2026-10-30

**Decision:** keep the 0.85 auto-scale candidate for target-laptop confirmation.
All four city comparisons beat the 10% screen on this host, but this is not the
plan's target i5-1035G1 laptop, so S8 remains open.

## Setup

- Baseline: `df2a675`, auto mode at render scale 1.0. Candidate: the Intel auto
  render-scale change committed as `d4a0368`, at scale 0.85. Manual quality
  mode remains at scale 1.0.
- Five measured repetitions per city, with before/after order alternated.
  Each capture used the same recorded 3×3 city-cell fixture, cold city cache,
  medium auto quality, 21:00, clear weather, an 8-second walk, seed 1337, and
  the `/street` route.
- All 40 measurement windows were valid, stayed on medium auto quality, and
  reported zero validation errors. Candidate captures reported
  `integratedGpu=true` and render scale 0.85; baseline captures used scale 1.0.
- Lenovo 83DV, Windows 11 Pro, 13th Gen Intel Core i7-13650HX, Intel UHD
  Graphics (0xA78B) selected by Chrome/ANGLE. The laptop also contains an RTX
  4060, but the measured WebGL renderer was Intel UHD. Chrome 156.0.8078.79,
  1280×720 viewport, DPR 1. Node v22.23.3, npm 10.9.9; production builds
  completed with Next.js 16.4.3 and React 19.3.1.
- Frame p95 and GPU-timer p95 are the median of five runs. Ranges show the
  minimum and maximum frame p95 across those runs. GPU timing collection was
  available in every run.

The benchmark started before the candidate commit. Its first two candidate
capture records carry the prior Git revision, while the other 18 carry `d4a0368`;
the candidate source contents were identical before and after that commit. The
benchmark-only auto-tier lock and metric collection were applied to both builds.
Raw JSON captures remain in the local ignored `benchmarks/results/stage0/`
directory as `s8-render-scale-{before,after}-<city>-r<n>.json`.

## Results

| City | Frame p95, scale 1.0 → 0.85 | Change | Frame p95 range, scale 1.0 / 0.85 | GPU p95, scale 1.0 → 0.85 |
| --- | ---: | ---: | ---: | ---: |
| Tokyo | 41.60 → 28.00 ms | −32.7% | 34.80–41.70 / 27.80–34.60 ms | 18.94 → 14.43 ms |
| Pune | 20.90 → 14.00 ms | −33.0% | 20.80–20.90 / 14.00–14.10 ms | 10.24 → 8.09 ms |
| Edinburgh | 34.80 → 27.70 ms | −20.4% | 34.80–41.50 / 27.70–27.80 ms | 18.24 → 13.56 ms |
| New York | 27.70 → 20.80 ms | −24.9% | 21.00–27.80 / 20.80–20.90 ms | 13.40 → 10.09 ms |

Across the four city medians, frame p95 fell from 31.25 ms to 22.63 ms
(27.6%); GPU-timer p95 fell from 15.21 ms to 11.54 ms (24.1%).

## Remaining check

Repeat the matched captures on the target i5-1035G1 laptop. This host result
supports keeping the candidate, but does not close S8 or establish performance
on that target device.
