# Wet-road roughness-map candidate smoke

28 October 2026; production build from `e90a47a` plus local rendering and
benchmark changes. The candidate uses one shared 64×64 roughness map in the
existing sampler and switches on at wetness 0.3. The default uses the original
roughness map. The candidate remains available only through benchmark mode.

One visible-Chrome 155 run per condition used the recorded Rome fixture on
Intel UHD Graphics (0x00008A56), 1280×720/DPR 1, High, 21:00, weather 90,
seed 1337 and the same requested starting pose. Both five-second windows and
host telemetry windows passed validation with no reported browser/asset errors.
At the end, all 16 road materials used the requested map (0 candidate maps in
baseline; 16 in candidate). Walk distances were 25.18 m and 25.16 m.

| Condition | Frame p95 | GPU timer p95 | Average host CPU | Minimum free memory |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 50.2 ms | 30.08 ms | 63.07% | 1,070 MB |
| Candidate | 50.3 ms | 33.07 ms | 67.97% | 965 MB |

The road-specific difference in the two captures is not clear to the reviewer;
rain particles and moving scene elements differ between captures. The single
short run per condition and differing host load do not establish a performance
regression or improvement. Raw JSON and PNG captures remain local and untracked.

Decision: keep the baseline as the product default; do not promote the candidate
on this evidence. The benchmark-only candidate permits later controlled close-up
or multi-device comparisons. Investigate road appearance under better-controlled
lighting and poses, including the existing environment binding, before changing
the wet-road visual policy. First-upload cost, transition at the 0.3 threshold
and mobile behavior have not been accepted.

To reproduce, start a production server on port 3457 and run this command once
each with `baseline` and `candidate` substituted for `<mode>`:

```sh
node scripts/bench-perf.mjs --base-url http://127.0.0.1:3457 --data-mode recorded --cache-mode cold --preset high --hour 21 --weather 90 --pose-x -30.5 --pose-z 104.8 --heading -1.58 --browser-channel chrome --renderer-mode browser-default --headed --skip-globe --walk-ms 5000 --wet-road-map <mode> --out benchmarks/results/stage4/wet-map-<mode>-smoke.json --screenshot benchmarks/results/stage4/wet-map-<mode>-smoke.png
```
