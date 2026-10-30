# S7 frame-budgeted city shader warmup experiment — 31 Oct 2026

The visible Tokyo profile on the available i7-13650HX/RTX 4060 host attributed
the 2.66 s arrival Long Task to synchronous program linking during
`city.cell-shader-warmup`. A local recorded Rome fixture was used to compare
the existing implementation with two frame-budgeted prototypes. All runs used
the same production benchmark server, Chrome 156, visible mode, medium quality,
and the checked-in Rome OSM fixture. These results are a one-run diagnostic
comparison on the RTX 4060, not target i5-1035G1 acceptance evidence.

| Variant | Engine ready | Spawn-cell warmup | Long Tasks overlapping warmup |
| --- | ---: | ---: | ---: |
| Existing whole-group `compileAsync` | 3,564 ms | 503.6 ms | 0 |
| Frame-budgeted, compile each renderable | 5,599 ms | 2,446.2 ms | 0 |
| Frame-budgeted, deduplicate by shader signature | 5,415 ms | 2,291.3 ms | 0 |

The two frame-budgeted variants split synchronous work across animation frames,
but extended total warmup time and delayed engine readiness by about 1.85–2.04 s
on this fixture. The signature-deduplicated version reduced overhead only
slightly compared with compiling each renderable. Since the existing fixture
run did not contain a Long Task overlapping the baseline warmup, these results
do not demonstrate an improvement for this workload. Both runtime prototypes
were reverted; only benchmark instrumentation for recording Long Tasks and
their overlap with shader warmup events is retained.

Next, inspect Three.js's actual program-key behavior and `compileAsync` polling
path to find an approach that avoids duplicate asynchronous waits while still
covering all material variants. Any candidate must be measured on the target
i5-1035G1 and checked in the visible Tokyo arrival path before S7 can close.
