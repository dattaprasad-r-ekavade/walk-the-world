# B1 matched raw/prebuilt comparison — 29 October 2026

## Decision

B1 remains open. The first matched run found that overlapping neighbor
artifacts were downloaded before fallback. An exact cell-overlap index now
avoids those transfers. The baker records only the terrain tiles sampled while
building each artifact, and runtime preflight loads their height grids without
building terrain visuals or requesting imagery. The latest matched headless
run was 4.7% slower cold and 5.8% faster warm than raw, with 7.4% less payload.
The visible Chrome comparison below confirms the path on this host's NVIDIA
RTX 4060 Laptop GPU: 4.2% slower cold, 8.3% faster warm and 7.3% less payload.
Cold height validation still has a 1.58–2.01 s range (1.72 s median). Startup
frame/GPU samples are too bursty to establish steady-state frame acceptance;
WebGL does not expose reliable allocated VRAM or direct upload-byte totals.
Lower-tier device parity and browser editor/failure acceptance remain open.
Unit tests cover editor-change fallback, prebuilt-fetch cancellation, and
eviction/revisit through the prebuilt path.

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

## Prior run with 16-tile index-level terrain prevalidation

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

## Latest run with sampled terrain dependencies and height-only preflight

The baker still loads the one-tile safety margin while building geometry, but
records and hashes only terrain tiles actually sampled by `buildCityGeometry`.
The Tokyo spawn artifact now depends on four tiles rather than 16; the other
eight cells use two to five. The nine-cell index is 9,453 B with 68 directed
overlap edges. Runtime validation fetches and decodes height grids without
creating scene meshes or starting ground imagery requests. Later visual terrain
streaming reuses those decoded grids, avoiding a second elevation fetch.

| Mode | Ready median, cold | Ready median, warm | Cold payload | Cold settled state |
|---|---:|---:|---:|---|
| Raw | 3,406 ms | 1,793 ms | 15,473,747 B raw JSON | 8 loaded, 1 failed, 0 deferred |
| Prebuilt with sampled terrain keys | 3,567 ms | 1,689 ms | 13,583,369 B raw + 745,555 B baked = 14,328,924 B | 8 loaded, 1 failed, 0 deferred |

Prebuilt was 4.7% slower cold and 5.8% faster warm, with 7.4% less cold
payload. All three runs reached ready and settled without deferred cells, with
the same failed neighbor and known local assets 501 and geometry-merge warning.
The four-height-tile cold load phase took 1.82–2.10 s; hashing took 6.8–9.0 ms.
The matched headless runs still show large first-repetition host variance.

The reports and captures are in the ignored local directory
`benchmarks/results/stage8/b1-height-only-2026-10-29/`. This comparison
includes the current terrain loader, unlike the preceding `b1-sampled-terrain`
comparison. The sampled-key implementation also cuts validation-only work and
retains the one-tile bake margin for edge samples.

## Visible Chrome hardware comparison — 29 October 2026

This matched run used the same frozen Tokyo source snapshot and production
settings on both builds. Chrome 156.0.8078.49 ran headed, visible and focused;
the WebGL2 renderer was ANGLE on the NVIDIA GeForce RTX 4060 Laptop GPU using
D3D11. Each mode had three cold/warm repetitions, with service workers blocked
and browser HTTP cache enabled. All six cold runs and all six warm visits
reached ready and settled at eight resident cells, one failed neighbor and no
deferred cells. The same local `/api/assets` 501 and geometry-merge warning
appeared in both modes.

The prebuilt spawn artifact was rebaked at the exact Tokyo demo origin
(`35.6595, 139.7005`). Baking at the rounded cache-key origin had clipped 1,569
features versus 1,644 on the raw runtime path and visibly changed the near
facade. The exact-origin artifact contains 1,644 clipped features; the matched
captures now show the same spawn facade and street framing.

