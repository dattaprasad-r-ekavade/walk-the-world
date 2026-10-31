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
