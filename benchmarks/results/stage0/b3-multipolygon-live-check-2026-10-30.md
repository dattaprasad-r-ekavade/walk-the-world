# B3 live multipolygon data check

Date: 30 October 2026

Code revision checked: `a575d24`

Environment: Windows, Node.js 22.23.3; read-only HTTP requests.

## Overpass query availability

The relation query was sent for a 650 m radius around Edinburgh using the
urban land-use tag expression and `out geom 120`:

- `overpass-api.de` returned HTTP 406 without the app's request headers.
- Retrying with the app User-Agent and JSON accept header timed out after 30 s.
- `overpass.kumi.systems` and `overpass.private.coffee` timed out after 25 s.

The exact Overpass query path therefore remains unverified against a live
response.

## OSM API relation sample

The standard OSM map API returned HTTP 200 for
`bbox=-3.19,55.944,-3.17,55.956`, including two tagged land-use multipolygon
relations. Relation `2344206` is a cemetery with ten outer way members. Its
`/relation/2344206/full` response returned HTTP 200 with 31 nodes and ten ways.
Passing those member geometries to `stitchMultipolygonMemberRings` produced one
closed outer ring with 32 points and no discarded member geometry. This sample
has no inner member; synthetic tests cover inner-ring winding and incomplete
chains.

This confirms that the stitcher can reconstruct an actual OSM relation's way
topology. It does not prove that Overpass returns this query successfully or
that the relation is drawn in a complete city build. No R2 data was written.

## 31 October follow-up

The production Edinburgh cell request was retried through the app's current
three-mirror path. The full request exhausted its 85 s budget. A separate,
bounded run of the exact land-use relation subquery returned HTTP 502 from
`overpass-api.de` (the server reported its query queue was full); Kumi and
Private Coffee each timed out after 15 s. The responses point to endpoint
capacity as the current blocker; no endpoint returned a parser or invalid-data
response. No further retries or R2 writes were made.

The OSM API's read-only `relation/2344206/full.json` response was also passed
in memory through `buildCityGeometry` as an Overpass-shaped relation. The
builder emitted one closed cemetery land-use ring with 32 points from ten
member ways. This verifies the real relation geometry through the builder
integration path, but it is not an Overpass response or a full-city build. The
Overpass query and R2 demo-cell reseed remain open.

An additional read-only retry used the same bounded relation query against the
global `maps.mail.ru` Overpass instance listed by the
[OpenStreetMap Overpass API instance directory](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances).
It returned HTTP 504 (Gateway Time-out) after about two seconds, with no
response data. The configured mirrors and this alternate public instance have
all failed for this query; the query result and full-city build remain
unverified. No further endpoint retries or R2 writes were made.
