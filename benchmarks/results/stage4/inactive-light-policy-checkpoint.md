# Stage 4.4 — Inactive street-light pool cost

Date: 28 October 2026

App base revision: `73316d4e8f9052265d1bd9b5328bfce94b96e3fc`

Status: steady-state and day/night transition costs measured on one integrated
GPU; keep the shipped visible-light policy because hiding inactive lights causes
a repeatable first-night shader-compilation stall.

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

## Day/night transition check

Two valid visible/hidden pairs used the same recorded Rome, High, noon/clear,
post-processing-off setup. Before each transition, the frame-interval history was
cleared. The measurement waited through the requested 2.5-second window and then
captured the first rendered frame after any main-thread stall. Both transitions
in each run validated the expected active-light state and visibility policy.

| Policy | Pair | Noon → night frame p95 | >100 ms frames | Shader programs | Night → noon frame p95 | Shader programs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Visible | 1 | 33.4 ms | 0 | 87 → 87 | 33.4 ms | 87 → 87 |
| Visible | 2 | 33.4 ms | 0 | 87 → 87 | 33.5 ms | 87 → 87 |
| Hidden | 1 | 2716.3 ms | 1 | 65 → 83 | 17.1 ms | 83 → 85 |
| Hidden | 2 | 2866.3 ms | 1 | 65 → 83 | 17.2 ms | 83 → 85 |

The visible transition samples contained 126 and 131 intervals for noon-to-night;
the hidden samples contained only four and three intervals because the first
night activation blocked the render thread for about 2.7–2.9 seconds. On both
hidden runs, returning to day added two more shader programs without a long
stall. The second pair independently reproduced the same program-count changes
and hitch. Raw transition captures remain local as
`light-transition-{visible,hidden}-{retest,pair2}.json`.

## Decision and remaining gate

Keep inactive lights visible in the shipped runtime. Hiding them has a lower
median daytime GPU timer p95 in this small sample, but it causes a repeatable
2.7–2.9 second first-night shader stall and adds 18 shader programs on this
Intel UHD Graphics laptop. Visible lights keep the program count stable across both
time changes. The benchmark-only hidden setting remains available for future
device-specific checks; the product default is unchanged. These transition
measurements cover one integrated GPU and do not establish mobile behavior.

Device labels were checked against all 18 retained lighting capture files.
Their Windows host telemetry consistently records an Intel Core i5-1035G1 and
`Intel(R) UHD Graphics`; the saved adapter name does not identify the GPU as
UHD 630. References to UHD 630 in this report were incorrect and are removed.

Validation after the implementation: `npm test` passed 132 tests across 19
files; `npm run build` passed. The benchmark runner validates requested
post-processing, inactive-light states, both transition captures, and shader
program counts in the saved result.
