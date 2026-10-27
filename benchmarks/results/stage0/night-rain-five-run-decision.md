# Intel UHD night/rain repeatability checkpoint

Date: 27 October 2026  
Status: valid five-run diagnostic baseline; Stage 0 remains open.

## Test setup

- Production app built with `npm run build` and served locally with
  `npm run start -- --port 3456`.
- Installed Chrome 155, visible window, WebGL 2 through ANGLE/Direct3D 11 on
  Intel UHD Graphics 630. Viewport 1280×720, DPR 1, medium quality.
- Synthetic prop-heavy fixture, fixed pose and seed, 12-second walk, 21:00 and
  weather 90 (rain). Each accepted run moved about 60 m.
- Host sampling waits for its first real counter sample before movement; the
  report validates frame-window duration, page focus/visibility and in-window
  host-sample coverage. Four runs also recorded focus-loss events; the earlier
  fifth run was visible and host-aligned but predates that focus-event field.

## Five accepted runs

| Report | Frame p95 | Frame p99 | Avg FPS | GPU timer p95 | System CPU avg | GPU 3D avg peak | Min free memory |
|---|---:|---:|---:|---:|---:|---:|---:|
| [v5](main-local-night-rain-chrome-12s-v5.json) | 34.3 ms | 50.0 ms | 40 | 11.73 ms | 83.76% | 65.80% | 1,878 MB |
| [rep3](main-local-night-rain-chrome-12s-rep3.json) | 33.7 ms | 49.9 ms | 46 | 10.85 ms | 69.95% | 71.79% | 1,894 MB |
| [rep4](main-local-night-rain-chrome-12s-rep4.json) | 33.4 ms | 49.6 ms | 52 | 9.90 ms | 60.02% | 76.19% | 1,747 MB |
| [rep5](main-local-night-rain-chrome-12s-rep5.json) | 17.1 ms | 18.2 ms | 59 | 9.02 ms | 43.23% | 80.94% | 2,070 MB |
| [rep6](main-local-night-rain-chrome-12s-rep6.json) | 33.5 ms | 50.0 ms | 50 | 10.55 ms | 64.51% | 72.72% | 1,938 MB |

The median frame p95 is **33.5 ms** (range 17.1–34.3 ms); median GPU timer
p95 is **10.55 ms**. Median average FPS is 50. Median system CPU use is 64.51%
and median GPU 3D engine use is 72.72%. The desktop p95 target of 16.7 ms is
missed. The single 17.1 ms run does not represent the other four runs; retain
the range and repeatability caveat.

The compact [five-run JSON summary](night-rain-five-run-summary.json) contains
the per-run hardware, window-validity, frame, GPU, host and startup-stage
metrics. The detailed frame/renderer arrays remain in the local per-run reports
listed in that summary and are not part of the compact evidence checkpoint.

The page was focused and visible with no recorded focus or visibility loss in
rep3–rep6. Windows reported High Performance power mode and AC power; no ACPI
thermal-zone readings were available. Minimum free memory ranged from 1,747 to
2,070 MB. Browser console, runtime and local asset-error counts were zero.
The matched [rep3 scene capture](main-local-night-rain-chrome-12s-rep3.png)
shows the synthetic prop-heavy road used for this check.

## Instrumentation control and stage timings

One matched run with Windows telemetry disabled recorded 33.5 ms frame p95 and
10.86 ms GPU timer p95. This is close to the five-run medians and shows no
obvious frame-time penalty from the sampler in that single control; it is not a
multi-run overhead study. See
[no-telemetry control](main-local-night-rain-chrome-12s-no-telemetry.json).

Across the five accepted startup traces, median `city.worker-compute` was
25.9 ms while `city.worker-roundtrip` was 729.4 ms. Median geometry-stage total
was 737.1 ms and assembly total was 1,650.2 ms for this 257-element synthetic
cell. Input packing was 0.6 ms and postMessage submission 0.5 ms. Roundtrip
includes worker execution and response delivery/scheduling; it is not a
clone-only measurement. This gap does not support a Rust/SIMD port: optimizing
the worker kernel alone has a small ceiling on this workload. Profile the main
thread, assembly and worker scheduling with a dense real-city fixture before
choosing the next optimization.

## Decision and limits

- Keep the rejected prop-cache/spatial-batching candidate rejected; this run
  set is a baseline, not a candidate comparison.
- Keep Rust/Wasm/SIMD deferred. The worker kernel is a small part of the measured
  geometry roundtrip, and the current synthetic scenario does not show that
  geometry computation limits steady-state frames.
- GPU timer p95 is below the frame p95, but host CPU was heavily loaded and
  integrated-GPU thermal readings were unavailable. Treat CPU scheduling,
  renderer submission and GPU pacing as leads, not a proven single bottleneck.
- These runs cover one warm synthetic night/rain route on one plugged-in laptop.
  They do not cover day/clear-night/rain separately, cold starts, real-city
  capacity, cell crossing, driving, mobile devices or the 15-minute thermal
  walk. They do not close Stage 0 or release acceptance.

Earlier attempts remain diagnostic-only: the original `main-local-night-rain-
chrome-12s.json` captured 51.98 seconds of frame history for a 12-second walk;
v2/v3 missed the host window; v4 had insufficient leading host coverage; rep2
was throttled to about 1 FPS with no focus-event guard. Do not include them in
the five-run statistics.
