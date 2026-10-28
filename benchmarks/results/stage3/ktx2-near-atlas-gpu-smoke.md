# Stage 3.6 high-tier facade atlas smoke

**Decision:** Keep the packed PBR maps as an optional high-quality tier. The
shared 512×1024 facade/emissive pair remains the low/medium path and the
fallback after a quality downgrade. This closes the Stage 3.6 desktop
implementation checkpoint; it does not close mobile or lower-memory release
acceptance.

## Build and device

- Asset revision: `stage3.6-quality-atlas-r1`; working code based on revision
  `8c7e60c` with local Stage 3.6 changes.
- Windows 11 Pro build 26300; Intel i7-13650HX; NVIDIA GeForce RTX 4060 Laptop
  GPU, driver `32.0.15.9174`.
- Visible Chrome 156.0.8078.48, WebGL 2 / ANGLE D3D11, 1280×720 at DPR 1.
- Recorded Rome OSM showcase, 12:00 PM, clear weather, high preset, two geometry
  workers. The high/shared close-up captures use the same fixed pose and 1 s
  movement; the projected-detail capture walks for 8 s.

## Runtime result

The two shared maps transferred 194,691 bytes and produced 11 mip levels each.
They estimated 1,398,176 bytes of compressed mip residency. Medium quality
loaded no high maps and reported zero high-tier resident bytes.

The high tier loaded four 1600×2096 maps with 12 levels each. The five high
requests (four KTX2 files and the layout JSON) transferred 6,269,713 bytes. The
layout accounts for 1,918 bytes of that total. Chrome selected format `36492`
(BC7/BPTC) for all four maps. The two captures measured 249–274 ms combined
worker/WASM transcode and 8.5–9.8 ms synchronous upload submission. The
mip-payload estimate was
17,889,344 bytes high-only, or 19,287,520 bytes including the shared pair.

In the latest close-up run, high maps were ready at 1,116 ms, input-ready was
2,670 ms, and first-building was 2,978 ms. In the 8 s projected-detail run,
high maps were ready at 863 ms, input-ready at 2,538 ms, and first-building at
2,732 ms.
The 8 s run averaged 60 FPS with 16.9 ms frame p95. The matched 1 s medium run
reported 16.9 ms p95. These short captures are visual/runtime diagnostics, not
a repeated performance A/B.

Both high captures showed facade windows with no shader, page, asset, or
benchmark validation errors. The matched comparison is in
[ktx2-high-vs-shared-atlas.png](ktx2-high-vs-shared-atlas.png); the 8 s view is
[ktx2-high-atlas-projected-detail.png](ktx2-high-atlas-projected-detail.png).

## Mip and fallback limits

The [mip/gutter sheet](ktx2-high-atlas-mip-gutter-review.png) and its JSON
inspect levels 0–4, 6, 8 and 11. The 16 px source gutter shrinks to one pixel at
level 4 and below one pixel afterward. No obvious cell seam appears in the game
captures, but far-LOD sampling beyond level 4 and other devices still need
review. The report’s gutter edge metric measures channel difference from the
nearest tile edge; Canvas dilation smoothing makes it nonzero even where no
neighboring cell is visible.

Stage 3.5's forced HTTP 503 run verified that procedural maps keep the scene
working when shared KTX2 assets fail. This Stage 3.6 smoke did not inject a
high-only request failure. A failed optional high load retains the already
installed shared maps by design. The 17.9 MB high-map estimate is specific to
this RTX 4060 transcode target; low-memory and mobile checks remain open.
