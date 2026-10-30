# S7 city shader warmup attribution — 31 Oct 2026

## Result

Program-level diagnostics on the medium-tier spawn-cell warmup recorded 21 new
programs over 472.2 ms: 15 `MeshStandardMaterial`, four `MeshBasicMaterial`,
and two `MeshLambertMaterial` programs. One standard-material key uses the
custom `wtw-building-atlas-interior-v3` shader; the other sampled keys are
standard renderer variants with differing texture-channel and geometry
features.

The first visible city render then added six more programs in 309.8 ms: three
`MeshDepthMaterial` variants plus one each of `MeshPhongMaterial`,
`MeshLambertMaterial`, and `MeshBasicMaterial`. The trace identifies custom
`wtw-walk-ped-depth-v2` and `wtw-walk-ped-color-v2` variants, but cannot attach
owners to the internally generated depth materials. These programs are
separate from the 21 warmed on the city root.

## Method and limits

This was a visible, cold GPU-program-cache diagnostic in Chrome on an Intel
Core i7-13650HX with an NVIDIA RTX 4060 Laptop GPU. The local production build
ran at medium quality on `/street` with a Rome OSM fixture shifted to the Tokyo
spawn coordinates. The spawn response contained 4,524 elements; neighboring
cell responses were empty. The run reached engine-ready with no console, page,
or request failures, and a 383.1 ms maximum sampled frame.

This isolates shader attribution but does not reproduce the full 3×3 city or
the globe tour. No CPU profile was captured in this run, so the program list
does not show per-program link time. It is not evidence for the target i5-
1035G1 or S7 acceptance.

## Next work

The trace narrows the next experiment to the three shadow-depth variants and
the pedestrian color/depth variants that appear only on the first visible
render. Measure a targeted prewarm for those programs without compiling the
entire scene, then repeat the full 3×3 visible tour and ground/terrain review
on the target laptop. Keep S7 open until that hardware gate passes.
