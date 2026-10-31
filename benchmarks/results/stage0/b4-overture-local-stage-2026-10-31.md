# B4 local Overture stage — 31 October 2026

## Scope

The local-only stage applied the reviewed Overture building index to the 36
already staged B3 Demo refresh candidates. The stage used the existing
`deriveOvertureBuildingPatches` merge path, preserved OSM and prior enrichment
values, and wrote a separate candidate directory. It did not contact R2 or
modify the B3 source stage.

The runner is `npm run seed:stage-overture`. It reads a ready refresh stage and
a local reviewed index, queries public Overture S3, and writes an upload-compatible
local stage. Upload remains a separate operation and requires approval.

## Results

The 36-cell stage passed `verify-city-refresh-stage.mjs` for all cells. Per-city
query and merge totals were:

| City | Cells | Overture rows | OSM-way matches | New field patches |
|---|---:|---:|---:|---:|
| Pune | 9 | 17,933 | 4,204 | 0 |
| Edinburgh | 9 | 14,964 | 9,997 | 732 |
| Tokyo | 9 | 34,913 | 17,767 | 0 |
| New York | 9 | 14,284 | 9,919 | 782 |
| **Total** | **36** | **82,094** | **41,887** | **1,514** |

Pune and Tokyo candidates needed no additional Overture fields. The higher
Edinburgh and New York match counts reflect the refreshed B3 candidates; this
stage is based on those candidate cells, not the previous live cache payloads.

## Reproducibility and status

- Overture release: `2026-10-21.0`
- Overture index SHA-256: `2c5b9326ebdcf0370eb2c4964a53f3b5f37681f664df5f0c1c02499653442ffa`
- B3 source manifest SHA-256: `b5dfea4f24dfe9ec28c439099e372c31df07fa88ca1230d17d395ead9ee7a133`
- B4 local manifest SHA-256: `49e28d1ac44b350dad918390325cb27f19eb4f3846a074dc5abd6763fc3cd7eb`
- Local stage: `.cell-refresh-staging/b4-overture-demo-2026-10-31`

All source and candidate hashes passed the offline stage verifier. No R2
requests or writes occurred. Keep the stage local pending review and separate
upload approval, then perform deployed API acceptance.
