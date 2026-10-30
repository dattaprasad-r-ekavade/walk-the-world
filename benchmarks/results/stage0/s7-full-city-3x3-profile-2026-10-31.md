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

The first Tokyo arrival contained two frames over 500 ms, including a 2,582.9
ms frame and a 2,586 ms Long Task. Three ordinary repeats reached
832.8–850.1 ms. Three additional tours launched Chrome with
`--disable-gpu-program-cache` and reproduced 2.48–2.55 s Tokyo arrival
frames. That makes the stall reproducible when the program cache
is disabled; those forced-cache runs are diagnostic and are not ordinary S7
timing runs. Edinburgh stayed below 500 ms in the four ordinary captures and
all three cache-disabled captures.

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

In the third cache-disabled capture, a 2,483 ms Long Task contained 2,480 ms
of samples, including 2,416.9 ms in `getProgramInfoLog` on the same ordinary
render path. The PMREM path accounted for 430.6 ms elsewhere in that arrival.
During the 2,482.2 ms render frame, `renderer.info.programs` grew from 48 to 70
entries. The 22 new program records included `ground-detail-v1` and
`wtw-building-atlas-interior-v3` material variants, alongside Standard,
Lambert, Phong, Basic, and Normal material variants. This ties first-use
program creation to the slow frame, but does not identify which material
accounts for most of the compile time.

## Visual check and next work

The [Tokyo capture](../../../screenshots/performance-visuals/stage0/s7-full-city-3x3-stack-aware-2026-10-31/tokyo-arrival.jpg)
and [Edinburgh capture](../../../screenshots/performance-visuals/stage0/s7-full-city-3x3-stack-aware-2026-10-31/edinburgh-arrival.jpg)
show the street surfaces and assembled city geometry on this host. Both cities
reported a loaded terrain tile without flat fallback. This does not replace
the target-device ground and terrain review.

Next, map the 22 new program variants to the scene materials and test targeted
warmup for the responsible variants. Then repeat the visible gate and terrain
review on the target i5-1035G1. S7 remains open. The
[machine-readable summary](s7-full-city-3x3-2026-10-31.json) contains the
complete cell request list and profile captures.
