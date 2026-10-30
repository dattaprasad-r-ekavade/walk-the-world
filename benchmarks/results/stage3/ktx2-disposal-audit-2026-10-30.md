# KTX2 high-texture disposal: live WebGL check

30 October 2026; production build from app revision `dd258bf`, Next.js 16.4.3,
headed Chrome 156.0.8078.79, WebGL 2 on Intel UHD Graphics (`0x0000A78B`,
ANGLE/Direct3D 11). The raw result records `sourceTreeDirty: true`: the run
included uncommitted benchmark instrumentation and test-only accessors in
`StreetEngine.js`. The KTX2 loader logic itself was unchanged.

## Result

The recorded Rome scene loaded in High quality. The KTX2 ready mark reported four
high atlas textures uploaded (`textureCountDelta: 4`) and an estimated high-tier
payload of 17,889,344 bytes. The estimate comes from compressed mip payloads; it
is not a measurement of allocated VRAM.

The audit then switched the live scene to Low, the first tier that releases near
facade maps on supported desktop hardware. Before the switch, the high atlas
family was installed, Three.js reported 63 live texture objects, and the WebGL
instrumentation tracked 67 live texture handles. Immediately after the switch,
the high atlas family was detached, Three.js reported 42 textures, WebGL had
recorded 21 additional `deleteTexture` calls, and its live handle count fell to
46. After three frames, two new handles had been created; the net renderer and
WebGL live counts were both 19 lower than before the switch. The audit passed
with the expected high atlas family removed.

The 21 deletions include resources beyond the four KTX2 atlases; the net counts
therefore measure the complete quality transition rather than attributing every
deletion to KTX2. The before/after atlas inventory, the four-texture upload mark,
and the GL deletion delta together confirm that actual WebGL texture objects
were released. Unit coverage separately checks disposal after a high-tier
installation error. The raw benchmark JSON is an ignored local artifact at
`ktx2-disposal-audit-rerun-2026-10-30.json`.

The run took 4,205 ms to load, recorded 45 average FPS, and moved 5.12 m during
the one-second walk. The audit hook and post-run quality transition make these
functional diagnostics, not performance acceptance results.

## Limits

WebGL exposes texture object creation/deletion, not physical VRAM allocation or
GPU completion time. This check measures the normal High-to-Low release path; it
does not inject a partial GPU upload failure. The existing unit test covers the
loader's installation-error cleanup path.

## Reproduce

Build and start the production app on port 3457, then run:

```powershell
npm run build:bench
npm run start -- --port 3457
node scripts/bench-perf.mjs --base-url http://127.0.0.1:3457 --data-mode recorded --cache-mode cold --preset high --hour 12 --weather 0 --browser-channel chrome --renderer-mode browser-default --headed --skip-globe --skip-host-telemetry --walk-ms 1000 --ktx2-disposal-audit --out benchmarks/results/stage3/ktx2-disposal-audit-2026-10-30.json
```
