# S7 staged city shadow-depth warmup — 31 Oct 2026

## Result

A targeted warmup now compiles the ordinary shadow-depth material variants
from representative city meshes before the spawn cell is revealed. The built-in
population group stays hidden while its color materials, generic car shadow
material, and custom pedestrian shadow material compile. The pedestrian depth
prewarm uses the same face side and fog state as Three.js's shadow pass.

In a visible cold-program-cache replay, the first city renderer event took
119.0 ms and linked zero new programs. The earlier center-cell capture linked
six programs in 309.8 ms on that first visible city render: three depth
variants, pedestrian color, Lambert, and Basic. This measures the specific
first-city-render link event; it does not prove a lower overall startup maximum.

The candidate warmup recorded:

- City spawn color: 21 programs in 553.8 ms.
- City shadow depth: two generic `MeshDepthMaterial` variants in 11.4 ms.
- Population color: three programs in 129.7 ms.
- Population generic shadow depth: one program in 31.9 ms.
- Pedestrian custom shadow depth: one program in 21.8 ms. Its cache key matched
  the live shadow-pass variant, including the `wtw-walk-ped-depth-v2` key.

The generic city depth cache keys matched the actual shadow-render variants.
The spawn city's first visible shadow render added no shader programs after
the prewarm. The population also requests a shadow refresh after it becomes
visible so its warmed pedestrian and car variants enter the map.

## Method and limits

The local production build ran in visible Chrome at medium quality on an Intel
Core i7-13650HX with an NVIDIA RTX 4060 Laptop GPU. Chrome's GPU program cache
was disabled. The 1280×720 `/street` capture used a Rome fixture shifted to
Tokyo spawn coordinates: the center response contained 4,524 elements and the
eight neighboring responses were empty. The capture sampled 492 frames, with
p95 17.0 ms and max 399.8 ms. It recorded zero console, page, and request
failures.

The earlier and candidate runs were separate single captures, not a matched
multi-run comparison. The candidate's 399.8 ms overall maximum is slightly
higher than the earlier 383.1 ms capture, despite eliminating the city
shader-link event. Startup still has other variable work, and this host is not
the target Intel UHD i5-1035G1. This center-cell diagnostic also does not
exercise a populated 3×3 city, the full globe tour, or visible ground/terrain
relief. It does not close S7.

## Next work

Repeat the full 3×3 visible tour on the target i5-1035G1 and review ground
imagery and terrain relief. Keep S7 open until those gates pass.
