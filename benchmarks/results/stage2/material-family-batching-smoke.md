# Family batching prototype A/B decision

## Setup

Compared production builds from baseline commit `76c562c` and candidate commit
`f1a3081` in visible Chrome 156.0.8078.48 on Intel UHD 630 through ANGLE
D3D11. Both used a 1280×720 viewport, DPR 1, medium quality, the same
`synthetic-material-families.json` fixture, seed 1337, 12:00/clear conditions,
and a 12-second walk. The order was baseline/candidate/candidate/baseline/
baseline/candidate/candidate/baseline/baseline/candidate. Five valid runs were
recorded per build.

To isolate Stage 2.3, the baseline worktree carried the same Stage 2.4 color-space
fixes as the candidate. Its `app/layout.js` used the Outfit Latin font file
already emitted by the candidate build because the baseline's `next/font/google`
fetch failed in the Windows worktree. That local font adjustment affected the
DOM only; the street renderer and measured scene were unchanged. The baseline
reports therefore mark `sourceTreeDirty: true`; the candidate reports are clean.
The first baseline smoke run before aligning color-space changes was excluded.

All ten captures passed the measurement-window and host-sample validators,
reported 92% host telemetry coverage, and used the same visible Intel UHD 630
renderer. Every run moved 60.03–60.11 m and recorded zero validation, console,
page, or asset errors. Raw JSON reports remain in the local temporary directory
and are not committed.

## Results

Values are medians with the observed min–max range across five runs.

| Measure | Baseline | Candidate |
| --- | ---: | ---: |
| Load time | 3,289 ms (3,258–3,460) | 3,324 ms (3,127–3,565) |
| Mean frame time | 11.06 ms (11.01–11.12) | 11.04 ms (10.98–11.18) |
| Frame p95 | 20.7 ms (20.7–20.8) | 20.7 ms (20.7–20.8) |
| GPU mean | 7.19 ms (7.17–7.22) | 7.21 ms (7.19–7.24) |
| GPU p95 | 8.91 ms (8.80–8.96) | 9.00 ms (8.85–9.10) |
| Mean draw calls/frame | 22.20 (22.18–22.22) | 21.33 (21.33–21.34) |
| Maximum draw calls/frame | 42 | 39 |
| Mean triangles/frame | 39,816.2 | 39,817.3 |
| Scene meshes / unique geometries | 53 / 53 | 51 / 51 |
| Unique scene materials | 50 | 48 |
| Building material family keys | 10 | 8 |
| Shader programs | 18 | 18 |

The candidate reduced mean draw calls by 3.9% and reduced scene geometry and
material counts. Triangle submission was effectively unchanged. Median frame
p95 was identical; GPU p95 was 0.09 ms (1.0%) higher, with overlapping run
ranges. This fixture shows no measurable frame-time regression, but it does not
establish a broad hardware or real-city performance result.

## Decision

**Keep family batching as a small, neutral-cost submission improvement on this
synthetic fixture.** The candidate groups walls by normalized material family
and moves each building's sRGB hex tint into linear vertex color. The shared
building material is white, so tint is applied once; per-vertex AO and seeded
color jitter remain multiplicative. Footprints, building rings, collision data,
and feature tags are unchanged. The existing matched captures
([baseline](material-family-batching-baseline.png),
[candidate](material-family-batching-candidate.png)) looked visually equivalent.

This closes the repeatability gate for Stage 2.3 on this workload only. Dense
real-city, mobile, weather, high-tier visual acceptance, and long-walk resource
checks remain open. The prior combined prop material-cache/spatial-batching
experiment stays rejected; this is a separate, independently measured change.
