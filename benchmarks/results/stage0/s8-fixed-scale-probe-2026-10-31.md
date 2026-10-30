# S8 fixed render-scale probe — 31 Oct 2026

`bench-perf.mjs` now accepts `--render-scale <0.6..1>` with `--quality-mode auto`. The override is only set when `__BENCH_MODE` is active, and the adaptive governor is already disabled in that mode. The benchmark applies the requested scale at startup and quality-tier changes, records it in `scenario.benchmarkRenderScale` and `street.renderScale`, and fails if the observed scale differs. This lets the baseline scale `1.0` and candidate `0.85` run from the same source revision.

## Control probe

Both commands used a local Next dev server, the small Rome smoke fixture, headless Chromium/SwiftShader, a 1-second walk and `--skip-globe`:

```powershell
node scripts/bench-perf.mjs --base-url http://localhost:3456 --skip-globe --quality-mode auto --render-scale 1 --walk-ms 1000 --out benchmarks/results/stage0/s8-scale-probe-1.json
node scripts/bench-perf.mjs --base-url http://localhost:3456 --skip-globe --quality-mode auto --render-scale 0.85 --walk-ms 1000 --out benchmarks/results/stage0/s8-scale-probe-085.json
```

Both completed the movement check. The captured configuration reported auto quality and the requested applied scale (`1.0` and `0.85`). These single-city headless probes only validate the override path; their timings do not count toward S8 because SwiftShader is not the target Intel GPU and the smoke fixture is not the four-city recorded data set.

## Target comparison

On the target i5-1035G1, use visible Chrome and five alternating runs per city. Keep the prior comparison settings: medium auto quality, clear 21:00 scene, 8-second walk, same recorded 3×3 cell fixture and cold browser cache. Run each matched case once with `--render-scale 1` and once with `--render-scale 0.85`; confirm the JSON records the requested scale, `integratedGpu: true`, valid measurement windows and Chrome's Intel UHD renderer. Compare median frame p95 and GPU-timer p95 per city. S8 still requires at least 10% frame-p95 improvement on this target laptop.
