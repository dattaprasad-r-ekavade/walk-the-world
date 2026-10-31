# B4 local Overture index recheck — 31 October 2026

## Result

The local-only index builder produced 512 entries for release `2026-10-21.0`
at `.cell-refresh-staging/overture-local-index-2026-10-31/manifest.json`.
Compared as `(filename, xmin, xmax, ymin, ymax)` tuples with the reviewed
manifest in `sec1-overture-index-2026-10-31.json`, all 512 entries match; only
their ordering differs. The generated file is 130,066 bytes with SHA-256
`792c4b700efa851be35acedf3bbf8ce4a3d70dae90b87c5b27f2948fede6ffe5`.

Using the same `dLat=0.006` and `dLon=0.006/cos(latitude)` bounds as
`GET /api/overture/<key>`, every one of the 36 cache cells in the recorded
four-city pre-refresh baseline intersects one or two indexed Parquet bounds.
No cells are uncovered. The comparison used the production API's strict
bbox-intersection predicates.

The builder's `--manifest-out` mode writes the generated JSON locally and
makes no R2 request. This recheck did not upload or otherwise mutate R2.

## Remaining gate

The production index is still absent (`GET /api/overture-index` previously
returned `{"indexed":false,"files":0}`). Upload the reviewed manifest only
after separate approval, then confirm the deployed release and complete the
live Overture API acceptance check. This local comparison does not close that
gate.
