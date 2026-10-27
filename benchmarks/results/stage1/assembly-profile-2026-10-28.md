# Recorded Rome assembly profile — 28 October 2026

## Capture integrity

The previous 2,000-entry performance timeline saturated during a 12-second
visible-Chrome run: frequent render-submit samples displaced the earlier spawn
assembly events. The browser result schema is now v3, the bounded timeline holds
4,096 events, and benchmark results report its sample count, capacity and wrap
state. A regression test keeps an early assembly event through a 3,000-sample
render burst.

Five cold recorded-city runs on the `33e905f` main revision were repeated with
the recorder change in the working tree. Each used Chrome 156, visible Intel UHD
630 / ANGLE D3D11, 1280×720 at DPR 1, medium quality, the 4,524-element Rome OSM
fixture, seed 1337, and a 12-second boundary walk. All five frame and host
windows validated, host coverage was 92%, each crossed into the expected cell,
and all reported zero validation, console, page or asset errors. Each trace kept
2,626–2,657 of 4,096 events without wrapping. The compact per-run data is in the
[five-run JSON summary](recorded-rome-assembly-profile-five-run.json).

## Timing results

| Stage | Median of per-run medians | Range of per-run medians | Events |
|---|---:|---:|---:|
| Spawn geometry | 219.8 ms | 205.6–235.7 ms | 1/run |
| Spawn assembly | 2,612.7 ms | 2,450.3–2,630.3 ms | 1/run |
| Neighbor geometry | 13.1 ms | 12.15–13.7 ms | 8/run |
| Neighbor assembly | 38.8 ms | 35.6–42.8 ms | 8/run |
| Worker compute | 7.6 ms | 5.7–8.5 ms | 9/run |
| Worker roundtrip | 14.1 ms | 13.1–15.5 ms | 9/run |
| Road canvas paint | 0.1 ms | 0.1–0.1 ms | 9/run |

Median spawn-cell readiness was 5,084 ms (4,954–5,396 ms). Median frame p95
was 14.0 ms in every run; GPU timer p95 median was 7.533 ms (7.467–7.681 ms).
Each run moved about 60 m and settled with 10/10 resident cells.

## Decision and next work

Spawn assembly is the clearest Stage 1.1 candidate in this recorded workload.
Its wall duration is over ten times the spawn geometry duration, while worker
compute, worker roundtrip and road painting are much smaller. This identifies a
main-thread assembly target; it does not prove that the whole 2.6 seconds is CPU
work. `city.spawn-assembly-total` includes existing asynchronous checkpoints and
their scheduling delay. The recorded fixture replays the same Rome snapshot for
each city key, so these results do not replace the live-city matrix or establish
live Overpass latency.

Next, measure individual uninterrupted assembly slices and replace per-object
yields with time-budgeted batches, beginning at 8 ms desktop / 12 ms mobile.
Prioritize the spawn cell before neighbors; preserve scene rollback and compare
startup readiness, longest slice, full assembly wall time, frame/GPU p95 and
streaming behavior in repeated baseline/candidate runs. Keep the live Stage 0.8
matrix open until the city API returns complete cells.

Rollback for the recorder change is to restore `PERF_TIMING_LIMIT` and
`PERF_SCHEMA_VERSION`, remove the `timingHistory` result field, and retain this
profile as historical evidence with its v3 schema label.
