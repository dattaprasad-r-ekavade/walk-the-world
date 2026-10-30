# R5 — Wet-road map evaluation

- Date: 30 October 2026
- App revision: `ab0549d`
- Fixture: recorded Rome OSM showcase; no live-data or R2 writes

## Method

Used visible Chrome 156 on Windows 11 at 1280×720/DPR 1, ANGLE Direct3D 11,
Intel UHD Graphics (`0x0000A78B`), High quality, 21:00, and the same fixed
close-up pose. Recorded screenshots before movement with the baseline and
candidate maps. Captured candidate-mode screenshots at weather 29 and 31 to
inspect the `wetness >= 0.3` switch. Separately ran five interleaved,
five-second baseline/candidate benchmark repetitions with cold recorded data.
All ten measurement windows were valid and showed 24.94–25.11 m of movement.

## First upload and threshold

At weather 29 the candidate remained inactive: 0 of 29 loaded road materials
used it, renderer texture count did not change, and there was no 64×64 upload.
At weather 31 all 29 loaded road materials used the map. Renderer texture count
increased by one, from 57 to 58. The WebGL call was one `texSubImage2D` of an
HTML canvas at 64×64; measured JS submission time was 0.0–0.1 ms. Across five
candidate runs at weather 90, each first upload added one renderer texture;
first residency took 4.1–22.3 ms (median 10.7 ms). These are renderer object
counts and JS submission timings, not direct VRAM-byte measurements.

The weather-29/31 screenshots show a smooth road just below the switch and
broken-up wet highlights immediately above it. At rain 90, the candidate adds
some scattered highlights beneath the street lighting, but the matched pair
does not show a clear overall improvement. The threshold is visually abrupt.

## Matched performance

| Condition | Frame p95 median (range) | GPU p95 median (range) |
|---|---:|---:|
| Baseline, 5 runs | 41.60 ms (34.80–41.70) | 26.278 ms (23.568–26.773) |
| Candidate, 5 runs | 41.60 ms (34.80–41.70) | 26.291 ms (23.301–26.852) |

The ranges overlap. The runs do not establish a performance change or a reason
to accept the extra texture. All ten runs had zero console errors, page errors,
failed assets, or HTTP error responses.

## Decision

Keep the baseline roughness map as the product default. Retain the candidate
only for future benchmark work. Stage 4.3 remains open for broader wet-road
visual tuning and close-up acceptance.

Matched captures:

- [Rain, baseline map](../../../screenshots/performance-visuals/stage4/r5-wet-map/rome-night-rain-baseline.png)
- [Rain, candidate map](../../../screenshots/performance-visuals/stage4/r5-wet-map/rome-night-rain-candidate.png)
- [Weather 29, candidate mode](../../../screenshots/performance-visuals/stage4/r5-wet-map/rome-night-weather-29.png)
- [Weather 31, candidate mode](../../../screenshots/performance-visuals/stage4/r5-wet-map/rome-night-weather-31.png)

Raw JSON remains local and ignored. Reproduce with `--wet-road-map-audit` and
`--screenshot-before-walk`; run the same five-second, fixed-pose benchmark with
`--wet-road-map baseline` and `--wet-road-map candidate`.
