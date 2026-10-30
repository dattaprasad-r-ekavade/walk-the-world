# Stage 4.7 — Facade UV scale checkpoint

- Date: 31 October 2026
- Source: `9231712` plus the facade tangent-mapping change
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

Stage 4.7 remains open for a diagonal-facade visual check, additional shared
storefront variation, a decision on near-entrance geometry, and mobile
acceptance. No performance gain is claimed from this UV-only change.
