# Stage 1.4 — data copies and repeated road queries

The Stage 1.4 optimizations are implemented on `main`'s working tree. The
read-only city consumer shares the cached response instead of making a full
defensive clone. Editor hidden-feature filtering creates a local array, and tag
overrides clone only the elements and tag objects they change. Geometry-worker
terrain packing still copies its height buffers, preserving the live height
cache. Collision and height-cache implementations were not changed.

## City-data copy comparison

Five interleaved pairs used the recorded Rome fixture, a cold browser cache,
visible Chrome 156, the medium preset, two geometry workers and a 12-second
boundary walk. The [run summary](city-data-copy-on-write-five-pair.json) records
the individual measurements.

- The deep-clone event had a 17.5 ms median (16.4–18.0 ms). The read-only event
  reported 0 ms at the browser timer's resolution.
- Median city-ready time was 5,201 ms with cloning and 5,235 ms read-only. The
  paired read-only-minus-clone median was +128 ms (−138 to +256 ms), so the
  change did not improve startup time.
- Frame p95 median was 14 ms in both modes. GPU p95 medians were 7.507 ms for
  clone and 7.618 ms read-only; the paired GPU p95 delta median was +0.050 ms.
  These runs show no frame-time gain.

The copy is removed because its measured main-thread cost and duplicate object
graph are unnecessary when the caller does not mutate cached data, not because
the A/B established a startup or frame-time improvement.

## POI-to-road query comparison

The initial worker profile found 63 nearest-road queries against 729 road paths
(5,643 segments) in the populated Rome cell. A full scan tested 355,509
segments per geometry job. Five interleaved scan/indexed pairs are in the
[query result summary](road-query-index-five-pair.json); all ten walks passed
movement, cell-streaming and browser-diagnostic checks.

- Scan query time had a 15.6 ms median (14.3–19.6 ms). The indexed path tested
  5,193 candidates, 98.54% fewer, with a 1.3 ms query median and a 5.3 ms index
  build median. Query plus index-build time had a 6.7 ms median; its paired
  indexed-minus-scan median was −9.0 ms (−12.7 to −7.6 ms).
- Primary city worker compute had medians of 85.1 ms for scan and 82.6 ms for
  indexed. The paired compute delta median was −6.1 ms.
- The city output buffer was 1,937,788 bytes in every run. The index retains
  road-segment order within each bucket and indexes each segment's bounding box
  expanded by the 18 m query radius, so it includes every segment that could
  meet the existing distance test while preserving tie order.
- City-ready medians were 5,192 ms for scan and 5,378 ms indexed. The paired
  indexed-minus-scan median was +207 ms (−44 to +415 ms), indicating no
  reliable startup improvement. Frame p95 median was 14 ms in both modes; GPU
  p95 medians were 7.558 ms and 7.573 ms. No frame-time improvement was
  established.

The indexed path stays enabled because the repeated worker query plus index
build is consistently cheaper and reduces segment checks substantially. The
benchmark-only scan control remains available for future fixtures and hardware.

## Validation and next item

`npm run build` passed after the changes. Each recorded walk validated about
60 m of movement and a real cell crossing, with ten resident cells and no
console, page or asset failures. The read-only copy comparison and road-query
comparison each used five interleaved pairs. These are desktop results on one
Chrome/Intel UHD system; they do not establish mobile performance or memory
use.

Stage 1.4 is complete. The next plan item is 1.5: verify terrain eviction and
revisit, road repaint, shared material ownership, late imagery callbacks and
stationary retries.
