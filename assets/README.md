# Offline asset pipeline

This is a source-only pilot. Nothing under `assets/processed/` is loaded by the
game yet.

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
PBR atlases, and four normalised Kenney GLBs. Source snapshots live under
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
remain Stage 3.5 work.

## Remaining Stage 3 work

The five packed facade maps place each selected PBR surface under the existing
shallow wall/window/storefront detail; the emissive atlas uses identical cells
and window coordinates. The KTX-Software 4.4.2 ETC1S/UASTC pilot and decoded
atlas/window-mask review are complete; see the comparison report and manifest.
Runtime material integration, in-game approval, and performance/memory gates
remain open. Do not treat the offline outputs as runtime-adopted assets.
