# Streamed lamp lifecycle checkpoint

Date: 28 October 2026

Purpose: Verify that a lamp marker enters the runtime with its city cell and is
removed when the streamer evicts that cell.

## Result

The recorded per-cell fixture passed in visible Chrome 155 at 1280×720, DPR 1.0,
medium quality, 21:00 and clear weather. The captured WebGL renderer is
`ANGLE (Intel, Intel(R) UHD Graphics (0x00008A56) Direct3D11 vs_5_0 ps_5_0,
D3D11)`. Host telemetry was disabled, so this run does not independently identify
the CPU or laptop model. The origin began
with one lamp marker. Crossing into the east neighbor loaded the lamp from
`wtw_city6_41.890_12.503`, raising the count to two. Moving the player to
`wtw_city6_41.890_12.514` evicted the lamp's source cell and returned the count
to one. The settled streamer held 10 of 10 resident cells, reported no failed
cells, and the browser reported no console, page or local asset errors.

The 1-second capture had a valid measurement window and 49.9 ms frame p95. Its
short duration and lifecycle teleports make it functional evidence only, not a
performance comparison or a visual-quality acceptance run. A raw diagnostic
report is retained locally as `lamp-stream-lifecycle-v3.json`.

## Reproduce

Start the production app on port 3456, then run:

```powershell
npm run bench -- --base-url http://127.0.0.1:3456 --data-mode recorded --cache-mode cold --fixture benchmarks/fixtures/rome-lamp-stream.json --browser-channel chrome --renderer-mode browser-default --headed --skip-globe --skip-host-telemetry --cross-cell --stream-lifecycle --walk-ms 1000 --hour 21 --weather 0 --out benchmarks/results/stage4/lamp-stream-lifecycle-v3.json
```

The check requires a recorded fixture with per-cell payloads and at least one
`highway=street_lamp` node in both the origin cell and the cell two steps east.
