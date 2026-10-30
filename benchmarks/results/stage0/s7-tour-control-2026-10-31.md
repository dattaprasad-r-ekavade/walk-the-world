# S7 full-tour harness control-flow run — 31 Oct 2026

The new `npm run bench:s7` path follows the actual Cesium tour: enter free-globe mode, fly to Tokyo, walk, switch to night, then fly to Edinburgh. It records requestAnimationFrame intervals per segment, input-ready and engine-ready transitions, PMREM timing diagnostics, renderer identity, console/page/HTTP errors, city-cell responses, and screenshots. Visible target-device runs must use `--headed`; `--confirm-target-i5-1035g1` is an explicit operator confirmation. A passing performance run still leaves a manual visual review of the saved terrain screenshots.

## Control-flow result

Command:

```powershell
npm run bench:s7 -- --headless --out=benchmarks/results/stage0/s7-tour-control-2026-10-31.json --screenshots=screenshots/performance-visuals/stage0/s7-tour-control-2026-10-31
```

The production tour completed both city arrivals. The player moved 3.5 m during the W-key walk. Both city engines reported ready; terrain-ready diagnostics showed one elevation tile and `flatFallback: false` for each. All 17 observed city-cell responses returned HTTP 200. There were zero console errors, page errors, and HTTP responses at or above 400.

The neighborhood cell streams had not settled when each 45-second wait expired: Tokyo had 7 resident cells and 2 pending; Edinburgh had 5 resident cells and 4 pending. This run confirms the interaction flow and produces reviewable captures, but it does not confirm terrain relief or imagery on the target laptop.

| Segment | Headless max frame | Samples |
| --- | ---: | ---: |
| Globe startup | 50.1 ms | 15 |
| Globe flight to Tokyo | 300.0 ms | 44 |
| Tokyo arrival | 1,249.9 ms | 79 |
| Tokyo cell settling | 1,016.7 ms | 68 |
| Walk | 800.0 ms | 8 |
| Night switch | 1,133.3 ms | 3 |
| Street flight to Edinburgh | 833.4 ms | 11 |
| Edinburgh arrival | 1,916.6 ms | 121 |
| Edinburgh cell settling | 799.9 ms | 89 |

The renderer was SwiftShader (`ANGLE ... SwiftShader Device`), and headless Chromium throttled animation frames; several measured segments yielded only 3–11 samples. These frame numbers are not Intel UHD performance evidence and are not comparable to the 500 ms S7 gate.

## Target-laptop run

On the Intel Core i5-1035G1 laptop, run visible Chrome from this checkout:

```powershell
npm run bench:s7 -- --headed --confirm-target-i5-1035g1 --out=benchmarks/results/stage0/s7-tour-target-2026-10-31.json --screenshots=screenshots/performance-visuals/stage0/s7-tour-target-2026-10-31
```

Review the reported adapter and the Tokyo/Edinburgh screenshots for ground imagery and terrain relief. S7 stays open until that visible target run meets the frame/error criteria and the visual review passes.

## Captures

- [Globe ready](../../../screenshots/performance-visuals/stage0/s7-tour-control-2026-10-31/globe-ready.jpg)
- [Tokyo arrival](../../../screenshots/performance-visuals/stage0/s7-tour-control-2026-10-31/tokyo-arrival.jpg)
- [Tokyo walk](../../../screenshots/performance-visuals/stage0/s7-tour-control-2026-10-31/tokyo-walk.jpg)
- [Tokyo night](../../../screenshots/performance-visuals/stage0/s7-tour-control-2026-10-31/tokyo-night.jpg)
- [Edinburgh arrival](../../../screenshots/performance-visuals/stage0/s7-tour-control-2026-10-31/edinburgh-arrival.jpg)
- [Machine-readable run](s7-tour-control-2026-10-31.json)
