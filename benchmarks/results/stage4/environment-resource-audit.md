# Environment update and road reflection audit

Date: 28 October 2026. App base: `e90a47a`, with the local environment target,
road binding, post-processing cleanup, atlas fallback and wet-map draft changes.

The production build ran the recorded Rome fixture in visible Chrome 155 at
1280×720/DPR 1, High, weather 90 and 21:00. WebGL reported ANGLE Intel UHD
Graphics (0x00008A56), Direct3D 11. Benchmark-only wrappers tracked WebGL
framebuffer/renderbuffer creation and deletion and values sent to the
`envMapIntensity` uniform. After streaming settled and three warm-up changes,
six 12:00→21:00→12:00 cycles sampled the live counts at the same time of day.

All seven snapshots reported 19 live framebuffers and 16 live renderbuffers.
The uniform calls included 0.85, 1.00 and 2.71: 2.71 is the expected road
material intensity at wetness 0.9. This confirms that the expected value reached
WebGL in this scenario; the hook records uniform values, not draw-to-material
association. The material-binding unit test separately covers existing and newly
created roads. No console, page or asset errors were reported.

The five-second walk measurement passed its window and host coverage checks,
but system CPU averaged 95.64% and minimum free memory was 757 MB. This is a
functional lifecycle diagnostic, not an A/B or evidence of performance gain.
Counts cover the instrumented WebGL calls on this browser/context, not driver
memory in bytes, engine teardown, other devices or long-duration behavior.
The original raw JSON is local and untracked.

Reproduce after a production build and server start:

```sh
node scripts/bench-perf.mjs --base-url http://127.0.0.1:3457 --data-mode recorded --cache-mode cold --preset high --hour 21 --weather 90 --browser-channel chrome --renderer-mode browser-default --headed --skip-globe --walk-ms 5000 --environment-audit --out benchmarks/results/stage4/environment-resource-audit.json
```

The switch checks nonzero tracked counts, stable counts on each cycle and the
expected 2.71 uniform value. Capture separate matched visual and performance
comparisons, plus actual GPU resource checks across engine teardown, before
closing the remaining gates.
