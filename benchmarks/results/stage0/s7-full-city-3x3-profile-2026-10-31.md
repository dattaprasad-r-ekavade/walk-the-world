# S7 full-city 3×3 replay and profile correction — 31 Oct 2026

The visible production-build tour replayed complete Tokyo and Edinburgh
neighborhoods from a captured public OSM fixture. Each neighborhood supplied
all nine cells with no empty or partial payloads: 31,064 elements for Tokyo
and 30,778 for Edinburgh. The 35,415,953-byte fixture had SHA-256
`7DC24D83D85EBB984B31DEDC75596454621A4F8499CF59FA6D25B7EEC13BF6CE`; the
payload itself remains in temporary storage and is not committed.

All runs loaded 9/9 resident cells in each city and reported zero console,
page, HTTP, or request-failure errors. They ran on an Intel Core i7-13650HX
with Chrome selecting the NVIDIA RTX 4060, so they are diagnostic evidence,
not the target i5-1035G1 acceptance run.

## Arrival measurements

| Visible replay | Tokyo arrival max / p95 | Edinburgh arrival max / p95 |
| --- | ---: | ---: |
| First run, Tokyo profiled | 2,582.9 / 233.5 ms | 400.0 / 83.4 ms |
| Repeat, Edinburgh profiled | 850.0 / 200.2 ms | 316.9 / 66.7 ms |
| Repeat after profile-window fix | 832.8 / 132.9 ms | 366.7 / 100.0 ms |
| Stack-aware profile repeat | 850.1 / 166.6 ms | 316.8 / 66.6 ms |
| GPU program cache disabled, Tokyo profiled | 2,549.5 / 349.6 ms | 366.5 / 83.3 ms |
| GPU program cache disabled, 32-frame stack | 2,532.4 / 333.3 ms | 449.8 / 50.0 ms |
| GPU program cache disabled, frame-program diagnostic | 2,482.7 / 433.2 ms | 449.9 / 49.9 ms |
| GPU program cache disabled, program-owner trace | 2,566.0 / 350.0 ms | 383.3 / 66.8 ms |
| Spawn-marker streetlight prewarm attempt | 2,466.0 / 333.3 ms | 216.6 / 99.9 ms |
| Early pool prewarm, before spawn shader warmup | 816.5 / 416.6 ms | 199.9 / 83.5 ms |
| Pool precreated before first terrain render, cache disabled | 883.1 / 150.0 ms | 299.9 / 50.0 ms |
| Pool precreated before first terrain render, normal cache | 882.8 / 166.2 ms | 249.8 / 67.0 ms |

The first Tokyo arrival contained two frames over 500 ms, including a 2,582.9
ms frame and a 2,586 ms Long Task. Three ordinary repeats reached
832.8–850.1 ms. Seven additional tours launched Chrome with
`--disable-gpu-program-cache`. Five reached 2.47–2.57 s; precreating the
high-tier light pool before spawn shader warmup reduced the sixth Tokyo maximum
to 816.5 ms. Moving pool creation earlier, before the first terrain render,
gave 883.1 ms on the seventh run. A separate normal-cache replay of that build
gave 882.8 ms. Both still had one Tokyo frame over 500 ms. These runs are
diagnostic; Edinburgh stayed below 500 ms in every capture.

## CPU profile findings

The first Tokyo capture sampled 2,527.6 ms in native `getProgramInfoLog` calls
during the 2,586 ms Long Task. That capture predates the call-stack grouping
fix below, so its stack summary cannot reliably distinguish PMREM work from
other renderer calls. The earlier local report's attribution of the large
stall to `PMREMGenerator.fromEquirectangular` is therefore provisional.

The full-tour runner now filters the profiled Long Task to the CDP capture
window and keeps separate entries for identical native functions reached by
different call stacks. This also fixed the Edinburgh profile's previous
selection of an earlier Tokyo Long Task with zero overlapping samples.

In the latest stack-aware Edinburgh capture, the longest Long Task was 299 ms
and all 299 ms were sampled. `getProgramInfoLog` accounted for 212.2 ms on the
dominant renderer path; a separate PMREM `_applyGGXFilter` path accounted for
31.6 ms across the arrival profile. The measured `environment.pmrem-build`
event was 42.3 ms, ending about 799 ms before that Long Task began. The
multi-second Tokyo task is a separate path.

The cache-disabled Tokyo capture sampled a 2,527 ms Long Task, with 2,470.6 ms
in `getProgramInfoLog`. Increasing the recorded stack depth to 32 frames showed
the call through `qualityTier` and the regular `render` / `renderBufferDirect`
path; it did not show PMREM or `compileAsync`. The first PMREM build measured
498.6 ms and ended about 1,990 ms before this Long Task. PMREM work was visible
separately in the same profile, including 445.7 ms in `_applyPMREM` /
`_applyGGXFilter`, and overlapped an earlier 886 ms Long Task.

