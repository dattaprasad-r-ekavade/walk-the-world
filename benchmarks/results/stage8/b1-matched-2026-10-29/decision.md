# B1 matched raw/prebuilt comparison — 29 October 2026

## Decision

B1 remains open. The current prebuilt path is not ready for adoption: in this
matched headless run it was slower to ready and transferred more total payload
than raw JSON. This does not establish hardware performance, but it gives a
clear next engineering target: prevent downloading baked artifacts that will
be rejected for feature-ID ownership overlap, and investigate the terrain
revision validation cost.

## Setup

- Tokyo, same frozen 3×3 source snapshot for both modes.
- Same production build and Three.js 0.186 dependency tree.
- Three cold/warm repetitions per mode. Each repetition used a fresh browser
  context for cold; warm opened a second page in that context after cold settled.
- Headless Chromium, service workers blocked, browser HTTP cache retained.
- Both modes used the same local source snapshot proxy. The raw mode pointed at
  an empty prebuilt index; prebuilt mode used nine baked cell artifacts.
- These are headless diagnostics, not visible-device or hardware acceptance.

## Results

| Mode | Ready median, cold | Ready median, warm | Cold payload | Cold settled state |
|---|---:|---:|---:|---|
| Raw | 3,515 ms | 1,846 ms | 15,473,747 B raw JSON | 8 loaded, 1 failed, 0 deferred |
| Prebuilt | 4,486 ms | 1,967 ms | 13,583,369 B raw + 6,729,895 B baked = 20,313,264 B | 8 loaded, 1 failed, 0 deferred |

Prebuilt was 27.6% slower cold and 6.6% slower warm by median ready time. Its
cold payload was 31.3% larger. It requested eight raw neighbor cells and all
nine baked artifacts. Both modes failed the same neighbor cell and showed the
same known local assets 501 and geometry-merge warning.

The streamed prebuilt candidate can contain feature IDs already owned by spawn
or another cell. The runtime now detects that conflict before validation and
falls back to the raw deduplication/build path; the new regression verifies
that the cell loads without remaining deferred. The rejected artifact has
already been fetched at that point, which is part of the measured extra
transfer. One representative prebuilt run recorded 1,582 ms in prebuilt terrain
revision validation, 11 ms for frame rebasing and 137 ms for shader warm-up.
The run did not isolate GPU upload submission by frame.

## Evidence and remaining gates

The full JSON reports and six cold-run screenshots are retained locally under
`raw/` and `prebuilt/` but are ignored by Git. This tracked note contains the
reviewable measurements so the raw traces need not be committed.

Before adopting B1, redesign artifact eligibility/ownership to avoid rejected
downloads, investigate terrain-revision validation, measure upload and total
load costs, verify editor/failure/cancellation/eviction parity, and repeat on
visible target devices. Local artifacts remain unpublished; production R2
publication is a separate release task.
