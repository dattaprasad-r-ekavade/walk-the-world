# B2 regional Overpass source build — 31 October 2026

## Regional input and merge

The source builder completed successfully on Windows using Git Bash and
Osmium 1.19.1 (libosmium 2.23.1). It downloaded the four Geofabrik extracts,
validated each published MD5, merged them as metadata-free OSM XML in bzip2,
and emitted a source manifest. The manifest and large data files remain in
temporary local storage and are not part of this repository.

| Region | Bytes | Published MD5 | SHA-256 |
| --- | ---: | --- | --- |
| [New York](https://download.geofabrik.de/north-america/us/new-york-latest.osm.pbf) | 498,367,964 | `249025971906f6f8647f6862ca1889d7` | `4151ed5a4d0074a1b7fe57af71d76c4ec2e35b6522028022a598a969c68e129e` |
| [Western Zone, India](https://download.geofabrik.de/asia/india/western-zone-latest.osm.pbf) | 221,833,750 | `1047c7cd263493a465b7e50746bd2631` | `a153b789d08497aec50f8a689aad4e98193906eec26a18bca935ae6d6b01176c` |
| [Kantō, Japan](https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf) | 523,410,018 | `4d5f5eb1222ec742656abed6579d630b` | `56729fc1a083d40cb64499e9a2b022aedca80d322fb89a2de5082d6b90a235b6` |
| [Scotland](https://download.geofabrik.de/europe/united-kingdom/scotland-latest.osm.pbf) | 329,450,205 | `03846e1741c83680fb8e9c6629743b63` | `78e4af755b2ec8259ba57c142ffe2579c392cb8b7955ef55d04b1ff1da857480` |

The merged `regional-import.osm.bz2` is 2,698,366,189 bytes, SHA-256
`c9e3b3014dff2456ec531ddf8bc53ce635e0de3ddbc7cfbad75ccfe5e8843e6f`.
The source manifest records creation time `2026-10-31T08:29:10Z` and all
input checksums. The Overpass source tarball was the official 0.7.62.11
release, SHA-256
`ff9ab837034c25a1956ff638e9af66a7f36f6cbaffc97d71429d1aa8b0a929ba`.
It compiled successfully in Ubuntu 22.04 under WSL with the documented
compiler and Expat dependencies.

## Local import and query measurements

The first no-metadata import ran on C: and reached 34 GiB while host free space
fell below the 8 GiB safety margin. It was stopped before the disk filled. The
temporary WSL distro was moved to `D:\WTW-B2-Ubuntu`, and a clean import was
started there. The interrupted partial database was removed after the clean
retry passed its earlier checkpoint.

The clean import completed successfully in about 47 minutes. The final database
directory occupies 62,183,795,009 bytes (57.9 GiB). The import ran locally as a
dedicated unprivileged `overpass` user. It logged 600,010 missing-way geometry
messages across 2,362 relation IDs while assembling relations. Inspecting
several IDs with the most messages found the Honshu and Great Britain island
multipolygons, plus long-distance railway and road routes such as the West
Coast Main Line and Tokaido Shinkansen. These relations extend beyond the
clipped regional inputs and have incomplete geometry in this database. This
did not prevent the import or these local queries from succeeding, but
app-relevant multipolygon completeness should be checked before relying on
regional relation queries.

Four small bounding boxes around the Demo city centers were queried directly
with `osm3s_query --db-dir`, selecting building nodes/ways/relations and
highway ways, then returning `out count`. Each query succeeded and produced the
same element counts on repeat runs. Timings include CLI startup and represent
three serial local runs; they exclude HTTP, Worker, or network overhead.

| Demo region | Query box (south, west, north, east) | Counted OSM elements | Query latency, median (range) |
| --- | --- | ---: | ---: |
| New York | `40.7090,-74.0090,40.7150,-74.0030` | 1,191 | 442 ms (440–445 ms) |
| Pune | `18.5180,73.8540,18.5240,73.8600` | 1,293 | 117 ms (113–119 ms) |
| Tokyo | `35.6730,139.6470,35.6790,139.6540` | 1,972 | 546 ms (521–573 ms) |
| Edinburgh | `55.9500,-3.1910,55.9560,-3.1850` | 765 | 234 ms (227–242 ms) |

I also ran the exact `combinedQuery` from `lib/overpassServer.js` with its
650 m radius around each Demo city center. Each single-cell query succeeded in
one local CLI run. The repository's `validCityData` and `isCompleteCity`
contract accepted all four results, and every returned geometry point was
valid. Each response stayed below the 8,000,000-byte city-data limit.

| Demo region | Elements | Buildings | Building parts | Highway ways | Response bytes | Local CLI time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| New York | 3,744 | 937 | 894 | 801 | 3,299,869 | 3,694 ms |
| Pune | 3,048 | 1,996 | 4 | 504 | 1,651,724 | 841 ms |
| Tokyo | 3,107 | 1,995 | 5 | 672 | 2,143,113 | 4,516 ms |
| Edinburgh | 3,986 | 1,529 | 476 | 800 | 3,677,253 | 2,261 ms |

These are one query per Demo center on a warm local database, not a 36-cell
pass, cold-start measurement, or HTTP/Worker/VPS acceptance run.

## Remaining acceptance

- Review the 600,010 missing-way relation messages for app-relevant broad
  relation queries. The four tested 650 m city responses were valid and
  complete, but this does not establish completeness for every region object.
- Reassess region scope and VPS requirements using the measured database
  footprint. The four local CLI queries were fast, but the 58 GiB database
  makes the “small VPS” assumption unproven.
- Test a 36-cell pass through a deployed HTTP endpoint and verify resource use
  and latency under realistic concurrency.
- Keep B2 open until Worker/VPS deployment and endpoint acceptance are tested.

No VPS, Cloudflare Worker, R2 object, or production configuration was created
or changed for this local feasibility run.
