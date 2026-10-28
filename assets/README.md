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
roughness, AO), a 512×1024 facade/emissive atlas pair, and four normalised
Kenney GLBs. Source snapshots live under `assets/source/`; output hashes,
selected-file hashes and atlas rectangles are recorded in `assets/manifest.json`.

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

## Remaining Stage 3 work

The facade base-color atlas bakes the existing shallow wall/window/storefront
detail, and its emissive mate is exported by the same shared grid generator.
The PBR surfaces are not yet composed into those facade cells or integrated
with the runtime material loader. KTX2 ETC1S/UASTC comparisons, runtime loader
and fallback integration, browser visual approval, and performance/memory gates
remain open. Do not treat the offline outputs as runtime-adopted assets.
