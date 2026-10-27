# Stage 1 desktop resource soak — 28 October 2026

## Result

The 15-minute resource-stability walk passed on one Windows laptop using the
recorded Rome fixture. The browser remained visible and focused, the walk moved
4,483.8 m and crossed into the final streamed cell, and the cell queue settled
without failures at the 10/10 resident-cell cap. The runner's obstacle-avoidance
steering made one heading change. The result closes the desktop resource-soak
check; it does not close the mobile, low-core, KTX2-contention or live-city gates.

| Check | Result |
|---|---:|
| Requested / observed walk | 900,000 / 900,020 ms |
| Walking path / net displacement | 4,500.0 / 4,483.8 m |
| Renderer resource samples | 887 / 900 s; 98.6% coverage |
| Largest resource-sample gap | 1,033 ms |
| Final cell streaming | Settled; 0 failed cells; 10 / 10 residents |
| Host telemetry | 884 in-window samples; validator passed |

Three.js renderer counts rose during initial streamed movement and then
stabilised. Geometries reached 174 by minute 5 and stayed in a 168–174 range
through the final 10 minutes. Textures reached 32 by minute 3 and ended at 32;
one later minute ranged from 29 to 32. Programs reached 30 by minute 3 and
remained at 30. These are renderer object counts, not VRAM measurements.

The capture used medium quality, browser-default WebGL on Chrome 156 at
1280×720 / DPR 1, with two geometry workers, read-only city data, and indexed
road queries. The host was a Lenovo 83DV running Windows 11 Pro, with a 14-core /
20-thread Intel i7-13650HX and an NVIDIA RTX 4060 Laptop GPU. Average system CPU
was 6.95%, minimum available memory was 5,189 MB, and average peak GPU 3D
utilization was 34.37%. Windows denied access to ACPI thermal readings, so this
run makes no thermal-stability claim. Attributable process memory and VRAM were
not available.

## Measurement notes

Resource samples are captured once per second in a bounded 1,800-entry ring.
The soak validator checks elapsed wall time, page focus and visibility, sample
coverage and gaps, cumulative movement, and settled cell streaming. It requires
at least 0.5 m/s average cumulative walking distance, preventing a player blocked
early in the run from passing a nominal 15-minute timer. The resource-count
summary uses 60-second windows. The ordinary frame/GPU history saturates during
this long capture and is explicitly marked not applicable; it is not used to
judge resource stability.

The first unsteered attempt moved 67.5 m before a building stopped the player.
It was rejected after the movement threshold was added. The successful run used
footprint-aware heading changes while retaining normal pedestrian movement and
collision.

The compact [JSON result](resource-soak-2026-10-28.json) retains the validators,
per-minute resource windows, host aggregates, browser details, and cell-stream
state. Raw per-second resource and host samples, plus capped frame/GPU histories,
are omitted from the checked-in summary. The current `npm test` suite passes all
119 tests, and `npm run build` succeeds.

## Remaining gates

- Repeat resource and thermal measurements on real mobile hardware.
- Measure worker count and attributable memory on a physical low-core device;
  include KTX2 decoder contention when that texture pipeline is exercised.
- Measure assembly-time input latency on mobile.
- Retry dense live-city cold/warm walk and drive captures when the upstream city
  API returns complete cells.
