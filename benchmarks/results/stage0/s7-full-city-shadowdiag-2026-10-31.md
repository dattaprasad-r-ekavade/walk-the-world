# S7 full-city shader diagnostic — 31 Oct 2026

## Result

A visible local production-build replay loaded all nine Tokyo fixture cells: 31,064
OSM elements, nine resident cells, and zero pending cells. It completed with no
console errors, page errors, or failed requests. The first
input-ready mark recorded one terrain tile.

The replay used Chrome on the RTX 4060 Laptop GPU at medium quality with the
GPU program cache disabled. Across 483 frame intervals, p95 was 33.3 ms and
the maximum was 366.4 ms. In the 315 intervals sampled after all nine cells
settled, p95 was 16.9 ms and the maximum was 17.1 ms.

The frame trace recorded four renders of at least 50 ms. The input-ready render
took 185 ms and added two programs (standard and basic materials). The other
three took 118.3, 96.9, and 170.9 ms and added no programs. The new diagnostic
also watches renders below 50 ms; this replay recorded no shader-program
additions in those frames. Separate warmup events compiled 20 spawn-city
programs, two generic city shadow-depth variants, and the population color and
depth variants before reveal. The eight streamed neighbor-cell warmups added
one program in total; the subsequent seven added none.

The [capture](../../../screenshots/performance-visuals/stage0/s7-full-3x3-shadowdiag/tokyo-three-by-three-2026-10-31.png)
shows visible buildings, roadway, sidewalk, and ground texture. This street
view is in a flat urban area and does not show whether surrounding terrain
relief is correct.

## Edinburgh ground and terrain spot-check

A second visible local replay at Edinburgh coordinates loaded all nine city
cells (30,778 OSM elements). Nine Terrarium elevation tile responses and 36
Carto ground-imagery responses returned HTTP 200; there were no HTTP errors,
request failures, console errors, or page errors. A 5×5 `groundHeight` sample
grid at 150 m spacing ranged from 57.5 m to 95.3 m, a 37.8 m elevation range.
The [elevated capture](../../../screenshots/performance-visuals/stage0/s7-full-3x3-shadowdiag/edinburgh-elevated-2026-10-31.png)
shows the loaded city and ground layers. This confirms local image and height
data are present, but it is not a terrain accuracy review against an external
reference and it was not captured on the target i5.

## Method and limits

The local production build was served at `/street` and routed to a recorded
Tokyo 3×3 fixture. This verifies streamed city rendering and shader warmup, but
does not run the globe flight, walking, night switch, street travel, or live
deployment. It is one run on the RTX 4060, not the target Intel UHD
i5-1035G1, and it is not a matched before/after comparison. Therefore it does
not close S7.

Machine-readable results: [JSON capture](s7-full-city-shadowdiag-2026-10-31.json).

## Next work

Run the full S7 tour on the target i5-1035G1 and review ground imagery and
terrain relief there. Keep S7 open until those gates pass.
