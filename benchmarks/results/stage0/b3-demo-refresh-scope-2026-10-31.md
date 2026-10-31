# B3 demo-cell refresh scope — 31 October 2026

This is a read-only scope calculation for the pending B3 cached-data refresh.
`npm run seed:list` confirmed the four Demo places, and `cellNeighborhood` plus
`cityCacheKey` produced nine cache keys per place: 36 requested, 36 unique.
All keys use cache version 6.

| Demo place | Cell keys |
| --- | --- |
| Pune | `wtw_city6_18.541_73.896`, `wtw_city6_18.546_73.896`, `wtw_city6_18.535_73.896`, `wtw_city6_18.541_73.901`, `wtw_city6_18.541_73.890`, `wtw_city6_18.546_73.901`, `wtw_city6_18.546_73.890`, `wtw_city6_18.535_73.901`, `wtw_city6_18.535_73.890` |
| Edinburgh | `wtw_city6_55.950_-3.188`, `wtw_city6_55.956_-3.188`, `wtw_city6_55.945_-3.188`, `wtw_city6_55.950_-3.182`, `wtw_city6_55.950_-3.193`, `wtw_city6_55.956_-3.182`, `wtw_city6_55.956_-3.193`, `wtw_city6_55.945_-3.182`, `wtw_city6_55.945_-3.193` |
| Tokyo | `wtw_city6_35.660_139.701`, `wtw_city6_35.665_139.701`, `wtw_city6_35.654_139.701`, `wtw_city6_35.660_139.706`, `wtw_city6_35.660_139.695`, `wtw_city6_35.665_139.706`, `wtw_city6_35.665_139.695`, `wtw_city6_35.654_139.706`, `wtw_city6_35.654_139.695` |
| New York | `wtw_city6_40.758_-73.986`, `wtw_city6_40.764_-73.986`, `wtw_city6_40.752_-73.986`, `wtw_city6_40.758_-73.980`, `wtw_city6_40.758_-73.991`, `wtw_city6_40.764_-73.980`, `wtw_city6_40.764_-73.991`, `wtw_city6_40.752_-73.980`, `wtw_city6_40.752_-73.991` |

No cell was fetched, backed up or uploaded. `.env.local` contains no R2
credentials. The existing `seed-direct --refresh` path uploads each passing
cell as it completes, so it can leave a partially refreshed demo set if a later
cell fails. This scope list does not prove which objects are currently stored
or show proposed payload diffs; those require R2 read access and a staged
refresh preview before any write is authorized.

## Offline Edinburgh re-evaluation — 31 October 2026

The first nine-cell Edinburgh stage marked two cells failed because its 90%
count compared `building` ways only. The city renderer also builds ways
tagged `building:part`, including parts that replace a former `building`
tag. The shared staging/verifier rule now counts either tag on OSM ways.

Using the saved originals and candidates, the corrected local manifest at
`.cell-refresh-staging/edinburgh-building-part-review` passes
`npm run seed:verify-refresh -- --stage-dir=.cell-refresh-staging/edinburgh-building-part-review`.
All nine cells meet the 90% count gate and retain 98.2–99.8% of original
renderable building-way IDs:

| Cell | Renderable ways, original -> candidate | Original IDs retained |
| --- | ---: | ---: |
| `55.950_-3.188` | 1,393 -> 2,004 | 1,385/1,391 (99.6%) |
| `55.956_-3.188` | 1,891 -> 2,000 | 1,880/1,891 (99.4%) |
| `55.945_-3.188` | 1,447 -> 1,733 | 1,441/1,445 (99.7%) |
| `55.950_-3.182` | 1,140 -> 1,497 | 1,136/1,138 (99.8%) |
| `55.950_-3.193` | 1,439 -> 1,995 | 1,433/1,437 (99.7%) |
| `55.956_-3.182` | 1,722 -> 2,000 | 1,718/1,722 (99.8%) |
| `55.956_-3.193` | 2,000 -> 2,000 | 1,964/2,000 (98.2%) |
| `55.945_-3.182` | 1,231 -> 1,357 | 1,223/1,229 (99.5%) |
| `55.945_-3.193` | 1,287 -> 1,629 | 1,283/1,285 (99.8%) |

The review set combines the seven cells saved by the city run and the two
preserved single-cell candidates. It is offline review evidence, not a new
36-cell Demo stage or an R2 upload. No R2 write occurred; the separate upload
approval and live post-refresh visual/performance acceptance remain open.
