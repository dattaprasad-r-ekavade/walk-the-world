# Stage 4.7 — Facade UV scale checkpoint

- Date: 31 October 2026
- Source: `0b8ac85` on `origin/main`
- Fixture: recorded Rome OSM showcase; no live-data or R2 writes
- Display: visible Chrome 156 on Windows 11, 1280×720 at DPR 1, High quality,
  clear weather at 12:00, two geometry workers, Intel UHD Graphics
- Camera: fixed pose `(130 m, 112 m)`, heading `1.62`, pitch `0`; SSAO and bloom off

## Existing facade detail

The shared facade atlas already includes window recess shading, frames, sills,
grime streaks, and a storefront band with glazing, a door, handle, and fascia.
Building material families and wall tints also vary deterministically. The High
PBR maps use the same wall UVs as the shared maps.

## Tangent-based wall mapping

Wall U previously used `(x + z) * 0.12 + jitter`. This changes repeat scale by
wall direction: on a 45-degree facade it can compress the atlas, and on the
opposite diagonal it can nearly stop U from changing along the wall. The UV
mapping now projects each wall vertex onto the horizontal tangent from the wall
normal, with a canonical direction so opposite faces do not mirror the atlas.
The existing 0.12 repeats-per-meter scale and per-building offset remain. This
adds no texture fetches, material instances, or geometry.

## Build and browser capture

`npm run build` completed. The matched browser capture used the same Rome fixture,
pose, High preset, and post-processing settings as the earlier facade review.
The recorded city returned 4,524 elements; shared and High facade maps loaded;
the benchmark reported no console errors, page errors, asset failures, or run
error. The short capture is visual/runtime evidence, not a performance A/B.

The current close view shows no visible UV seam or scale regression on the main
facade, but that wall is close to axis-aligned. It does not visually confirm the
diagonal-wall improvement. Compare the earlier view and current capture here:

- [Earlier fixed-pose facade](../../../screenshots/performance-visuals/stage4/stage45-postfx/rome-day-contact-ssao-off.png)
- [Current tangent-mapped facade](../../../screenshots/performance-visuals/stage4/stage47-facade-mapping/rome-day-facade-tangent-matched.png)

## Controlled diagonal-facade comparison

To exercise a diagonal wall, a local visual fixture rotated Rome building way
`202849725` to expose a 60.3-degree facade and removed eight neighboring
building ways within 55 m to prevent overlaps. Roads and the rest of the city
fixture remained intact. This fixture and its raw benchmark JSON stay local and
ignored; this controlled scene is not real-city acceptance evidence.

The old and new captures used the same fixed pose, High preset, clear noon,
1280×720 viewport, two workers, and disabled SSAO/bloom. Both browser runs passed
with zero console errors, page errors, asset failures, or benchmark validation
errors; each recorded more than 7.5 m of movement. The baseline was rebuilt with
the pre-change `(x + z) * 0.12 + jitter` mapping. The candidate used the
wall-tangent projection.

Along the tested 60.3-degree wall, the old projection changes U by about 1.36
units per meter, so the 0.12 repeat scale resolves to roughly 6.1 m per atlas
repeat. The tangent projection restores the intended 8.3 m. The matched images
show the old facade's tighter window/detail spacing and the candidate's
consistent scale, with no visible seams:

- [Old diagonal-wall mapping](../../../screenshots/performance-visuals/stage4/stage47-facade-mapping/diagonal-old-uv-isolated.png)
- [Tangent-mapped diagonal wall](../../../screenshots/performance-visuals/stage4/stage47-facade-mapping/diagonal-new-uv-isolated.png)

This validates the UV scale change on a controlled diagonal facade; it makes no
performance claim. The four-city D8 rehearsal captures also show the accepted
storefront and entrance treatment in Pune, Edinburgh, Tokyo and New York. With
the atlas detail inventory and this diagonal-wall check, desktop Stage 4.7 is
accepted; these captures do not close the separate Stage 4 mobile
visual/performance review.