The 2,527 ms task fell inside a 2,702.7 ms `city.neighbor-assembly-total`
interval for 1,499 elements; the corresponding `city.cell-load` interval was
2,660.6 ms. Assembly is budgeted and yields to the host between chunks, so the
overlap identifies the time window but does not prove cell assembly caused the
render-path stall.

The third cache-disabled capture sampled a 2,483 ms Long Task, including
2,416.9 ms in `getProgramInfoLog` on the same ordinary render path. During the
2,482.2 ms render frame, `renderer.info.programs` grew from 48 to 70 entries.

The fourth cache-disabled capture added a material-owner trace. Its 2,551 ms
Long Task was fully sampled, with 2,487.1 ms in `getProgramInfoLog`. The slow
2,549.8 ms render frame added 23 programs (48 to 71). The trace associated
`ground-detail-v1` with eight terrain materials and
`wtw-building-atlas-interior-v3` with seven building materials across five
material families. Several ordinary material variants were also used by the
adjacent cell `wtw_city6_35.660_139.706`; three `MeshNormalMaterial` variants
had no direct `object.material` owner in the scene scan.

Comparing the first terrain program in this run with its new slow-frame variant
showed one cache-key difference: Three.js `numSpotLights` changed from 2 to 6.
The scene starts with two vehicle-headlight spotlights. After the spawn city is
assembled and its shader warmup completes, `syncStreetLightQuality` can add a
four-light streetlamp pool at high quality. Three.js includes the spotlight
count in each lit material's program key, so this order explains why the later
render sees new lit-material variants. The key match is strong evidence for
the cause of the program burst; an A/B warmup run is still needed to measure
the performance effect. The cache-key comparison used Three.js 0.186.1's
`WebGLPrograms.getProgramCacheKeyParameters` and its `numSpotLights` field.

A conditional prewarm attempt tried to create the high-quality pool before the
spawn-city warmup when spawn-cell lamp markers were present. This fixture had
no spawn-cell lamps: the spawn warmup still saw two spotlights and grew the
program count from 19 to 40. A later cell warmup saw six spotlights and added
23 programs, but only after the 2,451 ms render task. Tokyo's 2,466 ms maximum
did not show a material improvement over the cache-disabled baseline.

The high-tier pool is now reserved during engine setup, before the first
terrain-only render. In two visible replays of the same full-city fixture, the
first `ground-detail-v1` program used six spotlights and no later two-spot
variant appeared during Tokyo arrival. Both cities settled all 9/9 cells,
loaded terrain without flat fallback, and logged zero console, page, HTTP, or
request errors. Tokyo still reached 883.1 ms with the GPU program cache
disabled and 882.8 ms with the normal cache; Edinburgh maxima were 299.9 ms
and 249.8 ms.

The longest Tokyo Long Tasks were 895 ms and 889 ms, fully sampled. Their
profiles attributed 430.5 ms and 418.2 ms to `getProgramInfoLog` in the first
PMREM `_applyGGXFilter`, plus 252.3 ms and 246.5 ms on the regular renderer
path. PMREM builds took 478.7 ms and 469.8 ms, followed by first-render
program events of 374.1 ms and 371.2 ms. The stable spotlight count removes
the later two-to-six shader-key change, but these runs do not meet the Tokyo
500 ms gate. Next, investigate the combined initial PMREM and terrain-render
work without repeating the already-tested PMREM shader precompile or input-size
variants, then repeat the full visible gate on the target i5-1035G1.

## Visual check and next work

The [latest Tokyo capture](../../../screenshots/performance-visuals/stage0/s7-tour-2026-10-30T21-53-02-130Z/tokyo-arrival.jpg)
and [Edinburgh capture](../../../screenshots/performance-visuals/stage0/s7-tour-2026-10-30T21-53-02-130Z/edinburgh-arrival.jpg)
show the street surfaces and assembled city geometry on this host. Both cities
reported a loaded terrain tile without flat fallback. This does not replace
the target-device ground and terrain review.

The early-pool replay confirmed the first terrain render and later streamed
cells now use the same six-spot `ground-detail-v1` variant, but two follow-up
replays still recorded 883 ms Tokyo arrival frames from combined PMREM and
first-render shader work. Next, investigate that startup cost, then repeat the
visible gate and terrain review on the target i5-1035G1. S7 remains open. The
[machine-readable summary](s7-full-city-3x3-2026-10-31.json) contains the
complete cell request list and profile captures.
