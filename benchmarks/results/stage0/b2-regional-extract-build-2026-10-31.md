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

## Local import status

The first no-metadata import ran on C: and reached 34 GiB while host free space
fell below the 8 GiB safety margin. It was stopped before the disk filled. The
temporary WSL distro was moved to `D:\WTW-B2-Ubuntu`, and a clean import was
started there. The interrupted partial database was removed after the clean
retry passed its earlier checkpoint.

At the time of this report, the clean import has completed its node pass and
is processing ways. Its database is about 55 GiB, with about 59 GiB free on D:.
This intermediate size is not the final imported footprint. The import process
is local and uses a dedicated unprivileged `overpass` user.

## Remaining acceptance

- Let the no-metadata import finish and record its final on-disk database size.
- Run representative local queries for the Demo regions and record latency and
  response counts.
- Reassess region scope and VPS requirements using those measurements. The
  current broad regional input already produces a large database, so the
  “small VPS” assumption remains unproven.
- Keep B2 open until Worker/VPS deployment and endpoint acceptance are tested.

No VPS, Cloudflare Worker, R2 object, or production configuration was created
or changed for this local feasibility run.
