# B2 regional Overpass extract feasibility — 31 October 2026

## Candidate coverage

The four Demo locations fit within regional Geofabrik extracts rather than a
full-planet import:

| Demo location | Extract | Published PBF size | OSM data through |
| --- | --- | ---: | --- |
| New York | [New York state](https://download.geofabrik.de/north-america/us/new-york.html) | 475 MB | 29 Oct 2026 |
| Pune | [Western Zone, India](https://download.geofabrik.de/asia/india/western-zone.html) | 211 MB | 29 Oct 2026 |
| Tokyo | [Kantō region, Japan](https://download.geofabrik.de/asia/japan/kanto.html) | 499 MB | 29 Oct 2026 |
| Edinburgh | [Scotland](https://download.geofabrik.de/europe/united-kingdom/scotland.html) | 314 MB | 28 Oct 2026 |

The listed PBF downloads total about 1.5 GB. Geofabrik says these free extracts
omit contributor usernames, user IDs, and changeset IDs; the app's city data
query does not require those metadata fields. The sizes and timestamps above
come from the official regional pages as indexed on 31 October. Direct HTTPS
HEAD requests to all four PBF URLs from this host timed out after 20 seconds,
so no PBF file was downloaded and the reported sizes were not independently
checked from response headers.

## Import path and initial blockers

The [Osmium merge manual](https://docs.osmcode.org/osmium/latest/osmium-merge.html)
supports combining sorted extracts and emits duplicate objects only once. The
[Overpass installation guide](https://wiki.openstreetmap.org/wiki/Overpass_API/install)
allows regional extracts, but its standard importer does not read PBF
natively; it requires conversion with `osmconvert --out-osm` first. This gives
a concrete prototype path: fetch checksummed regional PBFs, merge the four
regions, convert to OSM XML, import without metadata, then measure the actual
database and temporary-disk footprint. The repository now has
[`scripts/build-regional-overpass-source.sh`](../../../scripts/build-regional-overpass-source.sh)
to download the four current extracts, verify Geofabrik's MD5 files, merge them
with Osmium, and write a source checksum manifest. At the initial host check,
the script had not been run: direct PBF-host requests timed out before the files
could be downloaded. Git Bash was installed and its syntax check passed, but
Osmium was missing. WSL exposed only the Docker Desktop distribution, and the
Docker engine was unavailable. The builder now bounds each connection to 30
seconds and each transfer to 30 minutes, writes the manifest to a temporary
file, and removes any published output if the paired manifest cannot be
published. Those blockers were later resolved by installing Osmium and using a
local Ubuntu WSL distribution; see the
[source/import report](b2-regional-extract-build-2026-10-31.md).

A fresh 12-second HEAD request to the New York PBF checksum sidecar also timed
out with HTTP 000 and no response bytes. At that point no extract or checksum
file was downloaded; the later successful source build is recorded in the
[source/import report](b2-regional-extract-build-2026-10-31.md).

The 1.5 GB figure is compressed source data, not the imported Overpass database
size. No provider or disk size is selected yet. The official full-install guide
recommends at least 4 GB RAM and cites 100 GB for a full-planet database without
metadata/minutely diffs; that planet figure does not establish the footprint of
this smaller regional set. The subsequent local import and query measurements
are in the [source/import report](b2-regional-extract-build-2026-10-31.md);
they do not select a provider or establish HTTP deployment behavior.

No infrastructure was provisioned, and no R2 or production configuration was
changed during this feasibility check.

## Initial regional extract connectivity recheck — 31 October 2026

Bounded 15-second HEAD requests to the four published PBF URLs all timed out
from the Windows host: New York state, Western Zone India, Kantō, and Scotland.
No extract or checksum sidecar was downloaded during this connectivity check.
The later successful download and merge cleared that prerequisite, as recorded
in the [source/import report](b2-regional-extract-build-2026-10-31.md).

## HPI Overpass full-cell staging observation — 31 October 2026

The HPI endpoint `https://osm.hpi.de/overpass/api/interpreter` was later
selected through `OVERPASS_ENDPOINT` for the read-only B3 Demo refresh. A
single-threaded 120-second full pass staged 32/36 cells; a 120-second resume
reached 34/36; and a final 240-second resume reached 36/36. The full offline
verifier passed all candidates, and no R2 writes occurred. The exact manifest,
candidate review and four-city replay are in the
[B3 refresh review](b3-demo-refresh-review-2026-10-31.md).

This confirms full-cell reachability for the four sampled Demo neighborhoods
on that run. Repeated timeouts and long retries do not establish a latency
target, durable availability, or production deployment acceptance. The HPI
endpoint was not added to the runtime mirror list; the self-hosted/paid
independence option remains open.
