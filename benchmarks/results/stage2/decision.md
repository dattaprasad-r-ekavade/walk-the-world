# Stage 2 prop batching decision

Date: 27 October 2026

## Verdict

Revert the combined global prop-material cache and 128 m spatial batching
experiment. It is not a safe default on the tested Intel UHD 630 workload.

## Evidence

Five alternating, 12-second visible-Chrome runs per build used the same production
scene fixture, fixed pose, population seed, quality settings and settled streamed
cells. The median frame p95 stayed at 16.8 ms. Mean draw calls fell 43%, but GPU
p95 rose 32% (5.73 to 7.58 ms) and submitted triangles rose 50% (65.1k to 97.6k).
The candidate produced no repeatable frame-p95 improvement. See the full
[run-level JSON](prop-material-cache-ab.json) and the matched
[baseline](matched-baseline-initial.png) and [candidate](matched-candidate-initial.png)
captures.

The fixed-path input and population checks passed in all ten runs; each moved
about 60 m, loaded nine cells under the cap of ten, and had no benchmark
validation errors. One baseline run had a 53.2 ms frame-p95 outlier. OS load and
GPU temperature/power were not recorded.

## Follow-up

Keep the experiment reverted. A later comparison may isolate material reuse from
spatial batching, but it must preserve equal visible geometry and pass both the
frame-time and GPU-time gates. The current result is a synthetic prop workload,
not a mobile, real-city, weather or long-walk acceptance run.