| Mode | Cold ready times | Cold median | Warm ready times | Warm median | Cold payload | Settled state |
|---|---|---:|---|---:|---:|---|
| Raw | 6,945 / 3,302 / 3,131 ms | 3,302 ms | 2,049 / 1,992 / 1,757 ms | 1,992 ms | 15,473,747 B raw | 8 loaded, 1 failed, 0 deferred |
| Prebuilt, exact origin | 5,796 / 3,370 / 3,440 ms | 3,440 ms | 1,845 / 1,827 / 1,800 ms | 1,827 ms | 13,583,369 B raw + 761,437 B baked = 14,344,806 B | 8 loaded, 1 failed, 0 deferred |

On this host, prebuilt was 4.2% slower cold and 8.3% faster warm, with 7.3%
less cold payload. Height-only validation for the four sampled terrain tiles
took 1,579.7–2,013.9 ms (1,722.6 ms median); hashing took 6.8–9.7 ms. GPU timer
queries were supported and renderer/frame/GPU samples plus resource counts were
captured at engine-ready and stream-settled. The small startup windows include
large first-run spikes, so their p95 values are diagnostic only. WebGL exposes
neither a reliable VRAM allocation total nor direct per-geometry upload bytes.
The total-ready comparison includes terrain gating, decode, build, assembly and
shader warm-up, but does not isolate GPU upload submission. The limited
comparative result on one discrete GPU does not close B1.

Full reports and screenshots are retained in the ignored local directory
`benchmarks/results/stage8/b1-visible-chrome-2026-10-29/`.

## Fixed post-settle visible Chrome window — 29 October 2026

The benchmark now starts a fixed five-second frame/GPU sampling window after
the cell stream settles. It clears only its diagnostic ring buffers after a
250 ms pre-window delay, leaving startup and terrain timings intact. This matched run used
the same frozen Tokyo snapshot and the visible, focused Chrome 156 session on
the RTX 4060; service workers were blocked and each visit produced about 300
frame and GPU samples. All visits settled at eight resident cells, with the
same failed neighbor and no deferred cells.

| Mode | Cold ready times | Cold median | Warm ready times | Warm median | Cold payload |
|---|---|---:|---|---:|---:|
| Raw | 5,723 / 3,431 / 3,074 ms | 3,431 ms | 1,867 / 1,694 / 1,765 ms | 1,765 ms | 15,473,747 B |
| Prebuilt | 6,416 / 3,590 / 3,414 ms | 3,590 ms | 1,870 / 1,868 / 1,745 ms | 1,868 ms | 13,583,369 B raw + 761,437 B baked = 14,344,806 B |

In this run prebuilt was 4.6% slower cold and 5.8% slower warm by median ready
time, while transferring 7.3% fewer cold bytes. Every five-second frame-interval
p95 was 16.8–16.9 ms in both modes. GPU-time p95 values were 4.85–6.84 ms for
raw cold and 6.97–16.82 ms for raw warm; prebuilt ranged 4.95–16.87 ms cold
and 6.10–16.91 ms warm. A p95 near the display interval appeared in raw warm,
prebuilt cold and prebuilt warm; raw cold had no such outlier. The GPU samples
remain noisy diagnostics, not a reliable comparative acceptance result. The
steady window measures frame rendering but does not isolate per-geometry GPU
upload submission or VRAM.

The benchmark and raw reports/screenshots are retained locally under
`benchmarks/results/stage8/b1-steady-visible-chrome-2026-10-29/` and are
ignored by Git. B1 remains open for lower-tier device parity, browser editor and
failure-path acceptance, cold terrain-gate work, upload-cost investigation,
and overlap-index growth bounds.

## Evidence and remaining gates

The initial and follow-up JSON reports and cold-run screenshots are retained
locally under `raw/`, `prebuilt/`, `b1-validation-overlap-2026-10-29/`,
`b1-index-validation-2026-10-29/`, and `b1-height-only-2026-10-29/`; they are
ignored by Git. This tracked note
contains the reviewable measurements so the raw traces need not be committed.

Before adopting B1, measure a controlled steady frame window and GPU upload
submission cost; repeat on the intended integrated/mobile tiers; investigate
the cold terrain-validation gate; verify editor/failure/cancellation/eviction
behavior in the browser; and confirm the overlap index stays bounded as bake
coverage grows. Local artifacts remain unpublished; production R2 publication
is a separate release task.
