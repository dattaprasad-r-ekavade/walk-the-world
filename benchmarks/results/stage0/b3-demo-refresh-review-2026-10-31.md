# B3 full Demo refresh candidate review — 31 October 2026

## Staged data

The read-only refresh used the HPI Overpass endpoint and read originals through
the deployment's public cache proxy. All 36 unique cache-version-6 Demo cells
are staged and the local manifest is `ready` with zero failures. The exact
manifest is in `.cell-refresh-staging/hpi-demo-2026-10-31/manifest.json`; it is
17,595 bytes with SHA-256
`b5dfea4f24dfe9ec28c439099e372c31df07fa88ca1230d17d395ead9ee7a133`. Candidate
and original JSON payloads remain in the same local stage directory. Generated
JSON under `benchmarks/results/` stays untracked under the repository's ignore
policy.

`npm run seed:verify-refresh -- --stage-dir=.cell-refresh-staging/hpi-demo-2026-10-31`
passed all 36 cells, including payload hashes, complete-cell checks, the 90%
renderable-building count threshold and retention of existing enrichment. An
additional same-way-ID comparison found at least 94.0% of original building
way IDs retained in every cell.

| City | Cells | Renderable ways, original → candidate | Minimum same-ID retention in a cell |
| --- | ---: | ---: | ---: |
| Pune | 9/9 | 4,206 → 4,216 | 99.7% |
| Edinburgh | 9/9 | 13,550 → 16,215 | 98.2% |
| Tokyo | 9/9 | 17,877 → 17,964 | 97.2% |
| New York | 9/9 | 10,490 → 17,929 | 94.0% |

## Four-city candidate replay

Visible Chrome replayed the staged candidates through the deployed street app.
A Node-side proxy served each cell from the local candidate snapshot, while the
four demo presets kept their configured coordinates, time, weather and heading.
All four cities reached engine-ready, settled with 9/9 resident cells, matched
their preset heading and had zero console errors. The renderer received 212
landuse rings across 47 painted tiles.

| City | Landuse rings / painted tiles | 60-frame p95, baseline → candidate |
| --- | ---: | ---: |
| Pune | 31 / 10 | 16.9 → 16.8 ms |
| Edinburgh | 29 / 10 | 16.9 → 17.0 ms |
| Tokyo | 130 / 14 | 16.9 → 16.9 ms |
| New York | 22 / 13 | 16.8 → 16.8 ms |

The short frame sample ran with diagnostics enabled on this host. Treat it as
diagnostic; it does not satisfy the target-hardware performance gate or replace
post-refresh production acceptance.

| City | Pre-refresh baseline | Staged candidate |
| --- | --- | --- |
| Pune | [Screenshot](../../../screenshots/performance-visuals/stage0/b3-landuse/pre-refresh-pune-2026-10-31.jpg) | [Screenshot](../../../screenshots/performance-visuals/stage0/b3-demo-candidate-replay-2026-10-31/pune.jpg) |
| Edinburgh | [Screenshot](../../../screenshots/performance-visuals/stage0/b3-landuse/pre-refresh-edinburgh-2026-10-31.jpg) | [Screenshot](../../../screenshots/performance-visuals/stage0/b3-demo-candidate-replay-2026-10-31/edinburgh.jpg) |
| Tokyo | [Screenshot](../../../screenshots/performance-visuals/stage0/b3-landuse/pre-refresh-tokyo-2026-10-31.jpg) | [Screenshot](../../../screenshots/performance-visuals/stage0/b3-demo-candidate-replay-2026-10-31/tokyo.jpg) |
| New York | [Screenshot](../../../screenshots/performance-visuals/stage0/b3-landuse/pre-refresh-new-york-2026-10-31.jpg) | [Screenshot](../../../screenshots/performance-visuals/stage0/b3-demo-candidate-replay-2026-10-31/new-york.jpg) |

## Remaining gate

No R2 write occurred. Uploading this exact candidate set still requires
separate approval. After an approved cache update, verify the deployed cells
and complete live four-city visual and performance acceptance.
