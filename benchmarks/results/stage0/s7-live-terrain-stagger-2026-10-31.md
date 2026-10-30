# S7 production smoke after terrain upload staging

Date: 31 October 2026 00:50 IST  
Production: `https://walk-the-world-delta.vercel.app`  
Commit: `26cb647` (`Stagger surrounding terrain startup uploads`)

The production `/sw.js` cache revision was `0788ffc80a606ebb`, matching the
revision computed from commit `26cb6471f3f4`, package version `0.4.0`, and the
current runtime texture revision. This confirms the production alias was serving
the changed code during the run.

## Run

- Headless Chrome, 1280×720, Edinburgh demo, 120 settled frame intervals.
- The browser became ready in 6,256 ms and the city stream settled with 9
  resident cells. All nine Edinburgh cell requests returned HTTP 200; there were
  no failed cell requests or console errors.
- Settled stationary frame interval p50: 16.7 ms; p95: 16.9 ms. The rehearsal
  does not record a maximum for this sample.
- [Edinburgh capture](../../../screenshots/performance-visuals/stage0/s7-terrain-stagger/edinburgh-live-headless-2026-10-31.jpg)
  shows the street, generated roads, and surrounding buildings rendering.

## What this establishes

This is a functional production check after the terrain-streaming change. It
does not measure the boot or arrival spike, a walking segment, travel, or a night
switch. The headless frame sample is not hardware evidence, and this street-level
capture does not establish that terrain relief is intact. S7 remains open until
the target Intel UHD i5-1035G1 laptop completes the full visible tour and confirms
ground imagery and hills.
