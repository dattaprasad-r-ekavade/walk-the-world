# Stage 4.1 — Lighting reference poses

Date: 28 October 2026
Status: complete for the recorded Rome visual checkpoint; road-surface contrast
continues in Stage 4.2.

## Matched capture setup

- Location: Rome showcase, 41.8902° N, 12.4922° E.
- Fixture: `benchmarks/fixtures/rome-showcase-osm.json` in recorded replay mode.
- Pose: x = -7.647023843889386 m, z = 112 m, heading = π/2; seed 1337.
- Medium quality, Chrome 156, browser-default renderer, 1280×720 viewport,
  12-second walk. Each capture validated the requested time/weather and moved
  about 60 m from the same start pose.
- Captures are headless visual references, not live Overpass or hardware
  acceptance evidence.

## Tuning

- Set daytime exposure to 1.08 and dusk exposure to 1.2; night exposure keeps
  its existing window-glow response.
- Changed the night background to deep blue (`#121b2d`) and made overcast sky
  and environment-map colors depend on solar elevation. Night rain now keeps a
  cool dark palette rather than blending toward daytime gray.
- Reduced fog density at dusk and night, with a smaller rain contribution after
  dark. Hemisphere fill now has a 0.38 night floor while reaching 0.46 at noon;
  environment intensity is 0.85 at night and 1.0 at noon.

## Visual review and remaining work

The day and dusk captures retain block and curb shapes. Night and night-rain
retain a dark blue sky, building silhouettes and roadside edges instead of
collapsing into a black sky or a gray overcast wash. Stage 4.2 lightened and
smoothed the road surface in the day reference. Asphalt on unlit roads still
looks very dark at night; reassess it with Stage 4.3 wetness and nearby light
pools.

| Condition | Capture | Benchmark record |
|---|---|---|
| Day, clear — 12:00, weather 0 | [rome-day-clear.png](rome-day-clear.png) | [JSON](rome-day-clear.json) |
| Dusk, clear — 18:00, weather 0 | [rome-dusk-clear.png](rome-dusk-clear.png) | [JSON](rome-dusk-clear.json) |
| Night, clear — 21:00, weather 0 | [rome-night-clear.png](rome-night-clear.png) | [JSON](rome-night-clear.json) |
| Night, rain — 21:00, weather 90 | [rome-night-rain.png](rome-night-rain.png) | [JSON](rome-night-rain.json) |
