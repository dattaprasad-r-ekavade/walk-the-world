# S7 live-deploy smoke — 29 October 2026

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
published. After that change deploys, rerun a single complete tour on the Intel
UHD demo laptop; verify every response status, the public-R2 CORS path, and the
walk, night-switch, and travel frame thresholds.

Local-only raw report and Tokyo screenshot are in the ignored sibling directory
`benchmarks/results/stage0/s7-live-deploy-2026-10-29/`.
