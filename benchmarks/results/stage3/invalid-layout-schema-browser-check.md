# Schema-invalid facade layout: browser fallback check

30 October 2026; production build from app revision `9f593d0`, recorded Rome
fixture, visible Chrome 156.0.8078.79 on the browser-default renderer, High
quality at noon. The harness read the shipped near-atlas layout and intercepted
its content-addressed response with valid JSON whose `Bricks060` rectangle was
out of bounds (`[0.9, 0, 0.2, 0.5]`). Service workers were blocked because
Playwright routing cannot intercept requests they handle.

The runner intercepted one layout request and observed the fallback reason
`Invalid facade atlas rectangle: Bricks060`. The shared facade and lit-window
maps remained available, high facade atlases were disabled, the texture-ready
mark appeared, and the player moved 4.59 m. The page completed 124 browser-visible
requests with no failed requests or HTTP errors. No console errors, page errors,
or asset failures were recorded. Host telemetry was disabled; this is functional
evidence only. The observed 6,285 ms load and 14 average FPS are not performance
acceptance results.

The app bundle was built at `9f593d0`; the benchmark harness change was
uncommitted during the run, so the raw result records `sourceTreeDirty: true`.
The raw JSON and screenshot are ignored local artifacts at
`invalid-layout-schema-browser.json` and `invalid-layout-schema-browser.png`.
This check does not establish offline network-failure recovery or real-GPU
resource disposal. The existing malformed-JSON browser check remains documented
in [`invalid-layout-browser-check.md`](invalid-layout-browser-check.md).

Reproduce with a production server on port 3457:

```sh
npm run build:bench
npm run start -- --port 3457
node scripts/bench-perf.mjs --base-url http://127.0.0.1:3457 --data-mode recorded --cache-mode cold --preset high --hour 12 --weather 0 --browser-channel chrome --renderer-mode browser-default --headed --skip-globe --skip-host-telemetry --walk-ms 1000 --invalid-facade-layout-schema --out benchmarks/results/stage3/invalid-layout-schema-browser.json --screenshot benchmarks/results/stage3/invalid-layout-schema-browser.png
```
