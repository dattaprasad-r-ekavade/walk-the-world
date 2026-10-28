# Stage 4.2 — Road ribbon refinement

Date: 28 October 2026
Status: complete for the recorded Rome visual checkpoint; real-GPU review and
close-up marking acceptance remain open.

## Changes

- Use explicit OSM road widths and lane counts where available, with a
  road-class fallback; use the same width estimate when framing the spawn view.
- Build joined ribbons with bounded miters, deduplicate paths by OSM way ID,
  reduce terrain lift, and give bridge decks cumulative-distance UVs.
- Keep road surfaces opaque so they write depth, narrow the underpaint layer,
  lighten the asphalt albedo, reduce normal strength, raise roughness, and use a
  longer texture repeat with thinner, longer markings.

## Visual review

The before and after captures use the recorded Rome showcase fixture, the same
start pose and seed, medium quality, Chrome 156, browser-default renderer,
1280×720 viewport, and a 12-second walk. Both requests passed capture validation
and moved about 60 m. These are headless visual references; they do not establish
live Overpass behavior or hardware performance.

The day after-capture has a lighter, smoother road ribbon while curb edges remain
visible. The night after-capture still has very dark asphalt on unlit road. This
pose does not give a clean close-up acceptance view of the road markings, so
marking fidelity needs a matched near-road view during later visual review.

| Condition | Before | After |
|---|---|---|
| Day, clear | [rome-day-clear.png](rome-day-clear.png) | [rome-day-clear-road-tuned.png](rome-day-clear-road-tuned.png) |
| Night, clear | [rome-night-clear.png](rome-night-clear.png) | [rome-night-clear-road-tuned.png](rome-night-clear-road-tuned.png) |

After-capture benchmark records: [day JSON](rome-day-clear-road-tuned.json),
[night JSON](rome-night-clear-road-tuned.json).

## Exit and follow-up

The geometry and material refinements are retained. `npm run build` passed after
these changes. No test suite was run for this checkpoint. Stage 4.3 should
revisit night asphalt under wetness and nearby light pools, and validate that
roads created after a weather change inherit the current wetness. Real-GPU
reflection/visual acceptance and a close-up road-marking view remain open.
