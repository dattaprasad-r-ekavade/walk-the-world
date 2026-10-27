# Stage 1.1 assembly-budget decision — 28 October 2026

## Decision

Keep the desktop time-budgeted assembly candidate. Five interleaved cold
baseline/candidate pairs on the same machine kept spawn readiness effectively
flat (paired median +3 ms), kept frame and GPU p95 flat, and brought 93.8% of
spawn assembly chunks to 8 ms or less. The candidate's per-run p95 chunk median
was 8.1 ms (6.8–9.3 ms); the median of per-run maximum chunks was 9.7 ms
(9.1–11.8 ms). The first footprints/walls/roof-caps setup chunk accounts for
the largest remaining overrun.

This closes the desktop implementation and recorded-profile portion of Stage
1.1. It does not close the Stage 1 release exit: mobile and direct input-latency
sampling during assembly remain open. The separate [15-minute desktop resource
soak](resource-soak-2026-10-28.md) now passes, and the Stage 0.8 live-city matrix
also remains open.

## Implementation

The scheduler records synchronous chunks by stage and yields at 75% of the
desktop/mobile target to leave room for work inside a checkpoint. Main-thread
assembly now checkpoints geometry conversion, road painting, props, stations,
bridge and rail meshes, spawn selection, and other loops. Canvas station-label
metrics warm up while worker geometry is running. Neighbor geometry may still
build two cells concurrently, while neighbor scene assembly waits behind the
spawn and other neighbor commits. Scene ownership and geometry semantics are
unchanged.

## Matched capture setup

Five pairs ran baseline first and candidate second. Each pair used a fresh
visible Chrome context and the same production build settings: recorded Rome
fixture, cold IndexedDB, medium quality, 12-second eastbound boundary walk,
seed 1337, day/clear, 1280×720 at DPR 1. The route crossed one cell boundary
and moved about 60 m. The browser was Chrome 156 on Windows 11 Pro, using
ANGLE/D3D11 on Intel UHD Graphics (device `0xA78B`) with a 13th Gen Intel
Core i7-13650HX. Host telemetry coverage was 92% in all ten runs. Average
system CPU medians were 12.72% baseline and 12.04% candidate; 3D-engine peak
medians were 91.25% and 91.27%.

Baseline was `0f10d395` (`Preserve assembly timings in perf reports`). The
candidate was the same base revision with the Stage 1.1 working-tree changes.
The candidate uses an 8 ms desktop / 12 ms mobile target and yields at 75% of
that target (6 ms desktop / 9 ms mobile) to allow for checkpoint work.

## Results

| Metric | Baseline median (range) | Candidate median (range) | Paired median delta (range) |
|---|---:|---:|---:|
| Spawn readiness | 5,160 ms (5,119–5,672) | 5,177 ms (5,163–5,305) | +3 ms (−505 to +163) |
| Spawn assembly wall time | 2,552 ms (2,523–2,685) | 2,626 ms (2,429–2,657) | +61.6 ms (−142.4 to +103.3) |
| First building mark | 2,590 ms (2,505–3,137) | 2,608 ms (2,516–2,744) | −53 ms (−609.7 to +127.6) |
| Frame p95 | 14.0 ms (14.0–14.1) | 14.0 ms (14.0–14.1) | 0 ms (−0.1 to +0.1) |
| GPU timer p95 | 7.62 ms (7.51–7.74) | 7.60 ms (7.53–7.71) | −0.02 ms (−0.17 to +0.09) |

Candidate-only assembly chunk results:

| Measure | Median of per-run values | Range |
|---|---:|---:|
| Spawn chunk p95 | 8.1 ms | 6.8–9.3 ms |
| Longest spawn chunk | 9.7 ms | 9.1–11.8 ms |
| Neighbor chunk p95 | 6.2 ms | 6.0–6.4 ms |

Across 129 spawn chunks, 121 (93.8%) were at or below 8 ms. Eight exceeded
8 ms, with the largest at 11.8 ms in the first footprints/walls/roof-caps
chunk. The station label measurement no longer appears among the over-budget
chunks. Neighbor assembly stayed serialized while up to two geometry builds
remained in flight.

All ten captures had valid frame and host windows, crossed into the expected
neighbor, settled at 10/10 resident cells, retained an unwrapped 4,096-event
timing history, and reported zero validation, console, page, asset, transport,
or HTTP errors. See the [compact per-run summary](assembly-budget-interleaved-five-run.json)
and [candidate scene capture](assembly-budget-candidate-2026-10-28.png). Raw
benchmark JSON stays in `%TEMP%` as
`wtw-stage1-interleaved-{baseline,candidate}-repN.json`.

`npm test` passed (13 files, 108 tests), and `npm run build` completed
successfully on the candidate.

## Limits and next work

This replay shows client-side assembly behavior, not live Overpass latency.
The capture did not inject input during the assembly interval, so the measured
result is bounded synchronous work rather than a direct input-latency score.
Only this desktop was available; the 12 ms mobile target has not been measured.
The 12-second crossing does not establish resource stability over a 15-minute
walk. The older Intel UHD 630 profile remains historical context rather than
the matched baseline for this run.

Stage 1.2 queue bounds, cancellation, stale-result rejection and rollback are
now implemented and covered by the lifecycle checkpoint. Before closing Stage
1, test mobile assembly, a real-city walk/return route, and input latency during
city assembly. Retry the live Stage 0.8 city matrix when the API returns
complete cells.

Rollback: revert the Stage 1.1 checkpoint commit. Baseline code remains at
`0f10d395`; no dependency or geometry-semantics changes are part of this
candidate.
