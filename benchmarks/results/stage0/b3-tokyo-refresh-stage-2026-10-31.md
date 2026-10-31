# B3 Tokyo cache refresh stage — 31 October 2026

## Result

The public HPI Overpass endpoint supplied all nine Tokyo cache-version-6
neighborhood candidates for the resumable Demo batch. The read-only refresh
script fetched their originals through the deployment's public cache proxy and
kept the candidates locally in
`.cell-refresh-staging/hpi-demo-2026-10-31/`.

The local refresh verifier passed all 9/9 Tokyo cells. Across those cells,
renderable building ways increased from 17,877 to 17,964, with per-cell
retention between 100% and 102.4%. OSM elements increased from 31,064 to
33,085. This confirms the cache refresh rules and payload hashes for Tokyo; it
does not validate a production cache update.

At the recorded batch snapshot, the 36-cell manifest was still `in_progress`:
27 ready, one failed Pune cell (`wtw_city6_18.541_73.901`), and eight New York
cells pending. Other ready cells remain available to the resumable run.

No R2 write occurred. The complete four-city batch still needs local review,
and any R2 upload requires separate approval followed by live visual and
performance acceptance.
