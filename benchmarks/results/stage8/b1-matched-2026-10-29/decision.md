# B1 matched raw/prebuilt comparison — 29 October 2026

## Decision

B1 remains open. The first matched run found that overlapping neighbor
artifacts were downloaded before fallback. An exact cell-overlap index now
avoids those transfers. The index also gives terrain validation the tile keys
it needs before artifact decode; validation starts after successful artifact
headers and overlaps body consumption. The latest matched headless run lagged
raw mode by 17.8% cold and 10.9% warm, while transferring 7.4% less payload. An
earlier matched follow-up was 8.2% slower cold and near warm parity, showing
meaningful host variance. This is not target-device acceptance, and upload/
submit cost plus editor and lifecycle parity remain unmeasured.

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

## Latest run with index-level terrain prevalidation

The bake index now contains `terrainZoom` and `terrainTileKeys`. After the baked
artifact responds successfully, the runtime starts terrain validation while
`arrayBuffer()` consumes the artifact body. A missing artifact skips terrain
work. The Tokyo index is 10,927 B with nine cell entries and 68 directed
overlap edges. The 16 terrain tile load/decode/build phase took 2.08–2.12 s
across cold runs; the hash itself took 7.1–9.3 ms.

| Mode | Ready median, cold | Ready median, warm | Cold payload | Cold settled state |
|---|---:|---:|---:|---|
| Raw | 3,045 ms | 1,690 ms | 15,473,747 B raw JSON | 8 loaded, 1 failed, 0 deferred |
| Prebuilt with index prevalidation | 3,587 ms | 1,875 ms | 13,583,369 B raw + 745,576 B baked = 14,328,945 B | 8 loaded, 1 failed, 0 deferred |

Prebuilt was 17.8% slower cold and 10.9% slower warm in this run, with 7.4%
less cold payload. The exact cell-overlap check still limited baked downloads to
the spawn artifact. All three runs settled with the same failed neighbor and no
deferred cells. The initial-data-consumer timing includes about 2.08–2.12 s
while terrain tiles are fetched and prepared; further work should examine the
terrain loading gate, not optimize the 7–9 ms hash. The raw control used the
same source except for a failure-path ordering tweak that does not run with its
empty prebuilt index.

## Evidence and remaining gates

The initial and follow-up JSON reports and cold-run screenshots are retained
locally under `raw/`, `prebuilt/`, `b1-validation-overlap-2026-10-29/`, and
`b1-index-validation-2026-10-29/`; they are ignored by Git. This tracked note
contains the reviewable measurements so the raw traces need not be committed.

Before adopting B1, measure target-device readiness and upload costs, determine
whether terrain tiles can be validated without delaying spawn, verify
editor/failure/cancellation/eviction parity, and confirm the overlap index stays
bounded as bake coverage grows. Local
artifacts remain unpublished; production R2 publication is a separate release
task.
