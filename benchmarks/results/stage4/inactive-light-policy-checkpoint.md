# Stage 4.4 — Inactive street-light pool cost

Date: 28 October 2026

Base revision: `a8a28f518c28ef7869e2edc6f77ee1fc275a9e94`

Status: steady-state cost measured on one integrated GPU; runtime policy stays
unchanged until day/night shader-variant transitions are measured.

## Question and method

The high-quality street engine keeps four pooled spotlights visible at zero
intensity so Three.js keeps a stable light count in lit-material shaders. This
avoids a shader variant compile when the lights turn on, but those four lights
may still add per-fragment work during the day.

The benchmark adds `--inactive-lights visible|hidden` to compare the current
policy with inactive lights hidden. It also adds `--postfx-mode off` so both
conditions omit SSAO and bloom during this isolated lighting comparison. Both
controls are benchmark-only; the shipped default still keeps inactive lights
visible.

Five valid twelve-second runs per condition used the recorded Rome fixture in
visible Chrome 155 on a Lenovo 81W8 with an Intel Core i5-1035G1 and Intel UHD
Graphics. The view was 1280×720 at DPR 1, High quality, noon, clear weather,
with two geometry workers. Every run had a valid browser measurement window and
host-telemetry window. The four-light pool was present and no light was active;
the visible condition had 4/4 light objects visible and the hidden condition
had 0/4 visible. All runs recorded zero failed requests, HTTP errors, and
benchmark validation errors.

The initial smoke runs, pair 6, and pair 7's first visible run were excluded
from the five-run summary because their host windows ended before the last
sample. Pair 7's visible run was repeated after extending telemetry sampling;
the replacement has a valid host window. Raw 12-second traces remain local.

## Results

| Condition | Valid runs | GPU timer p95 median (range) | Frame p95 median (range) | Average FPS median |
| --- | ---: | ---: | ---: | ---: |
| Four inactive lights visible | 5 | 13.18 ms (11.92–13.69) | 33.4 ms (33.3–33.4) | 53 |
| Four inactive lights hidden | 5 | 10.68 ms (8.26–13.87) | 17.2 ms (16.8–33.5) | 57 |

The hidden condition had a lower GPU timer p95 in four of the five paired runs.
The median GPU timer p95 was 2.50 ms (about 19%) lower, but the condition
ranges overlap. Hidden frame p95 values split between about 17 ms and 33 ms;
the visible runs stayed near 33 ms. This points to a possible frame-rate
benefit on this device, but the refresh-bucket split and the overlapping GPU
ranges do not establish a stable cross-device improvement. Host CPU and GPU
utilization varied during the captures. Median host GPU-engine utilization was
66.6% hidden and 69.7% visible; it is contextual telemetry, not an attribution
to the four lights.

## Decision and remaining gate

Keep inactive lights visible in the shipped runtime for now. Hiding them changes
the light count in material shader programs; when a light becomes active, the
engine must use or compile a different shader variant. This experiment settles
the static daytime rendering cost but does not measure the first night
activation, returning to day, or user-triggered time changes. Measure those
transition stalls and shader-cache behavior before changing the policy. The
current implementation exposes the hidden behavior to benchmarks, with unit
coverage that verifies active lights remain visible and inactive lights follow
the selected policy.

Validation after the implementation: `npm test` passed 132 tests across 19
files; `npm run build` passed. The benchmark runner validates requested
post-processing and inactive-light states in the saved result.
