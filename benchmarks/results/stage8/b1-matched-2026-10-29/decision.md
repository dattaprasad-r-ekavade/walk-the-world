# B1 matched raw/prebuilt comparison — 29 October 2026

## Decision

B1 remains open. The first matched run found that overlapping neighbor
artifacts were downloaded before fallback. An exact cell-overlap index now
avoids those transfers, and terrain validation begins earlier to overlap startup.
The latest matched headless run is near warm parity and transfers less total
payload, but remains 8.2% slower cold. This is not target-device acceptance, and
upload/submit cost plus editor and lifecycle parity remain unmeasured.

## Setup

- Tokyo, same frozen 3×3 source snapshot for both modes.
- Same source and Three.js 0.186 dependency tree; separate production builds
  differed only in the compile-time prebuilt index path.
- Three cold/warm repetitions per mode. Each repetition used a fresh browser
  context for cold; warm opened a second page in that context after cold settled.
- Headless Chromium, service workers blocked, browser HTTP cache retained.
- Both modes used the same local source snapshot proxy. The raw mode pointed at
  an empty prebuilt index; the prebuilt index contained the nine baked cells.
- These are headless diagnostics, not visible-device or hardware acceptance.

## Initial result before overlap filtering

| Mode | Ready median, cold | Ready median, warm | Cold payload | Cold settled state |
|---|---:|---:|---:|---|
| Raw | 3,515 ms | 1,846 ms | 15,473,747 B raw JSON | 8 loaded, 1 failed, 0 deferred |
| Prebuilt | 4,486 ms | 1,967 ms | 13,583,369 B raw + 6,729,895 B baked = 20,313,264 B | 8 loaded, 1 failed, 0 deferred |

Prebuilt was 27.6% slower cold and 6.6% slower warm by median ready time. Its
cold payload was 31.3% larger. It requested eight raw neighbor cells and all
nine baked artifacts. Both modes failed the same neighbor cell and showed the
same known local assets 501 and geometry-merge warning.

## Follow-up with exact overlap index and early terrain validation

The baker now records the exact cell keys sharing feature IDs in the current
bake batch. The nine-cell Tokyo index is 8,187 B, and each of the eight
neighboring cells has an overlap edge to spawn. The runtime checks loaded and
in-flight cell keys before requesting a baked file. It retains the decoded
feature-ID check, so absent or incomplete hints still fall back safely after
download. Spawn terrain validation starts as soon as the artifact arrives,
overlapping the remaining startup work.

| Mode | Ready median, cold | Ready median, warm | Cold payload | Cold settled state |
|---|---:|---:|---:|---|
| Raw | 3,494 ms | 1,746 ms | 15,473,747 B raw JSON | 8 loaded, 1 failed, 0 deferred |
| Prebuilt with overlap hints | 3,779 ms | 1,741 ms | 13,583,369 B raw + 745,576 B baked = 14,328,945 B | 8 loaded, 1 failed, 0 deferred |

Only the spawn artifact was downloaded in prebuilt mode. This cut baked payload
from 6,729,895 B to 745,576 B and total payload by 7.4% versus raw. Cold ready
was 8.2% slower; warm ready was effectively even. All three runs in each mode
settled without deferred cells and showed the same failed neighbor and known
local assets 501 and geometry-merge warning. Terrain revision validation took
2.1–2.5 s per cold run, much of which now overlaps startup. The run did not
isolate GPU upload submission by frame.

## Evidence and remaining gates

The initial and follow-up JSON reports and cold-run screenshots are retained
locally under `raw/`, `prebuilt/`, and `b1-validation-overlap-2026-10-29/`; they
are ignored by Git. This tracked note contains the reviewable measurements so
the raw traces need not be committed.

Before adopting B1, measure target-device readiness and upload costs, investigate
terrain-revision validation, verify editor/failure/cancellation/eviction parity,
and confirm the overlap index stays bounded as bake coverage grows. Local
artifacts remain unpublished; production R2 publication is a separate release
task.
