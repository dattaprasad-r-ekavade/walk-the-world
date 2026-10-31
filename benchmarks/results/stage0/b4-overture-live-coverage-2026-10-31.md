# B4 live Overture coverage dry run — 31 October 2026

## Scope and method

This read-only dry run checked the four Demo neighborhoods (36 unique
`wtw_city6_*` cells). All 36 city payloads downloaded from the deployment's
public cache proxy and passed `isCompleteCity`. Overture rows came directly
from public S3 using the reviewed `2026-10-21.0` manifest, which lists 512
Parquet files. The per-cell bounds match `scripts/enrich-r2-cells.mjs`; rows
were selected with the Overture server's bounding-box predicates and passed
through the production `deriveOvertureBuildingPatches` function. The initial
query used the old 3,000-row limit. Eight cells reached that cap and were
rerun with a 10,000-row diagnostic limit.

No R2 credentials were used and no R2 writes occurred. The live
`/api/overture-index` check still reports no deployed index, so this validates
public source coverage and patch generation, not the production Overture API
or a cache upload.

## Results

| City | Complete cache cells | Rows per cell at the new 5,000 limit | OSM-way matches per cell | Buildings patched per cell | Cells capped at old 3,000 limit | Fields filled |
|---|---:|---:|---:|---:|---:|---|
| Pune | 9/9 | 1,382–4,330 | 343–674 | 0 | 1 | None |
| Edinburgh | 9/9 | 1,210–2,344 | 854–1,554 | 56–107 | 0 | `height` |
| Tokyo | 9/9 | 2,919–4,770 | 1,821–1,997 | 0–823 | 7 | `height`, `building:levels` |
| New York | 9/9 | 1,006–2,001 | 670–1,567 | 61–139 | 0 | `height`, `building:levels`, `building:material` |

The per-cell bounding boxes overlap, so these cell counts are not unique city
building totals. No roof or facade fields were filled in this sample. Pune's
3,000-row cell gained 127 OSM-way matches at the higher diagnostic cap but
still had no missing Overture fields to apply.

The seven capped Tokyo cells gained 585 additional patchable buildings when
the diagnostic limit increased to 10,000; two of those cells still had no
missing fields to fill. The eighth capped cell was Pune. All eight returned
fewer than 5,000 rows at the diagnostic limit, so the new 5,000 limit covers
all 36 sampled cells. On the largest cell, the 4,770-building JSON response
was 1,473,920 bytes raw and 214,819 bytes gzipped. The local runtime query
limit increased from 3,000 to 5,000 based on this result.

## Remaining acceptance

The deployed manifest and New York Overture cache object both returned 404,
and `GET /api/overture-index` returned `{"indexed":false,"files":0}`. The
cell API may write a cache miss to R2, so it was not called. SEC1/B4 still need
the reviewed manifest uploaded under separate approval, deployed release
confirmation, and a safe live API acceptance check.
