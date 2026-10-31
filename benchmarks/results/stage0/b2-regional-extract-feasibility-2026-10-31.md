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

## Import path and remaining measurement

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
with Osmium, and write a source checksum manifest. The script has not been run:
direct PBF-host requests from this host timed out before the files could be
downloaded. Git Bash is installed and its syntax check passes, but Osmium is
missing. WSL exposes only the Docker Desktop distribution, and the Docker
engine was unavailable during this check. The builder now bounds each
connection to 30 seconds and each transfer to 30 minutes, writes the manifest
to a temporary file, and removes any published output if the paired manifest
cannot be published. The full download and merge still need a Linux environment
with Osmium.

A fresh 12-second HEAD request to the New York PBF checksum sidecar also timed
out with HTTP 000 and no response bytes. The Docker service is stopped, and the
local Windows host therefore still has no available Linux import runtime. No
extract or checksum file was downloaded.

The 1.5 GB figure is compressed source data, not the imported Overpass database
size. No provider or disk size is selected yet. The official full-install guide
recommends at least 4 GB RAM and cites 100 GB for a full-planet database without
metadata/minutely diffs; that planet figure does not establish the footprint of
this smaller regional set. The first deployment gate is to run the regional
import on a disposable Linux host with measured free disk, then retain the
resulting database size and query behavior before choosing a VPS plan.

No infrastructure was provisioned, and no R2 or production configuration was
changed during this feasibility check.

## Regional extract connectivity recheck — 31 October 2026

Bounded 15-second HEAD requests to the four published PBF URLs all timed out
from the Windows host: New York state, Western Zone India, Kantō, and Scotland.
No extract or checksum sidecar was downloaded. The compressed source set
therefore remains a 1.5 GB estimate from the published pages, and the source
builder still needs a Linux environment with Osmium and working Geofabrik
access before an import-size measurement can begin.
