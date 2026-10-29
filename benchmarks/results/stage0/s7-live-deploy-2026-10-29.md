# S7 live-deploy smoke — 29 October 2026

## Post-fix production verification on `23a34cc`

The production alias returned HTTP 200 and served service-worker revision
`3bb316b8cfff7f70`, matching the build for `23a34cc`. A visible, focused Chrome
session at 1280×720 traveled from Tokyo to Edinburgh. At arrival the Fast Travel
panel was closed; the location button showed “Edinburgh, United Kingdom of Great
Britain and Northern Ireland” after 1.5 seconds and still showed it after the
five-second settled window. The screenshot is in the ignored sibling directory
`benchmarks/results/stage0/s7-live-deploy-2026-10-29-after-23a34cc/`.

The settled window captured 377 animation-frame intervals (p95 20.9 ms, maximum
152.8 ms). The page remained visible and focused. There were zero console errors
and zero HTTP responses >=400. This verifies the street-travel UI fix and closes
the R7 smoke/diagnostics gap. It does not replace the full S7 travel threshold
check: the preceding full tour on `71450de` still had an 881.9 ms globe-travel
frame, and neither tour used the target Intel UHD i5-1035G1 laptop.

## Complete follow-up on `71450de`

The production alias `https://walk-the-world-delta.vercel.app` returned HTTP
200 and served service-worker revision `533e5711588a5f5d`, matching the build
for `71450de`. One visible, focused Chrome session at 1280×720 completed travel
to Tokyo, a three-second walk, the day-to-night switch, and street travel to
Edinburgh. The WebGL renderer was ANGLE D3D11 on Intel UHD Graphics (0xA78B) on
an Intel Core i7-13650HX host. This is not the Intel UHD i5-1035G1 demo laptop.

| Segment | Duration | Frames | p95 | Maximum | Over 500 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Globe travel to Tokyo | 10.72 s | 721 | 27.8 ms | 881.9 ms | 1 |
| Walk | 3.29 s | 191 | 27.8 ms | 90.3 ms | 0 |
| Night switch | 1.55 s | 105 | 20.8 ms | 41.6 ms | 0 |
| Street travel to Edinburgh | 5.93 s | 449 | 34.7 ms | 243 ms | 0 |

The player position changed during the walk. The browser reported zero console
errors and zero HTTP responses >=400. Eight requests were aborted as navigation
changed the visible map/audio. A separate production-origin GET of the Tokyo
R2 cell returned HTTP 200, `application/json`, 3,665 elements, and was readable
from page JavaScript, confirming CORS for the live-data path.

The tour completed, but S7 does not pass: globe travel had one 881.9 ms frame.
The other measured segments stayed below 500 ms. The hardware also differs from
the target demo laptop. The Edinburgh screenshot retained the Fast Travel panel
and the previous Shibuya label; the current code changes close the panel and
clear the stale label on a street travel. That fix needs post-deploy confirmation.
The raw report and screenshots are in the ignored sibling directory
`benchmarks/results/stage0/s7-live-deploy-2026-10-29-after-71450de/`.

## Earlier partial run on `e1d8289`

## Scope and environment

The production URL `https://walk-the-world-delta.vercel.app` returned HTTP 200.
Its `sw.js` cache revision matched the locally computed revision for
`e1d8289`, confirming that the live page included the current `origin/main`
build. One headed Chrome session (156.0.8078.49, 1280×720) used this host:
Intel Core i7-13650HX with Intel UHD and NVIDIA RTX 4060 Laptop GPU adapters.
The run did not capture the WebGL adapter, so it is not target-device evidence
for the Intel UHD i5-1035G1 system used for the smoothness baseline.

## Observed segment

Globe travel to Tokyo took 13.19 s and collected 985 animation-frame intervals.
Frame p95 was 20.9 ms; maximum was 909.6 ms, with one interval over 500 ms.
The page was visible and focused. The Tokyo street view rendered after arrival.

The browser logged one generic HTTP 404 and one BigDataCloud reverse-geocode
timeout. A direct production request confirmed that
`/prebuilt-cells/index.json` returns 404. The browser run did not record the URL
associated with its generic 404, so that error is not attributed to the index.
Several OpenStreetMap tile requests were reported as `net::ERR_ABORTED`.

## Coverage and next action

The harness selected the 86×86 brand-icon canvas instead of the street renderer
canvas and stopped before walking, the night switch, or a second city trip.
Those segments have no results. This run does not pass S7. The production
prebuilt lookup now requires an explicitly configured
`NEXT_PUBLIC_PREBUILT_CELL_BASE`, because B1 artifacts are intentionally not
published. The later `71450de` tour above supersedes this incomplete run: it
completed all segments, saw no HTTP or console errors, and verified the public-
R2 CORS path. S7 still fails because globe travel exceeded the frame threshold
on a different Intel UHD machine; repeat on the specified demo laptop.

Local-only raw report and Tokyo screenshot are in the ignored sibling directory
`benchmarks/results/stage0/s7-live-deploy-2026-10-29/`.
