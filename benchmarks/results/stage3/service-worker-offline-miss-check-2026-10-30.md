# Service worker: uncached offline failure check

30 October 2026; production build from app revision `8dc3054`, Next.js 16.4.3,
headless Chrome 156.0.8078.79. The checker used a temporary local reverse proxy
to serve the app on a fresh loopback origin and to reset the connection for one
uncached content-addressed texture path.

## Result

The service worker activated, controlled the page, and cached the shell. While
online, the checker primed the shared facade KTX2 (165,060 bytes), high facade
KTX2 (2,131,317 bytes), atlas layout (2,048 bytes), Basis WASM decoder (527,333
bytes), and `/street?lat=41.890&lon=12.500`. It then enabled Chrome offline mode.
Each cached asset returned HTTP 200 from the service worker, and the cached
street route loaded with HTTP 200 from the service worker.

For an uncached layout-like texture path, the service-worker-controlled page
first remained online while the proxy forcibly reset the network request. The
page fetch rejected with `TypeError: Failed to fetch`, no cache entry was
created, and the proxy observed seven reset attempts. With Chrome then offline,
the same uncached path again rejected with `TypeError: Failed to fetch`; the
page reported `navigator.onLine === false`, remained service-worker controlled,
and still had no cache entry. The raw result is
[`service-worker-offline-miss-check-2026-10-30.json`](service-worker-offline-miss-check-2026-10-30.json)
(ignored local output). The repeatable checker is
[`scripts/check-sw-offline.mjs`](../../../scripts/check-sw-offline.mjs).

## Limits

This verifies the service worker's uncached network-error path and cached shell,
asset, and route responses. It does not prove that the complete 3D scene remains
interactive offline or that the runtime atlas loader displays its procedural
fallback for an actual missing atlas. Real-GPU disposal measurement, mobile
storage, and low-memory residency remain open. No performance claim is made.

## Reproduce

Build and start the production app on port 3457, then run:

```powershell
npm run build
npm run start -- --port 3457
node scripts/check-sw-offline.mjs --base-url http://127.0.0.1:3457 --out benchmarks/results/stage3/service-worker-offline-miss-check-2026-10-30.json
```
