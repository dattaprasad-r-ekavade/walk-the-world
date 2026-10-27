# Recorded OSM cold/warm cache measurements — 28 October 2026

## Five-run cold/warm comparison

The Rome showcase OSM fixture was replayed through the browser's normal city API
and IndexedDB path. Ten visible-Chrome runs interleaved cold and warm conditions
in the order cold, warm, warm, cold, cold, warm, warm, cold, cold, warm. Runs
used medium quality, browser-default rendering, a 12-second walk and the same
local production build. WebGL rendered through Intel UHD / ANGLE D3D11. All ten
measurement windows and host telemetry windows validated; all had zero browser
console, runtime or local asset errors.

| Measure | Cold (5 runs) | Warm (5 runs) |
|---|---:|---:|
| Spawn-cell ready median (range) | 5,358 ms (5,025–6,293) | 2,247 ms (2,034–2,905) |
| Separate warm preflight median (range) | — | 5,427 ms (5,360–6,295) |
| Frame p95 median (range) | 14.1 ms (14.0–20.9) | 14.1 ms (14.0–20.9) |
| GPU timer p95 median (range) | 8.91 ms (8.10–11.54) | 9.09 ms (8.33–12.22) |
| Host system CPU median (range) | 17.3% (16.94–43.07) | 18.4% (17.61–32.61) |
| Median run-average host GPU 3D peak (range) | 92.0% (82.49–94.37) | 91.6% (76.25–92.11) |
| Measured city API cells | 9, including origin | 8 neighbors; origin omitted |

All cold runs reported known encoded response sizes for all nine city API
responses. Warm runs reported no response sizes for their eight city API
responses (77 of 109 total requests had known sizes), so total browser byte
counts are incomplete and must not be compared between modes. Warm readiness is
faster after a separate preflight; the preflight cost is shown separately. Frame
and GPU p95 medians were effectively unchanged in this short fixture workload.
Host ACPI thermal readings were unavailable.

These runs validate repeatable client-side cold/warm behavior for a recorded
city snapshot. Recorded mode serves that same snapshot for each requested city
key; it does not reproduce live Overpass latency or establish a live-network
performance baseline. Raw JSON traces remain in the local temp directory.
The reports identify clean source revision `fdbf314`.

## Cell-boundary walk and drive checks

One 12-second cold recorded walk and one 12-second cold recorded drive crossed
from `wtw_city6_41.890_12.492` into `wtw_city6_41.890_12.498`. Both settled the
expected neighbor, reported no failed cells, and held 10 resident cells against
the 10-cell cap. The walk moved 60.02 m with 1,255 frame/renderer/GPU samples;
the drive moved 22.56 m with the vehicle active and 844 samples. Both
measurement windows were valid and had no browser errors. The renderer/GPU
history cap was raised from 1,200 to 4,096 after an earlier crossing sample
collected 1,259 frames and correctly failed validation at the old bound.

These were one run per movement mode, with the recorded snapshot replayed for
city API cells. They validate boundary setup and resource accounting, not a
five-run walk/drive performance comparison or live network behavior. Raw reports
remain in the local temp directory; the post-cap runs used the production build
at `fdbf314` plus the uncommitted history-cap change.
