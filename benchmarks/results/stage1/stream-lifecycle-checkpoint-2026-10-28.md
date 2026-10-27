# Stage 1.2 stream lifecycle checkpoint — 28 October 2026

## Implementation

The city-builder pool now bounds pending geometry jobs (default queue capacity:
four jobs per worker) and rejects saturation with `CITY_BUILDER_QUEUE_FULL`.
The cell streamer caps queued neighbors at nine, removes queued cells outside
the latest desired ring, and aborts active requests/builds when their cells
become obsolete. Results are checked against the active job and desired ring
before they can change the scene. Worker callbacks from terminated workers are
ignored.

Feature IDs are reserved by job and become globally seen only when a cell
commits. Failed or obsolete work releases its reservations. Partial scene
groups, footprints, and per-cell engine metadata are removed during rollback.
Overlapping cell payloads wait for the current reservation owner to commit or
release before retrying.

## Verification

- `npm test`: 13 files passed, 112 tests passed.
- `npm run build`: production build completed successfully.
- Recorded Rome production smoke: 12-second eastbound walk in visible Chrome
  on Windows 11, 1280×720 at DPR 1. The player moved 60.1 m, crossed into the
  expected neighbor, loaded that cell, settled at the 10/10 resident-cell cap,
  and reported no console, page, or asset errors. The run reported 5,024 ms
  load time and 107 average FPS; these single-run figures are smoke context,
  not an A/B performance result.

The lifecycle suite covers bounded and canceled queues, stale worker results,
stale assembly rollback, footprint/metadata cleanup, and reuse of a released
feature ID. The separate [15-minute desktop resource-soak report](resource-soak-2026-10-28.md)
confirms count stabilization during a moving walk. Mobile assembly and
input-latency checks remain open for the broader Stage 1 exit.
