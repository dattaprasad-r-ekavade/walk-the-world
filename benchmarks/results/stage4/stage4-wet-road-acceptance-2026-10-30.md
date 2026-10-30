# Stage 4.3 — Wet-road close-up acceptance

- Date: 30 October 2026
- Source revision: `b6cc595`
- Scenario: recorded Rome fixture; baseline material map; no live-data or R2 writes

## Current-build visual check

Ran the production app in visible Chrome 156 on Windows 11 at 1280×720/DPR 1,
using ANGLE Direct3D 11 on Intel UHD Graphics (`0x0000A78B`). Both screenshots
use the same fixed pose (x −30.5 m, z 104.8 m, heading −1.58 rad, pitch −0.65
rad), High quality, and 21:00. The clear capture used weather 0; the rain
capture used weather 90. Each five-second measurement window passed, with
about 25 m movement and zero console errors, page errors, failed assets, or
HTTP errors.

The clear road reads as dark and matte. In rain, the same asphalt gains a
restrained blue sheen and the nearby lamp produces a visible reflection on the
roadside pavement. The wet response is visible at this road-focused angle and
does not require the thresholded candidate texture.

## Performance and decision

The five-run R1 comparison remains the measured performance basis: frame-p95
medians were 41.70 ms in both conditions; GPU-p95 medians were 26.67 ms clear
and 27.15 ms in rain, with overlapping ranges. The five-run R5 candidate
comparison found no measurable benefit from adding its texture and showed an
abrupt patch pattern around its activation threshold.

Accept the current baseline wet-road behavior for Stage 4.3. Keep the
benchmark-only map rejected and preserve the existing material path. This
closes the close-up baseline acceptance item; mobile portability and any
SSR/planar reflection work remain outside this acceptance.

## Captures

- [Night, clear baseline](../../../screenshots/performance-visuals/stage4/stage43-wet-road/rome-night-clear-baseline.png)
- [Night, rain baseline](../../../screenshots/performance-visuals/stage4/stage43-wet-road/rome-night-rain-baseline.png)

Raw benchmark JSON remains local and ignored. See the [R1 intensity and
five-run report](r1-closeup-environment-check-2026-10-30.md) and the [R5
candidate evaluation](r5-wet-road-map-evaluation-2026-10-30.md) for detailed
measurement tables.
