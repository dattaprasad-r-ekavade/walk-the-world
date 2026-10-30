# S7 visible arrival stall diagnostic — 31 Oct 2026

A visible production tour ran on the available Intel Core i7-13650HX host. Chrome selected the NVIDIA GeForce RTX 4060 Laptop GPU. This checks the visible tour and adds timing diagnostics, but it is not target i5-1035G1 evidence; S7 remains open.

## Tour results

| Segment | Maximum frame | p95 |
| --- | ---: | ---: |
| Globe flight to Tokyo | 300.0 ms | 17.0 ms |
| Tokyo arrival to engine ready | 2,715.8 ms | 66.8 ms |
| Walk | 17.0 ms | 16.9 ms |
| Night switch | 17.0 ms | 16.9 ms |
| Street flight to Edinburgh | 49.9 ms | 16.9 ms |
| Edinburgh arrival to engine ready | 200.0 ms | 50.2 ms |

The four S7 acceptance segments stayed under 500 ms. Both city streams settled at 9/9 cells. Console errors, page errors, and HTTP error responses were zero. One OSM tile request was cancelled during navigation (net::ERR_ABORTED).

## Tokyo arrival stall

The longest Tokyo arrival frame lasted 2,715.8 ms, from 13,240.3 to 15,956.1 ms in the browser timeline. The Long Task API recorded a 2,682 ms task starting at 13,286.3 ms, with attribution reported only as self / unknown. The nearest preceding instrumented city work included 95.4 ms of neighbor assembly and 105 ms of cell shader warmup. Those events do not explain the multi-second task, and no instrumented event identifies its source.

The capture confirms a substantial arrival stall but does not yet identify a fix. The next useful diagnostic is a browser CPU profile over Tokyo arrival, followed by the target i5-1035G1 visible tour and terrain visual review.

Screenshots: [globe ready](../../../screenshots/performance-visuals/stage0/s7-tour-visible-stall-2026-10-31/globe-ready.jpg), [Tokyo arrival](../../../screenshots/performance-visuals/stage0/s7-tour-visible-stall-2026-10-31/tokyo-arrival.jpg), [Tokyo walk](../../../screenshots/performance-visuals/stage0/s7-tour-visible-stall-2026-10-31/tokyo-walk.jpg), [Tokyo night](../../../screenshots/performance-visuals/stage0/s7-tour-visible-stall-2026-10-31/tokyo-night.jpg), [Edinburgh arrival](../../../screenshots/performance-visuals/stage0/s7-tour-visible-stall-2026-10-31/edinburgh-arrival.jpg).
