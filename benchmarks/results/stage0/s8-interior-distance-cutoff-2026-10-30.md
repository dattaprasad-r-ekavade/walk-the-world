# S8 interior-window distance cutoff — 30 October 2026

## Scope and setup

Compared the baseline interior shader from `23a34cc` with the cutoff candidate
in `87d26dc`. The candidate completes the room fade from 32 m to 40 m and
returns before ray-box sampling once the fade reaches zero. At 21:00 local solar
time, the scene's window glow is active.

Each run used visible Chrome 156 at 1280×720, the browser-default renderer,
medium quality, clear weather, an 8-second walk, and the same recorded 3×3 city
fixture (36 cells per four-city set). A local production build served each
revision. The WebGL renderer was ANGLE D3D11 on Intel UHD Graphics (0xA78B) in an
Intel Core i7-13650HX system. This is not the target Intel UHD i5-1035G1 laptop.

## Frame-time p95

| City | Pair 1 baseline → cutoff | Pair 2 baseline → cutoff |
| --- | ---: | ---: |
| Tokyo | 34.8 → 34.8 ms | 34.8 → 34.8 ms |
| Pune | 20.9 → 20.9 ms | 20.8 → 20.8 ms |
| Edinburgh | 34.6 → 27.6 ms | excluded → 28.0 ms |
| New York | 27.7 → 21.0 ms | 20.9 → 21.0 ms |

Pair 2's Edinburgh baseline is excluded: the browser reported 47 network
diagnostics, including `ERR_NAME_NOT_RESOLVED` and `ERR_NETWORK_CHANGED`. Its
measurement window was otherwise populated, but the capture failed the
diagnostic gate. All seven included pairs had valid 8-second windows, valid
movement, and no console, runtime, or local asset errors.

Across the four valid Pair 1 captures, mean frame p95 changed from 29.50 to
26.08 ms (11.6% lower). Pair 2's three valid pairs changed from 25.50 to
25.53 ms (0.1% higher). Pooling all seven valid pairs gives 27.79 ms baseline
and 25.84 ms cutoff (7.0% lower). This falls short of the 10% S8 target and
does not repeat consistently. The mean of the per-run GPU-timer p95 values
changed from 13.97 to 14.50 ms (3.8% higher), so GPU timing does not confirm a
gain.

The earlier 29 Oct daytime live-data figures (Tokyo 27.9 ms, Pune 14.1 ms,
Edinburgh 20.9 ms, New York 20.9 ms) are not a shader comparison: at 12:00 the
interior-window glow is zero. The full-neighborhood fixture and night runs
replace those figures for evaluating this shader candidate.

## Decision

Keep S8 open. The cutoff is implemented, but the desktop replay does not show a
repeatable 10% improvement and is on different hardware from the target laptop.
Continue with the next listed candidate, simpler distant buildings (C2), then
repeat matched four-city captures on the target i5-1035G1 before changing the
integrated-GPU default render scale.
