# SEC1 read-only Overture manifest check — 31 Oct 2026

## Result

The current Overture Buildings guide documents release `2026-10-21.0` at
`s3://overturemaps-us-west-2/release/2026-10-21.0/theme=buildings/type=building/*`
([official Buildings guide](https://docs.overturemaps.org/guides/buildings/)).
The repository's former `2026-06-17.0` default returned no Parquet files from
its S3 listing. The October release returned 512 files.

The new `--manifest-out <local-path>` mode completed the full DuckDB footer
scan in 1,968 seconds and wrote the manifest locally. The current reviewed
artifact contains 512 unique rows; all filenames use the documented release
path, every row has four finite, ordered bounds, and no row failed validation.

The formatted file is 133,652 bytes with SHA-256
`2c5b9326ebdcf0370eb2c4964a53f3b5f37681f664df5f0c1c02499653442ffa`. The
upload CLI sends `JSON.stringify(manifest)` without formatting or a trailing
newline; that exact R2 body is 114,192 bytes with SHA-256
`556fce03a2bba85bf3ed963b12b2b96302ca89597f7e1d0ab1e261aa813f4570`. These
values supersede the earlier size and hash recorded here, which did not match
the current reviewed artifact.

The reviewed payload is available as the
[manifest JSON](sec1-overture-index-2026-10-31.json). The default release in
the index builder, manifest builder, and Overture API runtime now matches the
verified `2026-10-21.0` data.

## Scope and remaining gate

This run read public Overture S3 metadata and wrote the result to local
storage. It made no R2 request; `.env.local` has no R2 credentials. The normal
upload path remains unchanged. SEC1 stays open until the exact manifest is
separately authorized and uploaded to R2, the deployed `OVERTURE_RELEASE`
matches, and the live Overture API check passes.

The one-time `POST /api/overture-index` route is disabled in production (404).
In local development it requires the dedicated `OVERTURE_INDEX_SECRET` bearer
token and returns 503 when that secret is unset. The production route's
300-second cap is shorter than this scan, so release indexing uses the CLI.
Local production-route smokes confirmed 503 for the disabled state and 401 for
an invalid token before the production-disabled guard was added; the final
local production-route smoke returned 404. The auth tests cover the local
disabled and invalid-token responses. No valid token was sent, so indexing was
not triggered. The full suite passes (237 tests), the production build passes,
and focused lint is clean. The pre-existing post-FX test was corrected to wait
for the shader warmup before asserting that bloom is active.

## Live deployment check — 31 October 2026

Read-only requests to `https://walk-the-world-delta.vercel.app` found no
deployed Overture index: `GET /api/overture-index` returned
`{"indexed":false,"files":0}`. HEAD requests through `/r2-public` returned
404 for `wtw_ovt_manifest_2026-10-21.0.json` and
`wtw_ovt_40.758_-73.986.json`. The local `.env.local` has no R2 credentials or
public cache base, so no upload was possible from this checkout.

The Overture cell GET route writes a derived cell to R2 after a cache miss and
successful index query. Since the manifest and cell are absent, that route was
not called; no write approval was provided. The live data gate remains open
until the reviewed manifest is uploaded, the deployed release is confirmed,
and the live cell path can be accepted under an approved write policy.
