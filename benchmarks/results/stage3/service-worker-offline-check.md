# Stage 3.8 — Production service-worker cache check

Date: 28 October 2026

## Result

Passed the local production build and checked it with headless Chrome 155. The
service worker reached `activated`, controlled the page, installed cache
`wtw-shell-2cabdc7afd0aa7be`, and had the shell root cached.

The test fetched and confirmed Cache Storage entries for the shared facade KTX2
(165,060 bytes), High facade KTX2 (2,131,317 bytes), content-addressed high
atlas layout (2,048 bytes), and versioned Basis WASM decoder (527,333 bytes).
With Chromium offline mode enabled, each asset returned HTTP 200 through the
service worker. A previously visited `/street?lat=41.890&lon=12.500` route also
returned HTTP 200 through the service worker. The raw result is
[`service-worker-offline-check.json`](service-worker-offline-check.json); the
repeatable harness is [`scripts/check-sw-offline.mjs`](../../../scripts/check-sw-offline.mjs).

## Limits

The test does not prove that the 3D scene remains interactive offline or that an
uncached request follows the service worker's network-failure fallback. Chromium
still reached the local loopback server with offline mode enabled: the uncached
asset probe got the server's 404 response instead of a network rejection. The
report records this as unverified. No performance claim is made. Mobile storage,
low-memory residency, and far-mip visual seams also remain open.

## Reproduce

Build and start the production app on port 3457, then run:

```powershell
npm run build
npm run start -- --port 3457
node scripts/check-sw-offline.mjs --base-url http://127.0.0.1:3457 --out benchmarks/results/stage3/service-worker-offline-check.json
```
