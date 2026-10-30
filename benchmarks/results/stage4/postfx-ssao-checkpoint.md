# Post-processing and SSAO checkpoint

Date: 28 October 2026

## Pass-isolated High comparison

Five 12-second runs per state used the same recorded Rome showcase fixture,
visible Chrome 155, Intel UHD 630, 1280×720 viewport at DPR 1.0, High quality,
21:00, clear weather and two geometry workers. Both states kept bloom active;
the diagnostic `--ssao-mode` switch changed only SSAO. All ten measurement
windows and host samples were valid, all saved pass metadata matched the request,
and no browser, page or local-asset errors were reported.

| High pass state | GPU timer p95 median (range) | Frame p95 median (range) | Host CPU median (range) |
|---|---:|---:|---:|
| Bloom + SSAO | 33.81 ms (26.73–34.90) | 50.8 ms (50.0–83.1) | 85.8% (60.8–100) |
| Bloom only | 15.65 ms (12.05–21.11) | 33.5 ms (33.2–50.1) | 53.8% (41.8–98) |

The GPU p95 ranges did not overlap; the median GPU timer p95 fell by 18.16 ms
(53.7%) with SSAO off. Frame p95 also fell, but its ranges overlap and host load
varied, so the frame result is suggestive rather than a clean causal estimate.
The five SSAO-on runs were collected before the five off runs, not interleaved.
Use this as a strong pass-cost signal on the integrated GPU, not a device-wide
performance guarantee.

The two-second matched day and night captures show only subtle additional
contact darkening with SSAO on. The overall city readability, road, exposure and
window lighting look similar; no large daytime washout or night halo change is
visible at this view distance. These captures do not replace close-up review on
other GPUs and mobile screens.

- [High night, SSAO on](postfx-ssao-high-on-matched.png)
- [High night, SSAO off](postfx-ssao-high-off-matched.png)
- [High day, SSAO on](postfx-ssao-day-on.png)
- [High day, SSAO off](postfx-ssao-day-off.png)

## Tier comparison

The separate five-run-per-tier Medium/High night comparison showed GPU timer
p95 medians of 16.49 ms (12.35–18.95) for Medium bloom-only and 33.81 ms
(26.73–34.90) for High SSAO+bloom. Frame p95 medians were 49.4 ms
(33.4–50.0) and 50.8 ms (50.0–83.1), respectively. The High runs reached
100% host CPU twice. Since the tiers also differ in texture and shadow settings,
this comparison is context only; the pass-isolated test above is the evidence
for SSAO cost.

## Decision and remaining work

Keep the shipped High SSAO default unchanged for now. The measured integrated-GPU
savings are substantial, and the screenshots suggest a modest visual tradeoff.
The follow-up [Stage 4.5 closeout report](stage45-postfx-acceptance-2026-10-30.md)
records visible soft night halos and a broader wet-road reflection with bloom,
no material noon washout, and no clearly visible extra facade contact from SSAO
at the tested pose. Those captures are desktop Intel UHD evidence; mobile
acceptance remains part of the Stage 4 exit gate.

Reproduce a 12-second state with `--ssao-mode on` or `--ssao-mode off` while
keeping `--preset high`; the runner verifies the actual pass state in its saved
metadata. The raw JSON captures remain local and are not committed.
