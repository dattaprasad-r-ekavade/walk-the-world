# Stage 4.5 — Bloom and contact-shadow acceptance

- Date: 30 October 2026
- Source revision: `0ad75d1` plus local bloom isolation and same-page capture changes
- Fixture: recorded Rome OSM showcase; no live-data or R2 writes
- Display: visible Chrome 156, Windows 11, 1280×720 at DPR 1, High quality,
  ANGLE Direct3D 11 on Intel UHD Graphics

## Bloom review

Added `--bloom-mode preset|on|off` to isolate bloom while the composer, output
pass and color grade remain active. `--postfx-pair bloom|ssao` captures both
states sequentially in one browser page at a fixed pose. The normal preset still
enables the same bloom state as before. Four five-second measurement windows
used seed 1337; metadata verified the requested states.

The 21:00 close-facade pair shows a soft visible halo around lit windows with
bloom on. At the rainy road pose, bloom broadens the lamp reflection into a
diffuse highlight. The 12:00 facade pair shows no material daytime washout.
These are visual observations; they do not claim bloom improves road lighting.

## SSAO and cheaper contact shading

Matched 12:00 facade captures compare High SSAO on/off with bloom off. The
existing building contact shadows are baked into each ground tile using one
batched path and one blurred fill per tile (`assemble-city.js`). They remain
present in both captures; at this pose, SSAO adds no clearly visible contact
contrast at the facade. Building silhouettes are unchanged.

The earlier five-run pass-isolated benchmark remains the performance basis:
High SSAO+bloom had a 33.81 ms median GPU p95, versus 15.65 ms for bloom-only,
with non-overlapping ranges on the Intel UHD system. Keep the High default
unchanged while mobile visual and performance acceptance is pending. The R3
post-processing teardown audit is already complete.

## Captures

- [Clear night facade, bloom off](../../../screenshots/performance-visuals/stage4/stage45-postfx/rome-night-bloom-off.png)
- [Clear night facade, bloom on](../../../screenshots/performance-visuals/stage4/stage45-postfx/rome-night-bloom-on.png)
- [Rainy road lamp, bloom off](../../../screenshots/performance-visuals/stage4/stage45-postfx/rome-night-rain-bloom-off.png)
- [Rainy road lamp, bloom on](../../../screenshots/performance-visuals/stage4/stage45-postfx/rome-night-rain-bloom-on.png)
- [Noon facade, bloom off](../../../screenshots/performance-visuals/stage4/stage45-postfx/rome-day-bloom-off.png)
- [Noon facade, bloom on](../../../screenshots/performance-visuals/stage4/stage45-postfx/rome-day-bloom-on.png)
- [Noon facade, SSAO off](../../../screenshots/performance-visuals/stage4/stage45-postfx/rome-day-contact-ssao-off.png)
- [Noon facade, SSAO on](../../../screenshots/performance-visuals/stage4/stage45-postfx/rome-day-contact-ssao-on.png)

All four measurement windows passed with valid frame and host telemetry, verified
pass-state metadata, zero browser console/page errors, zero failed assets and
zero benchmark validation errors. Raw JSON remains local and ignored. These
desktop captures do not close Stage 4's mobile exit gate.
