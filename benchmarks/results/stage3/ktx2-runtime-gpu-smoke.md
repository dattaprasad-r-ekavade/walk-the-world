# Stage 3.5 runtime acceptance

Captured 2026-10-28 with a production build and headless Chrome using the
NVIDIA GeForce RTX 4060 Laptop GPU through D3D11. The Rome showcase fixture
reached engineReady, rendered 243 meshes and completed the spawn-cell stream.

| Measurement | Result |
|---|---:|
| Renderer | ANGLE / NVIDIA GeForce RTX 4060 Laptop GPU / D3D11 |
| Texture transfer | 194,691 bytes; 7 ms |
| Basis decoder resources | 263,388 bytes |
| Combined worker/WASM initialization and transcode | 110 ms |
| Synchronous upload submission | 1.7 ms |
| Estimated compressed mip residency | 1,398,176 bytes |
| Mip levels | 11 per map |
| Input ready | 2,323 ms |
| First building | 2,475 ms |
| Spawn-cell streaming complete | 5,756 ms |
| Page errors / asset failures | 0 / 0 |

Both maps transcoded to BPTC/BC7 on this device. Day and night captures show
facade and emissive window maps aligned:

- [Day capture](ktx2-runtime-gpu-day.png)
- [Night capture](ktx2-runtime-gpu-night.png)

The fallback run forced both KTX2 requests to return HTTP 503. It still reached
engineReady, rendered 243 meshes, installed the procedural facade fallback,
and completed city streaming with no page errors. The two browser resource
errors are the expected results of the forced 503 responses:

- [Fallback capture](ktx2-fallback-gpu-day.png)
- [Fallback smoke data](ktx2-fallback-smoke.json)
- [Primary smoke data](ktx2-runtime-gpu-smoke.json)

Upload submission is measured synchronously; WebGL does not expose a portable
GPU upload completion timestamp. The reported residency is the sum of the
transcoded compressed mip payload sizes. Basis WASM compilation and texture
transcoding are combined because Three.js 0.170.0 does not expose separate
timings. These measurements cover the Rome replay fixture and RTX 4060 only;
lower-memory hardware and live Overpass streaming remain release checks.
