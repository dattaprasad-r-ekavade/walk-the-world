# Stage 4.6 — PMREM and rooftop shadow acceptance

- Date: 30 October 2026
- Source: `5416644` plus the Stage 4.6 working-tree changes
- Fixture: recorded Rome OSM showcase; no live-data or R2 writes
- Display: visible Chrome 156 on Windows 11, 1280×720 at DPR 1, High quality,
  clear weather at 12:00, two city workers, Intel UHD Graphics

## Quantized environment and shadow updates

The browser audit moved time from 12:00 to 12.1 and changed weather within its
current quantized bucket. Neither operation rebuilt the PMREM or invalidated the
sun shadow map. Moving time to 12.3 crossed to the 12.5 half-hour bucket and
caused exactly one PMREM rebuild and one shadow invalidation. The environment is
therefore not regenerated per frame. Explicit shadow refreshes remain for
initialization, quality changes, visibility and geometry changes, streamed
cells, and meaningful player movement.

The existing [R2 ownership audit](r2-pmrem-target-teardown-2026-10-30.md)
validated repeated PMREM replacement and teardown: 24 day/night cycles held at
22 framebuffers and 2 renderbuffers, and engine teardown released the active
WebGL objects.

## Rooftop shadow comparison

Two same-page, four-second paired runs reversed the order of the baseline and
pruned states. Both measurement windows in each run passed, with supported GPU
timing and no console, page, asset, or benchmark validation errors. The audit
left all eight rooftop clutter meshes and their 4,468 triangles visible in both
states; pruning only disabled their shadow casting.

| Run order | State | Shadow CPU p95 | Shadow calls p50 | Shadow triangles p50 | Full-frame GPU p50 / p95 |
|---|---|---:|---:|---:|---:|
| Baseline, then pruned | Baseline | 0.30 ms | 34 | 31,922 | 27.95 / 29.00 ms |
| Baseline, then pruned | Pruned | 0.30 ms | 31 | 29,694 | 28.39 / 30.35 ms |
| Pruned, then baseline | Pruned | 0.30 ms | 31 | 29,694 | 28.14 / 29.80 ms |
| Pruned, then baseline | Baseline | 0.40 ms | 34 | 31,922 | 28.70 / 30.35 ms |

Pruning removed three shadow draw calls and 2,228 shadow-pass triangles, about
7% of the baseline shadow triangles. Shadow-submit CPU p95 changed by at most
0.1 ms. The full-frame GPU differences reversed with run order, so the paired
data does not show a repeatable performance gain. GPU values cover the whole
frame while the benchmark forced one shadow-map refresh per app frame; they are
not an isolated GPU timing of the shadow pass. Host utilization is omitted
because telemetry coverage was incomplete.

The close oblique captures show unchanged rooftop tank and AC silhouettes.
Pruning removes the soft contact shadows below those props:

- [Rooftop props with shadows](../../../screenshots/performance-visuals/stage4/stage46-shadows/rome-day-rooftop-shadows-baseline.png)
- [Rooftop props with shadows pruned](../../../screenshots/performance-visuals/stage4/stage46-shadows/rome-day-rooftop-shadows-pruned.png)

Keep rooftop prop shadows enabled. The existing batched, baked building shadows
remain the contact baseline. The [Stage 4.5 review](stage45-postfx-acceptance-2026-10-30.md)
found no clearly visible extra facade contact contrast from SSAO at its tested
pose despite its substantial Intel UHD GPU cost; keep High defaults unchanged
while the Stage 4 mobile review remains open. Raw benchmark JSON is ignored and
kept local.
