# Offline asset pipeline

Offline source assets remain under `assets/`. Stage 3.5 adds a small shared
facade albedo/window pair; Stage 3.6 adds packed PBR facade maps only for the
high quality tier. The other shared PBR atlases and processed props remain
offline until their later checkpoints.

## Build

Use Python 3.11, install the pinned image dependency, install Blender 5.2.0,
and use the Chrome version recorded in `assets/manifest.json`:

```powershell
python -m pip install -r assets/asset-pipeline-requirements.txt
npm run assets:build
```

The scripts enforce Pillow 10.4.0, Blender 5.2.0, Playwright 1.52.0 and the
recorded Chrome version. Update those pins deliberately when refreshing tools;
the browser canvas output is part of the generated asset hashes.
The build creates four shared 3136×2096 PNG atlases (base color, OpenGL normal,
roughness, AO), a 512×1024 facade/emissive template pair, five 1600×2096 facade
PBR atlases, and four normalized, self-contained, optimized Kenney GLBs. Source snapshots live under
`assets/source/`; output hashes, selected-file hashes and atlas rectangles are
recorded in `assets/manifest.json`.

Each atlas uses a 3×2 grid of 1024px cells with 16px edge-dilated gutters. The
Concrete034 tile keeps its 1024×512 aspect and is vertically centred in its
cell. Atlas `pixelRectTopLeft` values use image top-left coordinates;
`uvRectBottomLeft` values use the usual bottom-left UV convention. The gutter
provides about four mip levels before adjacent content can reach a sampled
edge. AO defaults to white where a source AO map is absent. Directional light
is never baked into base color.

The Kenney GLBs use bottom-centred pivots on Y=0, uniform metre scaling and the
glTF +Z forward convention. Four-cardinal-direction previews are produced with
`npm run assets:preview` under `assets/processed/previews/`. The stop sign and
traffic light were visually found to face -X in the source and are rotated +90°
about Y in the processed output; cone and barrier are symmetric.

The asset build then runs glTF Transform CLI 4.5.0 with `prune`, `dedup` and
`weld`. Geometry bounds, attributes, triangle counts, embedded texture bytes,
material slots, orientation and extension-free loading are checked before the
outputs and manifest are updated. Meshopt, Draco and triangle simplification
are recorded trials, not runtime formats. See the [Stage 3.7 report](../benchmarks/results/stage3/glb-optimization.md)
for size comparisons, visual checks and decoder decision.

## KTX2 comparison pilot

Install the official KTX-Software **4.4.2** release and make `ktx` available on
`PATH`. If it is not on `PATH`, set `KTX_BIN` to the directory containing
`ktx.exe` (Windows) or `ktx` (macOS/Linux), then run:

```powershell
$env:KTX_BIN = 'C:\path\to\KTX-Software\bin'
npm run assets:ktx2
```

The script rejects other KTX versions and verifies every source atlas against
`assets/manifest.json`. It compares ETC1S / BasisLZ at quality 128 and compression
level 1 with UASTC quality 2, RDO lambda 1 (0.5 for normal maps), and Zstandard
level 18. Encodes use one thread, retain RGB normal data, preserve alpha, declare
sRGB or linear data explicitly, and retain top-left image orientation. The pilot
stores the base level only; mip generation and gutter inspection belong to Stage
3.6. Every KTX2 is validated for glTF BasisU portability and decoded to RGBA8 for
the visual comparison. `ktx extract` is pinned to the same KTX-Software release.

Generated `.ktx2` files, exact settings, SHA-256 hashes, file sizes and decoded
quality metrics are recorded in `assets/manifest.json`. The complete-atlas and
facade-window/mask sheets are under `assets/processed/ktx2/`. KTX2 transfer sizes
do not predict GPU residency; the runtime transcode target and memory accounting
are measured separately during Stage 3.5 runtime checks.

## Runtime facade KTX2 maps

Run `npm run assets:runtime-ktx2` after installing KTX-Software 4.4.2 as above.
The script rebuilds ETC1S and UASTC variants for the shared 512×1024 facade
albedo/window maps and the packed 1600×2096 near-atlas albedo, normal, roughness
and emissive maps. It validates both codecs for `KHR_texture_basisu`, selects
UASTC, and copies the selected maps plus the matching Basis transcoder from the
lockfile-pinned Three.js 0.170.0 package into `public/`. Source, codec, decoder,
layout and output hashes are recorded in `assets/manifest.json`.

KTX orientation metadata stays `top-left` for glTF BasisU compatibility. Three.js
0.170.0 returns a `CompressedTexture` with `flipY=false`; the runtime applies a V
mirror transform to match the current CanvasTexture mapping. The procedural
facade and emissive textures remain active until both compressed maps decode and
upload successfully. The runtime loader is capped at two workers and waits for
`input-ready` before initializing the decoder or fetching either texture tier.
It reports fetch bytes/time, decoder resource time,
combined worker/WASM compile/transcode time, upload submission time, renderer
texture-count delta, and compressed-payload residency estimate. Browser APIs do
not expose a separate WASM compile or GPU upload completion time; those
limitations are recorded in the performance timeline.

Runtime texture files and the Basis transcoder use content-addressed paths.
`lib/engine/runtime-texture-assets.js` carries the generated URLs, while
`public/textures/ktx2/runtime-manifest.json` records hashes and the shared
revision. The service-worker cache revision is updated from the same asset
revision; hashed files are cached as immutable, and API requests bypass the
service worker. To add hashes/versioned paths to already-generated runtime
textures without rerunning KTX encoding, use `npm run assets:runtime-index`.
Unavailable maps leave the procedural/shared facade maps active. See the
[Stage 3.8 report](../benchmarks/results/stage3/runtime-asset-index.md).

The shared pair carries 11 offline Lanczos mip levels generated with repeat-S
and clamp-T filtering. The high-tier maps carry 12 levels and clamp on both
axes; their packed material rectangles use the 16px gutters documented above.
The mip generator is pinned to Pillow 10.4.0. Shared maps load on low/medium;
the four packed maps and their layout JSON load on high. A shader UV transform
maps building material families into their atlas cells while retaining the
shared-map mapping on lower tiers. When quality drops, high maps detach from
materials and their GPU textures are disposed.

The RTX 4060 runtime smoke measured 6,269,713 bytes for the high-tier maps plus
layout, 249–274 ms combined worker/WASM transcode, 8.5–9.8 ms upload submission,
and an estimated 17,889,344 bytes of high-tier compressed mip residency. The shared
pair estimated 1,398,176 bytes, for 19,287,520 bytes total while high is active.
These payload estimates are device-specific and do not replace mobile or
low-memory acceptance. See the [Stage 3.6 report](../benchmarks/results/stage3/ktx2-near-atlas-gpu-smoke.md)
and the [mip/gutter contact sheet](../benchmarks/results/stage3/ktx2-high-atlas-mip-gutter-review.png).

## Remaining Stage 3 work

The five packed facade maps place each selected PBR surface under the existing
shallow wall/window/storefront detail; the emissive atlas uses identical cells
and window coordinates. The KTX-Software 4.4.2 ETC1S/UASTC pilot and decoded
atlas/window-mask review are complete; see the comparison report and manifest.
Stages 3.5 and 3.6 passed their desktop RTX 4060 runtime checks, including the
shared-map fallback check, selective high-tier loading, and mip/projected-detail
review. Stage 3.7 GLB optimization and Stage 3.8 content-addressed runtime
assets, revision-aware caching and post-input-ready KTX loading are implemented;
the props remain offline. Offline/failure browser acceptance and low-memory /
mobile texture residency remain release checks.
