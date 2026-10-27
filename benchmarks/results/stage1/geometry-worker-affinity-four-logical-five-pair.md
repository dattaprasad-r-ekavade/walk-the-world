# Stage 1.3 geometry-worker comparison — 28 October 2026

## Decision

Keep the current two-worker default. Under a four-logical-CPU affinity cap, two
workers reduced worker queue delay, but the five paired runs showed no reliable
improvement in cold readiness, neighbor geometry time, frame p95, or GPU p95.
Do not treat this constrained desktop as a low-core device result.

Stage 1.3 remains open. This checkout has no KTX2 decoder loader yet; the plan
places the shared bounded loader in Stage 3.5. Revisit worker count and memory
after decoder workers exist and on a physical low-core device.

## Setup

Five pairs used the recorded Rome OSM fixture with alternating one-then-two and
two-then-one order. Each run used a fresh visible Chrome context, cold browser
cache, medium quality, day/clear conditions, a 12-second eastbound cell-crossing
walk, 1280×720 at DPR 1, and seed 1337. All ten runs passed movement, cell
crossing, settled-neighbor, resource-cap, and measurement-window validation.
There were no console, page, or local-asset errors.

The machine was a 13th Gen Intel Core i7-13650HX laptop (14 cores, 20 logical
processors), 16 GB device memory, Windows 11 Pro, and Chrome 156 using Intel UHD
Graphics through ANGLE/D3D11. The benchmark Node process and newly created Chrome
processes were pinned to logical-processor affinity mask `0xF`; the browser still
reported 20 logical processors. This limits client execution as a desktop proxy,
but does not reproduce a low-power CPU, its memory bandwidth, or thermal limits.
The local Next.js server was not affinity-limited.

Run the production server with `npm run start -- -p 3456`, then use
`scripts/bench-worker-pool-ab.ps1 -Pairs 5 -LogicalCpuCount 4` to reproduce the
interleaved captures. The runner confirms the configured pool size in the page
and writes raw runs under `%TEMP%`. The compact per-run data is in
[`geometry-worker-affinity-four-logical-five-pair.json`](geometry-worker-affinity-four-logical-five-pair.json).

Captures used base revision `a73c76e`; the working tree also contained the
benchmark-only worker-count control and reporting changes in this checkpoint.

## Results

Values are medians of five runs, with per-run ranges in parentheses. Paired
deltas are two workers minus one worker.

| Measure | One worker | Two workers | Paired delta |
|---|---:|---:|---:|
| Cold city-ready time | 5,493 ms (5,288–6,128) | 5,586 ms (5,415–6,106) | +235 ms (−553 to +613) |
| Spawn geometry total | 351.6 ms (321.5–792.5) | 306.8 ms (304.3–802.7) | −33.7 ms (−485.7 to +481.2) |
| Neighbor geometry median per run | 17.9 ms (16.1–23.1) | 19.0 ms (14.1–24.8) | −1.4 ms (−4.1 to +6.9) |
| Worker-queue p95 per run | 5.2 ms (0.6–5.5) | 0.5 ms (0.4–0.6) | −4.6 ms (−5.1 to −0.1) |
| Worker-compute median per run | 6.1 ms (4.2–7.2) | 9.4 ms (6.7–13.8) | +3.0 ms (+2.5 to +6.6) |
| Frame p95 | 14.3 ms (14.1–14.5) | 14.4 ms (14.2–14.5) | +0.1 ms (−0.3 to +0.3) |
| GPU timer p95 | 7.627 ms (7.433–7.680) | 7.532 ms (7.525–7.697) | −0.06 ms (−0.15 to +0.26) |

Two workers consistently shortened measured queue delay. That did not translate
into a repeatable readiness or frame-time improvement; individual compute jobs
also took longer at the higher concurrency. Keep two workers pending broader
device coverage rather than adding a low-core fallback from this proxy.

Windows minimum available memory had overlapping run ranges: 5,046–5,450 MB
with one worker and 5,061–5,471 MB with two. These are system-wide readings,
not per-worker or browser-process memory, so they do not establish decoder or
worker memory cost. KTX2 decoding was not active in these captures.
