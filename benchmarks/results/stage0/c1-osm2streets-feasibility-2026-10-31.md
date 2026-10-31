# C1 osm2streets feasibility — 31 October 2026

## Result

The upstream browser package is `osm2streets-js@0.1.4` (Apache-2.0). Its npm
tarball is 712,547 bytes compressed and 1,926,790 bytes unpacked; the WASM file
is 1,894,235 bytes and the JavaScript glue is 26,733 bytes. The published
declarations expose lane polygons, lane markings and intersection markings as
GeoJSON strings, but leave the import options argument typed as `any`.

## Local cell probe

The probe used the staged Pune cell `wtw_city6_18.535_73.896` from
`.cell-refresh-staging/hpi-demo-2026-10-31/`, without making a network request.
Its 1,360 OSM elements contained 1,000 ways. Every way had matching node-ID
and geometry arrays, and shared node IDs had no conflicting coordinates. The
converter selected 295 highway or railway ways, reconstructed 1,169 unique
nodes and emitted 141,880 bytes of OSM XML.

On this Windows i7-13650HX host with Node 22.23.3, one run took 19.2 ms to
initialize the WASM and 110.9 ms to import and transform that cell. With the
runtime option `osm2lanes: true`, output was:

| Output | Features | Serialized bytes |
| --- | ---: | ---: |
| Lane polygons | 1,037 | 1,112,961 |
| Lane markings | 11,224 | 26,281,207 |
| Intersection markings | 17 | 13,355 |

This is a single Node run, not a browser or target-device measurement. During
processing, the WASM logged many empty-intersection geometry messages, plus
duplicate-point and trimmed-road warnings.

## Integration risks and next gate

The published `.d.ts` does not describe the import-options fields. The package
rejected the options shown by the corresponding upstream `ImportOptions` source
until the probe supplied an extra boolean `osm2lanes` field. The upstream
README also says the JavaScript API is not stable. This makes the npm artifact's
runtime contract unclear.

The cell JSON can be reconstructed as OSM XML for this sample, but the 26.3 MB
lane-marking result is too large to add directly to cell loading. Do not add
this package to the application yet. Before C1 implementation, pin and verify
the exact WASM source/API, define a lane-only output path that bounds transient
memory, and measure visual correctness plus full cell cost in a browser. Keep
the larger-bet gate open until that comparison demonstrates value.

Sources:

- [Upstream 0.1.4 Cargo metadata](https://github.com/a-b-street/osm2streets/blob/30c1aec7/osm2streets-js/Cargo.toml)
- [Upstream import-options source](https://github.com/a-b-street/osm2streets/blob/30c1aec7/osm2streets-js/src/lib.rs)
- [Published package files](https://cdn.jsdelivr.net/npm/osm2streets-js@0.1.4/)
- [Published JavaScript declarations](https://cdn.jsdelivr.net/npm/osm2streets-js@0.1.4/osm2streets_js.d.ts)
- [Upstream README at the 0.1.4 source revision](https://github.com/a-b-street/osm2streets/blob/30c1aec7/README.md)
