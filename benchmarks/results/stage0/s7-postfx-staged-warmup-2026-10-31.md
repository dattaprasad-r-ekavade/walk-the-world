# S7 staged post-processing shader warmup — 31 Oct 2026

## Result

A staged warmup for medium-tier post-processing reduced the initial-night
first-render event from 258.8 ms linking 12 programs to 186.5 ms linking two
programs in a visible, cold-cache local replay. The longest startup frame fell
from 449.8 ms to 349.9 ms. In a separate day-to-night replay, the baseline
linked nine post-processing programs in a 111.3 ms renderer event; with the
candidate, the night switch added no renderer programs and its longest frame
was 17.0 ms.

The candidate warms output, grade, optional FXAA, and all eight bloom programs
one per animation frame. FXAA was inactive in these captures, so ten programs
were compiled. The warmup completed in 318.2 ms, before the 1,954 ms input-ready
mark in the initial-night run. SSAO and city-cell programs are outside this
warmup.

## Method

Both builds ran visibly in Chrome with `--disable-gpu-program-cache`, medium
quality, and the same local production server. The host was an Intel Core i7-
13650HX with an NVIDIA RTX 4060 Laptop GPU. The direct street route used a
Rome OSM fixture translated to the Tokyo spawn coordinate. Its center response
contained 4,524 elements; neighboring cell responses were empty. This isolates
the initial shader path but is not a full-city replay or S7 acceptance run.

**Initial night startup**

| Build | First renderer event | Longest startup frame |
| --- | ---: | ---: |
| Baseline | 258.8 ms, 12 new programs | 449.8 ms |
| Staged warmup | 186.5 ms, 2 new programs | 349.9 ms |

**Day-to-night switch**

| Build | Renderer link event at switch | Longest switch frame |
| --- | ---: | ---: |
| Baseline | 111.3 ms, 9 new post-FX programs | 99.9 ms |
| Staged warmup | No new programs | 17.0 ms |

The initial-night candidate warmup event reports ten programs compiled over
318.2 ms (program count 1 to 11). Its first visible renderer event still added
two scene programs. The later city render added six programs in 226.8 ms, and
the spawn-cell shader warmup took 512.5 ms; the candidate does not address that
separate work. Browser console, page, and failed-request counts were zero.

Machine-readable captures and the one-off profiling harness remain in local
temporary storage; raw traces are not committed.

## Decision and next work

Keep the staged post-FX warmup as an S7 candidate. It moves ten fullscreen
program links out of the first visible renderer frame on this host without
changing the rendered pass configuration. The fixture, direct route, and RTX
GPU do not establish full-tour behavior or target-device performance. The full
globe harness could not start on this host because DNS resolution for
`unpkg.com` failed while loading Cesium. Repeat the visible 3×3 tour and ground
and terrain review on the target i5-1035G1 before closing S7; also inspect the
remaining city shader-warmup stall separately.
