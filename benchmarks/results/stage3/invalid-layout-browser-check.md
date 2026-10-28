# Invalid facade layout: browser fallback check

28 October 2026; production build at `772dc8f`, recorded Rome fixture, visible
Chrome 155 on Intel UHD Graphics (0x00008A56)/WebGL 2, High quality at noon.
The benchmark intercepted the content-addressed high-tier layout response and
returned HTTP 200 with malformed JSON. Service workers were blocked in this
scenario because Playwright routing cannot intercept requests they handle.

The runner intercepted one layout request and observed the high-tier fallback
mark with a JSON parse error. The shared facade and emissive KTX2 maps installed,
the material inventory reported no high facade atlases, and no high-tier-ready
mark appeared. The player moved 4.09 m during a valid one-second browser window.
No console errors, page errors, or asset failures were recorded. Host telemetry
was deliberately disabled, so these results are functional evidence only.

Two earlier attempts with service workers enabled timed out: the actual high
atlas loaded normally, so those attempts did not exercise malformed JSON. The
successful injection verifies the application fallback without a service worker;
it does not establish offline behavior, cached-response recovery, schema-error
behavior in a browser, or performance. The raw JSON and screenshot remain local.

Reproduce with a production server on port 3457:

```sh
node scripts/bench-perf.mjs --base-url http://127.0.0.1:3457 --data-mode recorded --cache-mode cold --preset high --hour 12 --weather 0 --browser-channel chrome --renderer-mode browser-default --headed --skip-globe --skip-host-telemetry --walk-ms 1000 --invalid-facade-layout --out benchmarks/results/stage3/invalid-layout-browser-blocked-sw.json
```
