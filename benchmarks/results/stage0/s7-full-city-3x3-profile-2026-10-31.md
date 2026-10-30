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

The first Tokyo arrival contained two frames over 500 ms, including a 2,582.9
ms frame and a 2,586 ms Long Task. The three later tours did not repeat a
multi-second frame; Tokyo still reached 832.8–850.1 ms. This pattern is
consistent with a cold or cache-sensitive shader stall, but these runs do not
establish that cause. Edinburgh stayed below 500 ms in the four captures.

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
multi-second Tokyo task has not yet been reproduced with the corrected
stack-aware profiler, so its exact call path remains open.

## Visual check and next work

The [Tokyo capture](../../../screenshots/performance-visuals/stage0/s7-full-city-3x3-stack-aware-2026-10-31/tokyo-arrival.jpg)
and [Edinburgh capture](../../../screenshots/performance-visuals/stage0/s7-full-city-3x3-stack-aware-2026-10-31/edinburgh-arrival.jpg)
show the street surfaces and assembled city geometry on this host. Both cities
reported a loaded terrain tile without flat fallback. This does not replace
the target-device ground and terrain review.

Next, capture a cold Tokyo first arrival with the corrected stack-aware
profiler, then repeat the visible gate and terrain review on the target
i5-1035G1. S7 remains open. The [machine-readable summary](s7-full-city-3x3-2026-10-31.json)
contains the complete cell request list and both profile captures.
