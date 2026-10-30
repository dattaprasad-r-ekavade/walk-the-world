# S7 Tokyo arrival CPU profile — 31 Oct 2026

A visible production tour ran on the available Intel Core i7-13650HX host. Chrome selected the NVIDIA GeForce RTX 4060 Laptop GPU. The opt-in CDP profiler sampled at 1 ms during Tokyo arrival; this diagnostic run is not target i5-1035G1 acceptance evidence, and its frame timings are not used for the S7 gate.

## Stall attribution

The longest Tokyo arrival frame was 2,666.1 ms. The Long Task API recorded a 2,661 ms task from 12,355.9 ms. The task overlapped a 2,679.5 ms city.cell-shader-warmup event. In the aligned CPU samples, getProgramInfoLog accounted for 2,592.8 ms of the task, with the stack passing through Three.js WebGLRenderer program acquisition. This points to synchronous shader program linking during the hidden cell warmup as the direct source of this arrival stall.

The environment PMREM build took 470.9 ms earlier in the arrival and ended before this long task. It explains earlier blocking during the same arrival, but not the 2,661 ms task analyzed here.

The four S7 acceptance segments remained below 500 ms in this run, with zero console, page, HTTP, or failed-request errors. Profiling was enabled, so these timings are diagnostic only. The target i5 run and visible terrain review are still required.

Next: test frame-budgeted city-cell shader compilation so the synchronous program-link work does not land in one long task. Then repeat on the target i5-1035G1 and review its ground and terrain captures.

See [StreetEngine warmup code](../../../components/StreetEngine.js) and the [Tokyo arrival screenshot](../../../screenshots/performance-visuals/stage0/s7-tour-visible-cpuprofile-2026-10-31/tokyo-arrival.jpg).
