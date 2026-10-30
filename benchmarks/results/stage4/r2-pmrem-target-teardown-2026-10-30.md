# R2 — PMREM ownership and StreetEngine teardown check

- Date: 30 October 2026
- App base revision: `c84a174`, with the pending teardown change applied for this run
- Fixture: recorded Rome OSM showcase; no live-data or R2 writes

## Method

Built the production app and ran visible Chrome 156 on Windows 11, 1280×720 at
DPR 1, High quality, 21:00 and rain. WebGL used ANGLE Direct3D 11 on Intel UHD
Graphics (`0x0000A78B`) with an Intel Core i7-13650HX host. The browser replayed
the recorded Rome fixture. The WebGL audit counted framebuffer and renderbuffer
creation/deletion per context and captured `envMapIntensity` uniform values.

The run performed 24 day/night cycles on one renderer, then clicked the in-app
Globe view control to unmount the StreetEngine without closing the browser page.
All 25 cycle snapshots reported 22 active framebuffers and 2 active
renderbuffers. The uniform values included the expected wet-road intensity
2.71. The engine teardown then explicitly deleted 19 framebuffers and both
renderbuffers; after context loss, the detached Street context had zero active
framebuffer/renderbuffer objects. Three tracked Three.js renderer scratch
framebuffers were invalidated by context loss rather than individual delete
calls.

The first teardown audit exposed an undisposed directional-light shadow target.
StreetEngine cleanup now calls `sun.shadow.dispose()` before renderer disposal,
then `renderer.forceContextLoss()` so the removed context releases Three.js's
internal scratch framebuffers.

The measurement window passed, with zero browser console errors, page errors,
asset failures, HTTP errors or benchmark validation errors.

## Limits

This is a single visible-Chrome run on one Intel UHD host. It validates repeated
PMREM replacement and real engine unmount behavior for this browser/device; it
does not establish multi-device behavior or a multi-hour soak. Raw benchmark
JSON remains local and ignored.

## Reproduction

Run `node scripts/bench-perf.mjs` against a production server with recorded Rome
data, High quality, 21:00, weather 90, visible Chrome and
`--environment-audit --environment-audit-cycles 24 --engine-teardown-audit`.
