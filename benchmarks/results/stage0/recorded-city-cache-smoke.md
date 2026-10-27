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

## Five-run cell-boundary walk and drive comparison

Five cold recorded runs per movement mode crossed from
`wtw_city6_41.890_12.492` into `wtw_city6_41.890_12.498`. Each run loaded and
settled the expected neighbor, reported no failed cells, and held 10 resident
cells against the 10-cell cap. All ten measurement and host telemetry windows
validated, and all ten had zero browser console, runtime or local asset errors.

| Measure | Walk (5 runs) | Drive (5 runs) |
|---|---:|---:|
| Spawn-cell ready median (range) | 5,032 ms (4,878–5,149) | 4,904 ms (4,830–5,143) |
| Movement median (range) | 60.07 m (60.03–60.12) | 22.10 m (21.79–22.98) |
| Frame p95 median (range) | 14.0 ms (14.0–14.0) | 20.8 ms (20.8–20.9) |
| GPU timer p95 median (range) | 7.67 ms (7.39–7.89) | 12.13 ms (11.46–12.30) |
| Host system CPU median (range) | 17.1% (15.16–19.02) | 15.5% (13.43–17.57) |
| Median run-average host GPU 3D peak (range) | 90.9% (90.32–91.02) | 90.1% (89.18–90.39) |
| Geometries / textures / programs (median) | 287 / 27 / 28 | 297 / 27 / 28 |
| City API requests / known encoded city bytes | 12 / 16,317,612 | 12 / 16,317,612 |

The drive runs show higher GPU timer and frame p95 than walking on this recorded
scene, while host system CPU averages were lower. The integrated Intel GPU's
3D peak stayed near 90% in both modes. This points to GPU pacing as a material
factor for this specific workload; host CPU percentages are system-wide and do
not measure main-thread assembly directly. Windows ACPI thermal readings were
unavailable. These results do not establish live Overpass throughput or a
production-device performance guarantee.

The recorded runner serves the same Rome snapshot for each requested city key,
so the 12 cell response bodies and their bytes are local fixture replay, not
independent live-cell payloads. The raw reports remain in the local temp
directory. These runs used clean source revision `98ef7d8` and the production
bundle after the renderer/GPU history cap had been raised from 1,200 to 4,096;
the earlier 1,259-sample crossing had correctly failed validation at the old
bound.
