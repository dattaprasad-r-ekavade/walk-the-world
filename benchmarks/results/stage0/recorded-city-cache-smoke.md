# Recorded OSM cold/warm cache smoke — 28 October 2026

Purpose: validate the recorded-data benchmark path and browser cache protocol.
The checked-in Rome OSM fixture was replayed through the normal city API path
in a visible Chrome session at medium quality with browser-default rendering.
Each measured movement window was four seconds, with one run per condition.

| Scenario | Spawn-cell load | Prewarm | Movement / streaming | Browser-visible response bytes |
|---|---:|---:|---|---:|
| Cold recorded | 6,683 ms | — | 20.09 m; no boundary crossing | 14,069,806 across 105 requests; 9 city cells |
| Warm recorded | 3,145 ms | 6,298 ms; IndexedDB entry verified | 20.12 m; no boundary crossing | 1,458,219; the spawn-cell API request was absent |
| Cold recorded crossing | 6,246 ms | — | 20.06 m; east neighbor loaded; 10/10 cells resident; no failed cells | 18,268,370 across 113 requests; 12 city cells |

All three runs reported no browser console, page, or local-asset errors. These
single four-second smokes confirm that cold and warm cache setup, request
accounting, and cell-crossing validation work. They are not five-run performance
baselines and do not estimate live Overpass latency: the recorded mode replays
the same Rome snapshot for each requested city key. The raw reports remain in
the local temp directory rather than this commit.

The benchmark reports identify source revision `4783a57` and a dirty working
tree because the recorded replay mode was under development during capture. The
Next.js production bundle itself had already built successfully; these smokes
validate the uncommitted runner changes against that bundle.
