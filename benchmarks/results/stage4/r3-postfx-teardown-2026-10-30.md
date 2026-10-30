# R3 — Post-processing pass teardown check

- Date: 30 October 2026
- App revision: `2979fea` (the R2 teardown source)
- Fixture: recorded Rome OSM showcase; no live-data or R2 writes

## Method

Ran the production build in headed Chrome 156 on Windows 11 at 1280×720 and
DPR 1, using ANGLE Direct3D 11 on Intel UHD Graphics (`0x0000A78B`). The
scenario used the recorded Rome fixture, High quality, 21:00, and weather 90.
After six day/night cycles on the first renderer, the benchmark navigated away
from StreetEngine and fully reloaded the street route two more times in the
same browser tab. Each of the three engine instances was unmounted through the
Globe view control.

The PMREM audit recorded seven snapshots, all at 22 framebuffers and 2
renderbuffers. `envMapIntensity` included 2.71. The separate teardown audit
counted WebGL framebuffer, renderbuffer, texture, and program creation and
deletion per StreetEngine context:

| Cycle | Before: FB/RB/texture/program | Explicit deletes: FB/RB/texture/program | Still tracked at context loss |
|---|---:|---:|---:|
| 1 | 22 / 2 / 61 / 70 | 19 / 2 / 55 / 65 | 3 / 0 / 6 / 5 |
| 2 | 22 / 2 / 57 / 70 | 19 / 2 / 51 / 65 | 3 / 0 / 6 / 5 |
| 3 | 22 / 2 / 58 / 69 | 19 / 2 / 52 / 64 | 3 / 0 / 6 / 5 |

Every StreetEngine canvas was detached, and each WebGL context was lost after
cleanup. The 3 remaining framebuffer handles had creation stacks in Three.js's
renderer scratch-target setup. Six texture handles and five program handles
remained tracked until context loss; the WebGL API audit does not attribute
those individually. The residual counts were identical across all three
cycles.

The movement and benchmark measurement checks passed. The run had zero browser
console errors, page errors, failed assets, HTTP errors, or benchmark
validation errors. The existing lifecycle unit check separately verifies
exact-once disposal for the owned passes and the SSAO material and noise
texture.

## Limits

This is one visible Chrome run on one Intel UHD host. The counters measure WebGL
object handles, not VRAM bytes, and do not assign every handle to an individual
post-processing pass. The stable residual handles were invalidated when each
context was lost; multi-hour and other-device behavior are not established.

## Reproduction

Run against a production server with:

```powershell
node scripts/bench-perf.mjs --base-url http://127.0.0.1:3456 --data-mode recorded --preset high --quality-mode manual --browser-channel chrome --renderer-mode browser-default --headed --hour 21 --weather 90 --walk-ms 5000 --environment-audit --environment-audit-cycles 6 --engine-teardown-audit --engine-teardown-cycles 3 --pose-x -30.5 --pose-z 104.8 --heading -1.58 --pose-pitch -0.65 --skip-globe --skip-host-telemetry
```
